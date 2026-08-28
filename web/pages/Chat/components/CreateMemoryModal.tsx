import { Component, createEffect, createSignal, on, Show } from 'solid-js'
import { createStore } from 'solid-js/store'
import { BookPlus } from 'lucide-solid'
import { AppSchema } from '/common/types'
import { emptyBook, emptyEntry } from '/common/memory'
import Button from '/web/shared/Button'
import Modal from '/web/shared/Modal'
import TextInput from '/web/shared/TextInput'
import { Toggle } from '/web/shared/Toggle'
import { markdown } from '/web/shared/markdown'
import { characterStore } from '/web/store'

export const CreateMemoryModal: Component<{
  show: boolean
  loading: boolean
  character?: AppSchema.Character
  memory: string
  keywords: string[]
  generate: (focus: string, keepThinking: boolean, suggestKeywords: boolean) => void
  close: () => void
}> = (props) => {
  const [saving, setSaving] = createSignal(false)
  const [focus, setFocus] = createSignal('')
  const [keepThinking, setKeepThinking] = createSignal(false)
  const [suggestKeywords, setSuggestKeywords] = createSignal(true)
  const [entry, setEntry] = createStore<AppSchema.MemoryEntry>({
    ...emptyEntry(),
    name: 'Chat Memory',
  })
  const actionsDisabled = () => props.loading || saving()

  createEffect(
    on(
      () => props.show,
      (show) => {
        if (!show) return
        setFocus('')
        setKeepThinking(false)
        setSuggestKeywords(props.keywords.length === 0)
        setEntry({
          ...emptyEntry(),
          name: 'Chat Memory',
          entry: props.memory,
          keywords: props.keywords.slice(),
        })
      }
    )
  )

  createEffect(
    on(
      () => props.memory,
      (memory) => setEntry('entry', memory)
    )
  )

  createEffect(() => {
    if (!props.loading) {
      setSuggestKeywords(entry.keywords.every((keyword) => !keyword.trim()))
    }
  })

  createEffect(
    on(
      () => props.keywords,
      (keywords) => setEntry('keywords', keywords.slice())
    )
  )

  const save = async () => {
    const character = props.character
    if (!character || !entry.entry.trim() || !entry.name.trim()) return

    setSaving(true)
    const characterState = characterStore.getState()
    const latestCharacter =
      characterState.chatChars.map[character._id] ||
      characterState.characters.map[character._id] ||
      character
    const book = latestCharacter.characterBook || {
      ...emptyBook(),
      name: `${character.name} Memories`,
      description: `Memories created from ${character.name}'s chats.`,
    }
    const memoryEntry = {
      ...entry,
      name: entry.name.trim(),
      entry: entry.entry.trim(),
      keywords: entry.keywords.map((keyword) => keyword.trim()).filter(Boolean),
    }

    await characterStore.editPartialCharacter(
      character._id,
      {
        characterBook: {
          ...book,
          entries: (book.entries || []).concat(memoryEntry),
        },
      },
      props.close
    )
    setSaving(false)
  }

  return (
    <Modal
      show={props.show}
      close={props.close}
      title={
        <span class="flex items-center gap-2">
          <BookPlus /> Create Memory for {props.character?.name || 'character'}
        </span>
      }
      maxWidth="half"
      maxHeight
      footer={
        <>
          <div class="mr-auto">
            <Button
              onClick={() => props.generate(focus(), keepThinking(), suggestKeywords())}
              disabled={actionsDisabled()}
            >
              Generate
            </Button>
          </div>
          <Button schema="secondary" onClick={props.close} disabled={saving()}>
            Cancel
          </Button>
          <Button onClick={save} disabled={actionsDisabled() || !entry.entry.trim()}>
            {saving() ? 'Saving...' : 'Add Memory'}
          </Button>
        </>
      }
    >
      <div class="flex h-full min-h-0 flex-col gap-3">
        <div class="flex items-center gap-3">
          <TextInput
            label="Entry Name"
            value={entry.name}
            required
            onChange={(event) => setEntry('name', event.currentTarget.value)}
          />
          <Toggle
            fieldName="create-memory-enabled"
            label="Enabled"
            value={entry.enabled}
            onChange={(enabled) => setEntry('enabled', enabled)}
          />
        </div>
        <TextInput
          prelabel="Focus"
          placeholder="Optional guidance for what the memory should emphasize"
          value={focus()}
          onChange={(event) => setFocus(event.currentTarget.value)}
        />
        <Toggle
          fieldName="create-memory-keep-thinking"
          label="Include Reasoning in the Memory Response"
          value={keepThinking()}
          onChange={setKeepThinking}
        />
        <Toggle
          fieldName="create-memory-suggest-keywords"
          label="Suggest Keywords"
          value={suggestKeywords()}
          onChange={setSuggestKeywords}
        />
        <TextInput
          prelabel="Keywords"
          placeholder="Comma separated words. E.g.: place, person, event"
          value={entry.keywords.join(',')}
          onChange={(event) => setEntry('keywords', event.currentTarget.value.split(','))}
        />
        <div class="flex flex-row gap-4">
          <TextInput
            prelabel="Priority"
            type="number"
            value={entry.priority}
            onChange={(event) => setEntry('priority', +event.currentTarget.value)}
          />
          <TextInput
            prelabel="Weight"
            type="number"
            value={entry.weight}
            onChange={(event) => setEntry('weight', +event.currentTarget.value)}
          />
        </div>
        <Show
          when={!props.loading}
          fallback={
            <div class="flex min-h-[160px] flex-1 flex-col">
              <div class="pb-1">Memory</div>
              <div
                class="form-field text-900 rendered-markdown h-full min-h-[160px] flex-1 overflow-auto rounded-md border border-[var(--bg-600)] px-4 py-2"
                innerHTML={markdown.makeHtml(entry.entry || 'Compiling memory...')}
              />
            </div>
          }
        >
          <TextInput
            isMultiline
            label="Memory"
            value={entry.entry}
            placeholder="Memory entry"
            parentClass="flex min-h-[160px] flex-1 flex-col"
            class="h-full min-h-[160px] flex-1"
            required
            resizable
            onChange={(event) => setEntry('entry', event.currentTarget.value)}
          />
        </Show>
        <Show when={props.loading}>
          <div class="text-600 text-sm">Compiling the conversation from this perspective…</div>
        </Show>
      </div>
    </Modal>
  )
}
