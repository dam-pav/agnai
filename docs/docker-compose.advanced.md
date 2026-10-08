# Advanced Docker Compose

This stack primarily targets **Portainer managing Docker Standalone**. Its default
storage layout puts all six persistent directories, including MongoDB's database
and configuration files, on the same network resource under `DATA_ROOT`.

Prepare a configuration file from `.env.advanced.example` and set the paths,
numeric IDs, initial password, and JWT secret. Use the deployment instructions
below for Portainer or the Compose CLI; they load configuration differently.
Keep the JWT secret stable across restarts. Initial credentials create the first
account; changing them does not reset an existing account's password.

## Deploying with Portainer

1. Select the **Docker Standalone environment** that will run the stack.
2. Under **Stacks → Add stack**, paste `docker-compose.advanced.yml` into the
   **Web editor**, or use **Upload** to upload it. For a Git deployment, set the
   **Compose path** to `docker-compose.advanced.yml`.
3. In **Environment variables**, choose **Load variables from .env file** and
   import your completed configuration, or enter the values individually.
4. Prepare the host mounts and permissions described below, then deploy the stack.

Portainer substitutes these stack variables into `${...}` expressions, including
images, ports, paths, and `user`. The YAML's `environment` section explicitly
passes the needed application settings into the container. Adding
`env_file: stack.env` is unnecessary for this file. Importing variables is distinct
from mounting the configuration file into a container.

For Web editor and Upload deployments, a `.env` file sitting beside the YAML on
your computer or on the Docker host is not automatically loaded. Import it through
Portainer. For Git deployments, use Portainer's stack variables explicitly rather
than depending on repository `.env` discovery; the example file contains empty
required secrets and is not a deployable configuration by itself.

After changing variables, update/redeploy the stack from Portainer so affected
containers are recreated. Editing the original imported file or restarting
containers alone does not apply those changes. Git-managed YAML changes belong
in the repository; configuration values can be edited in Portainer's stack UI.
See Portainer's [stack creation](https://docs.portainer.io/user/docker/stacks/add)
and [stack editing](https://docs.portainer.io/user/docker/stacks/edit) documentation.

### Docker Standalone versus Swarm

| Deployment | Compatibility with this file |
| --- | --- |
| Portainer + Docker Standalone | Intended deployment; import stack variables in Portainer. |
| Docker Compose CLI | Supported; load `.env` or use `--env-file`. |
| Portainer + Docker Swarm | Requires a separate Swarm-compatible stack file. |

Swarm uses `docker stack deploy` and the legacy Compose v3 format. This file uses
modern Compose features such as health-based `depends_on` and
`bind.create_host_path`; its startup ordering and mount options must be adapted
for Swarm. Swarm also needs its own restart policy and storage placement strategy.
Services may run on different nodes, so paths and permissions must exist on every
eligible node or services must be constrained to the prepared node. Run only one
MongoDB instance against a given database directory. `env_file` is not supported
by `docker stack deploy`; use explicit service environment mappings. See
[Docker's Swarm stack documentation](https://docs.docker.com/engine/swarm/stack-deploy/).

## Shared network storage and permissions

Mount the network share on the **Docker host** before starting the stack. Set
`DATA_ROOT` to its absolute path, for example `/mnt/agnai`. When Portainer manages
a remote environment through an Agent, this is the remote Docker host's path,
not your workstation's path or a directory inside the Portainer container. A NAS
URL or UNC share name must first be mounted as a host filesystem path. These are
[Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/).
Create these directories under `DATA_ROOT` on that share:

| Directory | Container path | Writable by |
| --- | --- | --- |
| `appdb` | `/app/db` | `PUID:PGID` |
| `assets` | `/app/assets` | `PUID:PGID` |
| `distassets` | `/app/dist/assets` | `PUID:PGID` |
| `extras` | `/app/extras` | `PUID:PGID` |
| `dbdata` | `/data/db` | `MONGO_UID:MONGO_GID` |
| `dbconfig` | `/data/configdb` | `MONGO_UID:MONGO_GID` |

Leave `MONGO_DATA_PATH` and `MONGO_CONFIG_PATH` unset to keep MongoDB on the same
network resource as the other directories. These optional overrides can also
select different directories on that same resource; a local disk is not required
by this Compose configuration.

Set ownership or storage-server ACLs to permit the corresponding IDs to read,
write, and traverse these directories. Both services run directly as the configured
IDs; they do not chown the share at startup. For NFS with root squashing, prepare
permissions on the storage server. For SMB, configure the host mount's UID/GID
and permissions. Merely passing `PUID` and `PGID` into a container's environment
would not change its process identity; this file uses Compose's `user` setting.

Missing directories cause startup to fail instead of being created as root.
Ensure the network mount is available after host reboots before Docker starts
the containers: existing local directories beneath an absent mount can otherwise
receive writes. Bind mounts do not mount the network share themselves.

### Verifying MongoDB on the share

MongoDB's general guidance advises avoiding NFS for its database path in its
[operations checklist](https://www.mongodb.com/docs/v7.0/administration/production-checklist-operations/).
The intended setup here still keeps MongoDB on the shared network resource.
Filesystem suitability depends on the actual protocol, NAS/server, host mount
options, and their locking and durable-write behavior. MongoDB uses WiredTiger,
so verify its workload on this mount separately even when the same mount settings
have worked for SQLite. No protocol-specific mount recipe is assumed.

Use a disposable test database on the actual share to verify:

- Database writes and uploaded assets remain readable after a clean restart and
  container recreation, with the configured UID/GID.
- Recovery after host/NAS restarts and a temporary network interruption preserves
  the test records; review MongoDB logs for filesystem and recovery errors.
- A backup can be restored into a separate test directory. Copying live database
  files casually is not a substitute for a consistent database backup.

The MongoDB health check only tests whether the server answers a ping. It does not
validate storage durability or recovery from network failures. Local bind-mount
smoke tests can verify container permissions and recreation persistence, but
validation of the target network resource requires running the checks on that share.

## Migrating existing data

Bind mounts do not automatically import the existing named volumes. Stop the old
stack, back up its volumes, and copy each volume's contents into the matching
directory above, including both MongoDB volumes and both asset directories.
Apply the configured ownership/ACLs to copied files. Keep the same MongoDB major
version during migration and retain the existing JWT secret and database name.
Do not run two MongoDB containers against the same data directory. Retain the old
volumes until the new stack's accounts, chats, and uploaded assets are verified.

## Starting and updating with the Compose CLI

For CLI deployment, copy your completed configuration to `.env` in the repository
root. Compose reads it automatically. Use `--env-file /path/to/file` before the
subcommand for a different file. Portainer deployments use the UI workflow above.

```sh
docker compose -f docker-compose.advanced.yml config --quiet
docker compose -f docker-compose.advanced.yml up -d --wait
docker compose -f docker-compose.advanced.yml ps
docker compose -f docker-compose.advanced.yml logs --tail=100 agnai mongo redis
```

The application starts after MongoDB and Redis pass their readiness checks. Only
the application port is published; MongoDB and Redis stay on the Compose network.
Redis carries transient websocket messages and has persistence disabled; account
and chat data are stored in MongoDB.
After editing `.env`, run `up -d` again to recreate affected containers; `restart`
alone does not apply environment or mount changes. Bind-mounted data survives
container recreation and `docker compose down`. Keep backups separately.
