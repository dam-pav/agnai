import { Component, Index, Show, createSignal } from 'solid-js'
import { v4 } from 'uuid'
import { VariableBand, VariableDefinition, VariableModifier } from '/common/chat-variables'
import Button from './Button'
import TextInput from './TextInput'

export const VariableBands: Component<{
  value: VariableBand[]
  update: (bands: VariableBand[]) => void
  min: number
  max: number
  precision: number
}> = (props) => {
  const update = (index: number, change: Partial<VariableBand>) =>
    props.update(props.value.map((band, i) => (i === index ? { ...band, ...change } : band)))
  return (
    <div class="flex flex-col gap-3">
      <b>Context bands</b>
      <p class="text-sm">
        Both endpoints are included. Every matching band injects its text. Use {'{{char}}'} for the
        owner and {'{{user}}'} for the user.
      </p>
      <Index each={props.value}>
        {(band, index) => (
          <div class="flex flex-col gap-2 rounded border border-[var(--bg-500)] p-3">
            <div class="flex gap-2">
              <TextInput
                type="number"
                step={10 ** -props.precision}
                label="From"
                value={band().min}
                onChange={(ev) => update(index, { min: +ev.currentTarget.value })}
              />
              <TextInput
                type="number"
                step={10 ** -props.precision}
                label="Through"
                value={band().max}
                onChange={(ev) => update(index, { max: +ev.currentTarget.value })}
              />
            </div>
            <TextInput
              isMultiline
              label="Context text"
              value={band().text}
              onChange={(ev) => update(index, { text: ev.currentTarget.value })}
            />
            <Button
              schema="secondary"
              onClick={() => props.update(props.value.filter((_, i) => i !== index))}
            >
              Remove band
            </Button>
          </div>
        )}
      </Index>
      <Button
        schema="secondary"
        onClick={() =>
          props.update([...props.value, { id: v4(), min: props.min, max: props.max, text: '' }])
        }
      >
        Add context band
      </Button>
    </div>
  )
}

export const VariableModifiers: Component<{
  value: VariableModifier[]
  update: (modifiers: VariableModifier[]) => void
  precision: number
}> = (props) => {
  const update = (index: number, change: Partial<VariableModifier>) =>
    props.update(
      props.value.map((modifier, i) => (i === index ? { ...modifier, ...change } : modifier))
    )
  return (
    <div class="flex flex-col gap-3">
      <b>Modifiers</b>
      <p class="text-sm">
        The model selects the conditions that occur in each turn. Each selected adjustment applies
        once; values stay within the class bounds.
      </p>
      <Index each={props.value}>
        {(modifier, index) => (
          <div class="flex flex-col gap-2 rounded border border-[var(--bg-500)] p-3">
            <TextInput
              label="Modifier name"
              value={modifier().name}
              onChange={(ev) => update(index, { name: ev.currentTarget.value })}
            />
            <TextInput
              isMultiline
              label="Apply when…"
              value={modifier().condition}
              onChange={(ev) => update(index, { condition: ev.currentTarget.value })}
            />
            <TextInput
              type="number"
              step={10 ** -props.precision}
              label="Adjustment (negative to decrease)"
              value={modifier().delta}
              onChange={(ev) => update(index, { delta: +ev.currentTarget.value })}
            />
            <Button
              schema="secondary"
              onClick={() => props.update(props.value.filter((_, i) => i !== index))}
            >
              Remove modifier
            </Button>
          </div>
        )}
      </Index>
      <Button
        schema="secondary"
        onClick={() =>
          props.update([...props.value, { id: v4(), name: '', condition: '', delta: 1 }])
        }
      >
        Add modifier
      </Button>
    </div>
  )
}

export const VariableDefinitionEditor: Component<{
  value: VariableDefinition
  update: (value: VariableDefinition) => void
}> = (props) => {
  const [preview, setPreview] = createSignal(0)
  const update = (change: Partial<VariableDefinition>) =>
    props.update({ ...props.value, ...change })
  return (
    <div class="flex flex-col gap-4">
      <TextInput
        label="Class name"
        value={props.value.name}
        onChange={(ev) => update({ name: ev.currentTarget.value })}
      />
      <div class="flex flex-wrap gap-2">
        <TextInput
          type="number"
          step={10 ** -props.value.precision}
          label="Minimum"
          value={props.value.min}
          onChange={(ev) => update({ min: +ev.currentTarget.value })}
        />
        <TextInput
          type="number"
          step={10 ** -props.value.precision}
          label="Maximum"
          value={props.value.max}
          onChange={(ev) => update({ max: +ev.currentTarget.value })}
        />
        <TextInput
          type="number"
          step={1}
          input={{ min: 0, max: 6 }}
          label="Decimal places (0–6)"
          value={props.value.precision}
          onChange={(ev) => update({ precision: +ev.currentTarget.value })}
        />
      </div>
      <VariableBands
        value={props.value.bands}
        update={(bands) => update({ bands })}
        min={props.value.min}
        max={props.value.max}
        precision={props.value.precision}
      />
      <VariableModifiers
        value={props.value.modifiers}
        update={(modifiers) => update({ modifiers })}
        precision={props.value.precision}
      />
      <div class="flex flex-col gap-2 rounded border border-[var(--bg-500)] p-3">
        <b>Context preview</b>
        <TextInput
          type="number"
          step={10 ** -props.value.precision}
          label="Preview value"
          value={preview()}
          onChange={(ev) => setPreview(+ev.currentTarget.value)}
        />
        <Show when={preview() < props.value.min || preview() > props.value.max}>
          <p>Value is outside the class bounds.</p>
        </Show>
        <Index
          each={props.value.bands.filter((band) => preview() >= band.min && preview() <= band.max)}
        >
          {(band) => <p class="whitespace-pre-wrap">{band().text}</p>}
        </Index>
      </div>
    </div>
  )
}
