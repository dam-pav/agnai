import { For, Show, createMemo, createSignal } from 'solid-js'
import { v4 } from 'uuid'
import { normalizeVariableValue, resolveVariables, variableState } from '/common/chat-variables'
import { getUserId } from '/web/store/api'
import {
  chatStore,
  msgStore,
  responseStore,
  characterStore,
  userStore,
  scenarioStore,
} from '/web/store'
import { usePaneManager } from '/web/shared/hooks'
import { variablesApi } from '/web/store/data/variables'
import { getPromptEntities } from '/web/store/data/common'
import { chatsApi } from '/web/store/data/chats'
import { msgsApi } from '/web/store/data/messages'
import { ConfirmModal } from '/web/shared/Modal'
import Button from '/web/shared/Button'
import TextInput from '/web/shared/TextInput'
import { Toggle } from '/web/shared/Toggle'

export default function ChatVariables() {
  const pane = usePaneManager()
  const chats = chatStore((state) => ({ active: state.details[state.lastChatId] }))
  const scenarios = scenarioStore((state) => ({ list: state.scenarios }))
  const messages = msgStore((state) => ({ graph: state.graph }))
  const responses = responseStore((state) => ({ waiting: state.waiting }))
  const userName = userStore((state) => ({ name: state.profile?.handle || 'You' }))
  const impersonation = characterStore((state) => ({ name: state.impersonating?.name }))
  const defs = () => chats.active?.chat.variables || []
  const branch = createMemo(() => Object.values(messages.graph.tree).map((node) => node.msg))
  const values = createMemo(() => variableState(defs(), branch(), chats.active?.chat.treeLeafId))
  const [drafts, setDrafts] = createSignal<Record<string, number>>({})
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [refreshing, setRefreshing] = createSignal(false)
  const disabled = () => busy() || !!responses.waiting || getUserId() !== chats.active?.chat.userId
  const updateChat = async (update: Parameters<typeof chatsApi.editChat>[1]) => {
    const chat = chats.active!.chat
    const result = await chatsApi.editChat(chat._id, update)
    if (result.error) throw new Error(result.error)
    const state = chatStore.getState()
    chatStore.setState({
      details: {
        ...state.details,
        [chat._id]: { ...state.details[chat._id], chat: { ...chat, ...update } },
      },
    })
  }
  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await task()
    } catch (ex: any) {
      setError(ex.message)
    } finally {
      setBusy(false)
    }
  }
  const adjust = (id: string) =>
    run(async () => {
      const def = defs().find((item) => item.id === id)!
      const before = values()[id]
      const after = normalizeVariableValue(def, drafts()[id] ?? before)
      const text = `${def.name}: ${before} → ${after} (manual adjustment)`
      const result = await msgsApi.createMessage({
        messageId: v4(),
        chatId: chats.active!.chat._id,
        parent: chats.active!.chat.treeLeafId,
        text,
        kind: 'ooc',
        json: {
          response: text,
          history: text,
          imageCaption: '',
          values: {},
          variables: {
            values: { [id]: after },
            changes: [{ variableId: id, modifierIds: [], before, after }],
          },
        },
      })
      if (result.error) throw new Error(result.error)
      setDrafts({})
    })
  const refresh = () =>
    run(async () => {
      const entities = await getPromptEntities()
      const result = await variablesApi.list()
      if (result.error) throw new Error(result.error)
      const variables = resolveVariables(
        [
          entities.char,
          ...Object.values(entities.characters || {}).filter(
            (char) => entities.chat.characters?.[char._id] || char._id.startsWith('temp-')
          ),
          ...entities.scenarios,
        ],
        result.result?.classes || [],
        entities.char.name,
        defs()
      )
      const previousValues = values()
      const replayed = variableState(variables, branch(), entities.chat.treeLeafId)
      const corrections = variables.filter(
        (def) =>
          previousValues[def.id] !== undefined &&
          normalizeVariableValue(def, previousValues[def.id]) !== replayed[def.id]
      )
      await updateChat({ variables })
      if (corrections.length) {
        const changes = corrections.map((def) => ({
          variableId: def.id,
          modifierIds: [],
          before: replayed[def.id],
          after: normalizeVariableValue(def, previousValues[def.id]),
        }))
        const text = 'Variable definitions updated; current values retained within the new bounds.'
        const saved = await msgsApi.createMessage({
          messageId: v4(),
          chatId: entities.chat._id,
          parent: entities.chat.treeLeafId,
          kind: 'ooc',
          text,
          json: {
            response: text,
            history: text,
            imageCaption: '',
            values: {},
            variables: {
              values: Object.fromEntries(
                changes.map((change) => [change.variableId, change.after])
              ),
              changes,
            },
          },
        })
        if (saved.error) throw new Error(saved.error)
      }
      setRefreshing(false)
    })
  return (
    <div class="flex flex-col gap-4">
      <p>
        Values follow the selected conversation branch. Automatic updates require a model that
        supports structured responses.
      </p>
      <Show when={error()}>
        <p role="alert" class="text-red-400">
          {error()}
        </p>
      </Show>
      <Toggle
        disabled={disabled()}
        fieldName="automaticVariables"
        label="Automatic variable updates"
        value={!chats.active?.chat.variableUpdatesDisabled}
        onChange={(value) => run(() => updateChat({ variableUpdatesDisabled: !value }))}
      />
      <div class="flex flex-col gap-2">
        <Show
          when={chats.active?.chat.scenarioIds?.length}
          fallback={
            <p>
              No Library scenario is attached to this chat. To include a scenario's variables,
              select its Scenario in Edit Chat, save, then adopt its definitions here.
            </p>
          }
        >
          <p>
            Attached scenarios:{' '}
            {chats.active?.chat.scenarioIds
              ?.map((id) => scenarios.list.find((scenario) => scenario._id === id)?.name || id)
              .join(', ')}
          </p>
        </Show>
        <Button
          disabled={disabled()}
          schema="secondary"
          onClick={() => pane.update('chat-settings')}
        >
          Edit Chat scenario
        </Button>
      </div>
      <Button disabled={disabled()} schema="secondary" onClick={() => setRefreshing(true)}>
        Adopt current variable definitions
      </Button>
      <Show when={!defs().length}>
        <p>
          No variables attached. Add variables in the character or scenario editor, then adopt their
          definitions here.
        </p>
      </Show>
      <For each={defs()}>
        {(def) => (
          <div class="flex flex-col gap-2 rounded bg-[var(--bg-800)] p-3">
            <b>
              {def.ownerKind === 'character'
                ? def.ownerName
                : `Scenario: ${def.ownerLabel || def.ownerId}`}{' '}
              — {def.name}: {values()[def.id]}
            </b>
            <p class="text-sm">
              Range: {def.min} to {def.max} · class revision {def.revision}
            </p>
            <For
              each={def.bands.filter(
                (band) => values()[def.id] >= band.min && values()[def.id] <= band.max
              )}
            >
              {(band) => (
                <p class="whitespace-pre-wrap">
                  {band.text
                    .replace(/{{char}}/gi, () => def.ownerName)
                    .replace(/{{user}}/gi, () => impersonation.name || userName.name)}
                </p>
              )}
            </For>
            <TextInput
              type="number"
              step={10 ** -def.precision}
              label="Set value"
              value={drafts()[def.id] ?? values()[def.id]}
              onChange={(ev) => setDrafts({ ...drafts(), [def.id]: +ev.currentTarget.value })}
            />
            <Button disabled={disabled()} onClick={() => adjust(def.id)}>
              Apply manual value
            </Button>
          </div>
        )}
      </For>
      <details>
        <summary>Recent changes on this branch</summary>
        <For
          each={(() => {
            const path: ReturnType<typeof branch> = []
            const byId = new Map(branch().map((msg) => [msg._id, msg]))
            let msg = byId.get(chats.active?.chat.treeLeafId || '')
            const seen = new Set<string>()
            while (msg && !seen.has(msg._id)) {
              seen.add(msg._id)
              path.push(msg)
              msg = byId.get(msg.parent || '')
            }
            return path.filter((msg) => msg.json?.variables?.changes.length).slice(0, 10)
          })()}
        >
          {(msg) => (
            <For each={msg.json?.variables?.changes}>
              {(change) => (
                <p>
                  {defs().find((def) => def.id === change.variableId)?.name || 'Variable'}:{' '}
                  {change.before} → {change.after}
                  {change.modifierIds.length ? '' : ' (manual)'}
                </p>
              )}
            </For>
          )}
        </For>
      </details>
      <ConfirmModal
        show={refreshing()}
        close={() => setRefreshing(false)}
        confirm={refresh}
        message="Adopt the current character, scenario, and class definitions? Existing values are retained for matching variables and clamped to their new bounds. Removed variables stop affecting the chat."
      />
    </div>
  )
}
