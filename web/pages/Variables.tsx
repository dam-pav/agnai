import { For, Show, createSignal, onMount } from 'solid-js'
import {
  VariableClass,
  VariableDefinition,
  validateVariableDefinition,
} from '/common/chat-variables'
import { variablesApi } from '/web/store/data/variables'
import { toastStore } from '/web/store'
import { Page } from '/web/Layout'
import PageHeader from '/web/shared/PageHeader'
import Button from '/web/shared/Button'
import { VariableDefinitionEditor } from '/web/shared/VariableEditor'
import { downloadJson } from '/web/shared/util'
import { ConfirmModal } from '/web/shared/Modal'

const blank = (): VariableDefinition => ({
  name: '',
  min: 0,
  max: 100,
  precision: 0,
  bands: [],
  modifiers: [],
})
export default function VariablesPage() {
  const [classes, setClasses] = createSignal<VariableClass[]>([])
  const [definition, setDefinition] = createSignal<VariableDefinition>()
  const [editing, setEditing] = createSignal<string>()
  const [removing, setRemoving] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const load = async () => {
    const result = await variablesApi.list()
    if (result.error) {
      setError(result.error)
      return
    }
    setClasses(result.result?.classes || [])
  }
  onMount(load)
  const open = (value?: VariableClass, duplicate = false) => {
    setEditing(duplicate ? undefined : value?._id)
    setDefinition(
      value
        ? JSON.parse(
            JSON.stringify({ ...value, name: duplicate ? `${value.name} (copy)` : value.name })
          )
        : blank()
    )
    setError('')
  }
  const save = async () => {
    setBusy(true)
    try {
      const result = await variablesApi.save(definition()!, editing())
      if (result.error) throw new Error(result.error)
      await load()
      setDefinition(undefined)
      toastStore.success(
        'Variable class saved. Existing chats keep their snapshots until refreshed.'
      )
    } catch (ex: any) {
      setError(ex.message)
    } finally {
      setBusy(false)
    }
  }
  const importFile = async (file?: File) => {
    if (!file) return
    try {
      const value = JSON.parse(await file.text())
      validateVariableDefinition(value)
      setDefinition(value)
      setEditing(undefined)
      setError('')
    } catch (ex: any) {
      setError(`Could not import class: ${ex.message}`)
    }
  }
  return (
    <Page>
      <PageHeader title="Variable Classes" />
      <p class="mb-4">
        Reusable numeric variables for characters and scenarios. Attach a class in their editors,
        then open Variables in a chat to inspect its values.
      </p>
      <Show when={error()}>
        <p role="alert" class="my-3 text-red-400">
          {error()}
        </p>
      </Show>
      <Show when={!definition()}>
        <div class="mb-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => open()}>Create class</Button>
          <label>
            Import class{' '}
            <input
              type="file"
              accept="application/json,.json"
              onChange={(ev) => importFile(ev.currentTarget.files?.[0])}
            />
          </label>
        </div>
        <Show when={!classes().length}>
          <p>No variable classes yet.</p>
        </Show>
        <For each={classes()}>
          {(cls) => (
            <div class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded bg-[var(--bg-800)] p-3">
              <div>
                <b>{cls.name}</b>
                <p class="text-sm">
                  {cls.min} to {cls.max} · revision {cls.revision}
                </p>
              </div>
              <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
                <Button onClick={() => open(cls)}>Edit</Button>
                <Button schema="secondary" onClick={() => open(cls, true)}>
                  Duplicate
                </Button>
                <Button
                  schema="secondary"
                  onClick={() => downloadJson(cls, `${cls.name}.variable-class`)}
                >
                  Export
                </Button>
                <Button schema="red" class="ml-auto" onClick={() => setRemoving(cls._id)}>
                  Delete
                </Button>
              </div>
            </div>
          )}
        </For>
      </Show>
      <Show when={definition()}>
        <div class="flex flex-col gap-4">
          <VariableDefinitionEditor value={definition()!} update={setDefinition} />
          <div class="flex gap-2">
            <Button disabled={busy()} onClick={save}>
              Save class
            </Button>
            <Button schema="secondary" onClick={() => setDefinition(undefined)}>
              Cancel
            </Button>
          </div>
        </div>
      </Show>
      <ConfirmModal
        show={!!removing()}
        close={() => setRemoving(undefined)}
        confirm={async () => {
          const result = await variablesApi.remove(removing()!)
          if (result.error) setError(result.error)
          setRemoving(undefined)
          await load()
        }}
        message="Delete this variable class? Attachments and existing chats retain their saved definitions."
      />
    </Page>
  )
}
