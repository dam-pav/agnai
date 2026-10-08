#!/usr/bin/env bash
# Run on homoai with the new Agnai stack stopped.
# Reads the old volumes without modifying them; writes to NFS as UID/GID 1004:1002.
# Destinations must contain no files or symlinks; empty directories are allowed.
# After an interrupted copy, --resume recopies all source files over the destination.
# Use --resume only before starting the new stack or writing new destination data.
# Do not run this entire script with sudo.
set -euo pipefail

resume=false
case "${1:-}" in
  '') ;;
  --resume) resume=true ;;
  --help|-h)
    echo 'Usage: ./migrate-agnai-data.sh [--resume]'
    echo '--resume recopies all six volumes from the old disk, replacing destination files.'
    echo 'Keep the new stack stopped until copying and verification finish.'
    exit 0
    ;;
  *) echo 'Usage: ./migrate-agnai-data.sh [--resume]' >&2; exit 2 ;;
esac
if [ "$#" -gt 1 ]; then
  echo 'Usage: ./migrate-agnai-data.sh [--resume]' >&2
  exit 2
fi
if [ "$resume" = true ]; then
  echo 'Resume mode: recopying all six original volumes over the destination.'
  echo 'The new stack must remain stopped until verification finishes.'
fi

old_volumes=/mnt/oldroot/var/lib/docker/volumes
parent=/media/backup/__DOCKER
volumes=(appdb assets distassets extras dbdata dbconfig)

sudo -v
ls -ld "$parent/."

if ! findmnt -rn -T "$parent" -o SOURCE |
  grep -Fxq 'freenas:/mnt/main/backup'; then
  echo 'Expected NFS share is not mounted; stopping.'
  exit 1
fi

# All destination operations run with the intended container UID/GID.
storage_user() {
  docker run --rm -i \
    --user 1004:1002 \
    --mount "type=bind,src=$parent,dst=/migration" \
    --entrypoint bash mongo:8 -c "$@"
}

for volume in "${volumes[@]}"; do
  source="$old_volumes/agnaistic_${volume}/_data"
  echo "Checking source: $source"
  if ! sudo test -d "$source"; then
    echo "Required source directory is missing or inaccessible: $source" >&2
    sudo ls -ld "$old_volumes" "$old_volumes/agnaistic_${volume}" "$source" >&2 || true
    exit 1
  fi
done

# Prepare and check all destinations before copying.
storage_user '
  set -euo pipefail
  umask 007
  if [ -L /migration/agnai ]; then
    echo "Destination root is a symlink: /migration/agnai" >&2
    exit 1
  fi
  mkdir -p /migration/agnai

  for volume in appdb assets distassets extras dbdata dbconfig; do
    target="/migration/agnai/$volume"
    if [ -L "$target" ]; then
      echo "Destination is a symlink: $target" >&2
      exit 1
    fi
    mkdir -p "$target"
    if [ ! -w "$target" ] || [ ! -x "$target" ]; then
      echo "Destination is not writable/traversable by UID/GID 1004:1002: $target" >&2
      id >&2
      ls -ldn /migration /migration/agnai "$target" >&2
      exit 1
    fi

    # Permit empty directory trees left by an interrupted empty-volume copy.
    if [ "$1" != true ] &&
       [ -n "$(find "$target" -mindepth 1 ! -type d -print -quit)" ]; then
      echo "Destination contains existing files or other entries: $target"
      echo "For an interrupted migration, keep the new stack stopped and rerun with --resume."
      exit 1
    fi
  done
' _ "$resume"

for volume in "${volumes[@]}"; do
  source="$old_volumes/agnaistic_${volume}/_data"

  echo "Copying $volume as 1004:1002 over NFS (progress every 10 MiB of archive data)..."
  # Preserve sparse files and report transfer progress on stderr.
  sudo tar --sparse --blocking-factor=20 --checkpoint=1024 \
    --checkpoint-action='echo=Copy progress: %u archive records (10 KiB each)' \
    -C "$source" -cf - . |
    storage_user '
      set -euo pipefail
      umask 007
      target="/migration/agnai/$1"
      tar --no-same-owner --no-same-permissions -C "$target" -xf -
      chmod -R u+rwX "$target"
    ' _ "$volume"

  echo "Verifying $volume..."
  sudo bash -c '
    set -euo pipefail
    cd "$1"
    find . -type f -exec sha256sum -- {} +
  ' _ "$source" |
    storage_user '
      set -euo pipefail
      cd "/migration/agnai/$1"
      manifest=$(mktemp)
      trap "rm -f -- \"$manifest\"" EXIT
      cat > "$manifest"

      if [ -s "$manifest" ]; then
        sha256sum --check --quiet "$manifest"
      else
        echo "No regular files in the source volume; no checksums to verify."
      fi
    ' _ "$volume"

  echo "$volume copied and verified."
done

echo 'Migration copy complete.'
storage_user 'ls -ldn /migration/agnai /migration/agnai/*'
