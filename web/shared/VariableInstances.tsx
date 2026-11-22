import { Component, Index, Show, createSignal, onMount } from 'solid-js'
import { A } from '@solidjs/router'
import { v4 } from 'uuid'
import { VariableClass, VariableInstance } from '/common/chat-variables'
import { variablesApi } from '/web/store/data/variables'
import Button from './Button'
import TextInput from './TextInput'
import Select from './Select'
import { VariableBands, VariableModifiers } from './VariableEditor'

export const VariableInstances: Component<{
  value?: VariableInstance[]
  update: (value: VariableInstance[]) => void
}> = (props) => {
  const [classes, setClasses] = createSignal<VariableClass[]>([])
  const [selected, setSelected] = createSignal('')
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
  const update = (index: number, change: Partial<VariableInstance>) =>
    props.update(
      (props.value || []).map((item, i) =>
        i === index
          ? {
              ...item,
              classSnapshot:
                classes().find((cls) => cls._id === item.classId) || item.classSnapshot,
              ...change,
            }
          : item
      )
    )
  const add = () => {
    const cls = classes().find((item) => item._id === selected())
    if (!cls) return
    props.update([
      ...(props.value || []),
      {
        id: v4(),
        classId: cls._id,
        name: cls.name,
        initial: Math.max(cls.min, Math.min(cls.max, 0)),
        classSnapshot: JSON.parse(JSON.stringify(cls)),
      },
    ])
  }
  return (
    <div class="flex flex-col gap-3">
      <b>Chat variables</b>
      <p class="text-sm">
        Starting values apply to new chats. Changes to definitions can be adopted from the chat’s
        Variables panel.{' '}
        <A class="link" href="/memory?tab=4" target="_blank">
          Manage variable classes
        </A>
      </p>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <div class="flex flex-wrap gap-2">
        <Select
          fieldName="variableClass"
          value={selected()}
          items={[
            { label: 'Select a class…', value: '' },
            ...classes().map((cls) => ({ label: cls.name, value: cls._id })),
          ]}
          onChange={(item) => setSelected(item.value)}
        />
        <Button schema="secondary" disabled={!selected()} onClick={add}>
          Attach variable
        </Button>
        <Button schema="secondary" onClick={load}>
          Reload classes
        </Button>
      </div>
      <Index each={props.value || []}>
        {(instance, index) => {
          const cls = () => classes().find((item) => item._id === instance().classId)
          const effective = () => cls() || instance().classSnapshot
          return (
            <div class="flex flex-col gap-3 rounded border border-[var(--bg-500)] p-3">
              <p class="text-sm">
                Class: {effective().name} ({effective().min} to {effective().max})
                <Show when={!cls()}> · Library class missing; using saved definition</Show>
              </p>
              <TextInput
                label="Variable name"
                value={instance().name}
                onChange={(ev) => update(index, { name: ev.currentTarget.value })}
              />
              <TextInput
                type="number"
                step={10 ** -effective().precision}
                input={{ min: effective().min, max: effective().max }}
                label="Starting value"
                value={instance().initial}
                onChange={(ev) => update(index, { initial: +ev.currentTarget.value })}
              />
              <Select
                fieldName={`bands-${instance().id}`}
                label="Context bands"
                value={instance().bands === undefined ? 'inherit' : 'replace'}
                items={[
                  { label: 'Inherit class bands', value: 'inherit' },
                  { label: 'Replace with own bands', value: 'replace' },
                ]}
                onChange={(item) =>
                  update(index, {
                    bands:
                      item.value === 'inherit'
                        ? undefined
                        : effective().bands.map((band) => ({ ...band })),
                  })
                }
              />
              <Show when={instance().bands !== undefined}>
                <VariableBands
                  value={instance().bands!}
                  min={effective().min}
                  max={effective().max}
                  precision={effective().precision}
                  update={(bands) => update(index, { bands })}
                />
              </Show>
              <Select
                fieldName={`modifiers-${instance().id}`}
                label="Modifiers"
                value={instance().modifiers === undefined ? 'inherit' : 'replace'}
                items={[
                  { label: 'Inherit class modifiers', value: 'inherit' },
                  { label: 'Replace with own modifiers', value: 'replace' },
                ]}
                onChange={(item) =>
                  update(index, {
                    modifiers:
                      item.value === 'inherit'
                        ? undefined
                        : effective().modifiers.map((modifier) => ({ ...modifier })),
                  })
                }
              />
              <Show when={instance().modifiers !== undefined}>
                <VariableModifiers
                  value={instance().modifiers!}
                  precision={effective().precision}
                  update={(modifiers) => update(index, { modifiers })}
                />
              </Show>
              <Button
                schema="red"
                class="self-end"
                onClick={() => props.update((props.value || []).filter((_, i) => i !== index))}
              >
                Remove variable
              </Button>
            </div>
          )
        }}
      </Index>
    </div>
  )
}
