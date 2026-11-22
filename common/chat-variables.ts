import type { JsonField, JsonOutput } from './prompt'
import type { ResponseSchema } from './types/library'

export type VariableBand = { id: string; min: number; max: number; text: string }
export type VariableModifier = { id: string; name: string; condition: string; delta: number }
export type VariableDefinition = {
  name: string
  min: number
  max: number
  precision: number
  bands: VariableBand[]
  modifiers: VariableModifier[]
}
export type VariableClass = VariableDefinition & {
  _id: string
  kind: 'variable-class'
  userId: string
  revision: number
}
export type VariableInstance = {
  id: string
  classId: string
  name: string
  initial: number
  /** Portable fallback. The library definition takes precedence when resolving new snapshots. */
  classSnapshot: VariableDefinition & { revision: number }
  /** Undefined inherits; an empty list explicitly replaces with no entries. */
  bands?: VariableBand[]
  modifiers?: VariableModifier[]
}
export type ResolvedVariable = VariableDefinition & {
  id: string
  instanceId: string
  classId: string
  revision: number
  ownerId: string
  ownerKind: 'character' | 'scenario'
  ownerName: string
  ownerLabel?: string
  initial: number
}
export type VariableChange = {
  variableId: string
  modifierIds: string[]
  delta?: number
  before: number
  after: number
}
export type VariableResult = { values: Record<string, number>; changes: VariableChange[] }
export type VariableMessage = {
  _id: string
  parent?: string
  json?: { variables?: VariableResult }
}

const ID = /^[a-zA-Z0-9_-]{1,100}$/
export const VARIABLE_PREFIX = 'agnai_var_'

class VariableValidationError extends Error {
  readonly status = 400
}

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new VariableValidationError(`Chat variables: ${message}`)
}
function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 10000
}
function entries<T extends { id: string }>(list: T[], validate: (item: T) => void) {
  check(Array.isArray(list) && list.length <= 100, 'expected at most 100 entries')
  const seen = new Set<string>()
  for (const item of list) {
    check(item && typeof item.id === 'string' && ID.test(item.id), 'invalid entry ID')
    check(!seen.has(item.id), 'duplicate entry ID')
    seen.add(item.id)
    validate(item)
  }
}
export function validateVariableDefinition(value: VariableDefinition): void {
  check(value && text(value.name), 'a name is required')
  check(number(value.min) && number(value.max) && value.min < value.max, 'invalid numeric bounds')
  check(
    Number.isInteger(value.precision) && value.precision >= 0 && value.precision <= 6,
    'precision must be 0–6'
  )
  const scale = 10 ** value.precision
  check(
    Math.round(value.min * scale) / scale === value.min &&
      Math.round(value.max * scale) / scale === value.max,
    'bounds must match the precision'
  )
  entries(value.bands, (band) => {
    check(
      number(band.min) &&
        number(band.max) &&
        band.min <= band.max &&
        band.min >= value.min &&
        band.max <= value.max,
      'context band is outside the bounds'
    )
    check(text(band.text), 'context band text is required')
  })
  entries(value.modifiers, (modifier) => {
    check(
      text(modifier.name) && text(modifier.condition),
      'modifier name and condition are required'
    )
    check(
      number(modifier.delta) && modifier.delta !== 0,
      'modifier adjustment must be a nonzero number'
    )
    check(
      Math.round(modifier.delta * scale) / scale === modifier.delta,
      'modifier adjustment must match the precision'
    )
  })
}
export function validateVariableInstances(value: VariableInstance[]): void {
  entries(value, (instance) => {
    check(text(instance.classId) && text(instance.name), 'variable name and class are required')
    check(
      instance.classSnapshot &&
        Number.isInteger(instance.classSnapshot.revision) &&
        instance.classSnapshot.revision > 0,
      'class snapshot is required'
    )
    check(
      instance.bands === undefined || Array.isArray(instance.bands),
      'invalid context band override'
    )
    check(
      instance.modifiers === undefined || Array.isArray(instance.modifiers),
      'invalid modifier override'
    )
    validateVariableDefinition(instance.classSnapshot)
    const definition = {
      ...instance.classSnapshot,
      bands: instance.bands ?? instance.classSnapshot.bands,
      modifiers: instance.modifiers ?? instance.classSnapshot.modifiers,
    }
    validateVariableDefinition(definition)
    check(
      number(instance.initial) &&
        instance.initial >= definition.min &&
        instance.initial <= definition.max,
      'starting value is outside the bounds'
    )
    check(
      normalizeVariableValue(definition, instance.initial) === instance.initial,
      'starting value must match the precision'
    )
  })
}
export function normalizeVariableValue(
  def: Pick<VariableDefinition, 'min' | 'max' | 'precision'>,
  value: number
): number {
  check(Number.isFinite(value), 'value must be finite')
  const clamped = Math.max(def.min, Math.min(def.max, value))
  return Math.max(def.min, Math.min(def.max, Number(clamped.toFixed(def.precision))))
}
export function resolveVariables(
  owners: Array<{
    _id: string
    name: string
    kind: 'character' | 'scenario'
    variables?: VariableInstance[]
  }>,
  classes: VariableClass[],
  mainCharacterName: string,
  previous: ResolvedVariable[] = []
): ResolvedVariable[] {
  const result: ResolvedVariable[] = []
  const seen = new Set<string>()
  for (const owner of owners) {
    validateVariableInstances(owner.variables || [])
    for (const instance of owner.variables || []) {
      const cls = classes.find((item) => item._id === instance.classId) || instance.classSnapshot
      const def = {
        ...cls,
        name: instance.name,
        bands: instance.bands ?? cls.bands,
        modifiers: instance.modifiers ?? cls.modifiers,
      }
      validateVariableDefinition(def)
      const id = `${owner.kind}:${owner._id}:${instance.id}`
      if (seen.has(id)) continue
      seen.add(id)
      result.push({
        name: def.name,
        min: def.min,
        max: def.max,
        precision: def.precision,
        bands: def.bands.map((b) => ({ ...b })),
        modifiers: def.modifiers.map((m) => ({ ...m })),
        id,
        instanceId: instance.id,
        classId: instance.classId,
        revision: cls.revision,
        ownerId: owner._id,
        ownerKind: owner.kind,
        ownerName: owner.kind === 'character' ? owner.name : mainCharacterName,
        ownerLabel: owner.name,
        initial: normalizeVariableValue(
          def,
          previous.find((item) => item.id === id)?.initial ?? instance.initial
        ),
      })
    }
  }
  check(result.length <= 100, 'at most 100 variables may be active')
  return result
}
export function validateResolvedVariables(value: ResolvedVariable[]): void {
  check(Array.isArray(value) && value.length <= 100, 'invalid chat snapshot')
  const seen = new Set<string>()
  for (const variable of value) {
    validateVariableDefinition(variable)
    check(text(variable.id) && !seen.has(variable.id), 'invalid or duplicate variable ID')
    check(
      text(variable.ownerName) &&
        text(variable.ownerId) &&
        text(variable.classId) &&
        text(variable.instanceId),
      'invalid variable owner'
    )
    check(
      variable.ownerKind === 'character' || variable.ownerKind === 'scenario',
      'invalid owner kind'
    )
    check(Number.isInteger(variable.revision) && variable.revision > 0, 'invalid class revision')
    check(
      number(variable.initial) &&
        normalizeVariableValue(variable, variable.initial) === variable.initial,
      'invalid starting value'
    )
    seen.add(variable.id)
  }
}
/** Read the entire selected branch, never the token-limited prompt history. */
export function variableState(
  defs: ResolvedVariable[],
  messages: VariableMessage[],
  leafId?: string
): Record<string, number> {
  let branch = messages
  if (leafId) {
    const byId = new Map(messages.map((msg) => [msg._id, msg]))
    branch = []
    const seen = new Set<string>()
    let current = byId.get(leafId)
    while (current && !seen.has(current._id)) {
      seen.add(current._id)
      branch.unshift(current)
      current = current.parent ? byId.get(current.parent) : undefined
    }
  }
  const state: Record<string, number> = Object.fromEntries(defs.map((def) => [def.id, def.initial]))
  for (const msg of branch) {
    const result = msg.json?.variables
    if (!Array.isArray(result?.changes)) continue
    for (const change of result.changes) {
      if (!change || !Array.isArray(change.modifierIds)) continue
      const def = defs.find((item) => item.id === change.variableId)
      if (!def) continue
      // Manual changes set an absolute value; generated changes replay their recorded adjustment.
      const value = change.modifierIds.length
        ? state[def.id] + (change.delta ?? change.after - change.before)
        : change.after
      if (Number.isFinite(value)) state[def.id] = normalizeVariableValue(def, value)
    }
  }
  return state
}
/** Stable names stay short enough for provider schemas without exposing display names. */
export function modifierField(variableId: string, modifierId: string): string {
  let hash = 14695981039346656037n
  for (const char of `${variableId}\0${modifierId}`) {
    hash ^= BigInt(char.codePointAt(0)!)
    hash = BigInt.asUintN(64, hash * 1099511628211n)
  }
  return VARIABLE_PREFIX + hash.toString(16).padStart(16, '0')
}
export function variableFields(defs: ResolvedVariable[]): JsonField[] {
  const fields = defs.flatMap((def) =>
    def.modifiers.map((modifier) => ({
      name: modifierField(def.id, modifier.id),
      disabled: false,
      type: {
        type: 'bool' as const,
        description: `${def.ownerName}: ${def.name}. Apply ${modifier.name} (${
          modifier.delta > 0 ? '+' : ''
        }${modifier.delta}) only when: ${modifier.condition}`,
      },
    }))
  )
  check(
    new Set(fields.map((field) => field.name)).size === fields.length,
    'modifier field collision'
  )
  return fields
}
export function assertVariableSupport(
  service?: string,
  format?: string,
  subscriptionCapable?: boolean
): void {
  const supported =
    ['openai', 'openrouter'].includes(service || '') ||
    [
      'openai',
      'openai-chat',
      'openai-chatv2',
      'lm-studio',
      'gemini',
      'llamacpp',
      'arli',
      'vllm',
      'tabby',
    ].includes(format || '') ||
    (service === 'agnaistic' && subscriptionCapable === true)
  check(
    supported,
    'this provider does not advertise structured output support. Choose a compatible provider or disable automatic variable updates in the Variables panel.'
  )
}
export function withVariableSchema(
  schema: ResponseSchema | undefined,
  defs: ResolvedVariable[]
): ResponseSchema {
  const fields = schema?.schema || []
  check(
    !fields.some((field) => field.name.startsWith(VARIABLE_PREFIX)),
    'schema uses reserved variable field names'
  )
  return {
    response: schema?.response || '{{response}}',
    history: schema?.history || '{{response}}',
    imageCaption: schema?.imageCaption || '',
    systemPrompt: schema?.systemPrompt || '',
    jailbreak: schema?.jailbreak || '',
    schema: [...fields, ...variableFields(defs)],
  }
}
export function applyVariableModifiers(
  defs: ResolvedVariable[],
  before: Record<string, number>,
  selections: Record<string, unknown>
): VariableResult {
  check(
    selections && typeof selections === 'object' && !Array.isArray(selections),
    'invalid modifier output'
  )
  const allowed = new Set(variableFields(defs).map((field) => field.name))
  for (const key of Object.keys(selections))
    check(!key.startsWith(VARIABLE_PREFIX) || allowed.has(key), 'unknown modifier selection')
  const values: Record<string, number> = {}
  const changes: VariableChange[] = []
  for (const def of defs) {
    const start = normalizeVariableValue(def, before[def.id] ?? def.initial)
    const selected: VariableModifier[] = []
    for (const modifier of def.modifiers) {
      const value = selections[modifierField(def.id, modifier.id)]
      check(
        typeof value === 'boolean',
        `missing or invalid modifier selection for ${def.name}: ${modifier.name}`
      )
      if (value) selected.push(modifier)
    }
    const after = normalizeVariableValue(
      def,
      start + selected.reduce((sum, modifier) => sum + modifier.delta, 0)
    )
    values[def.id] = after
    if (selected.length)
      changes.push({
        variableId: def.id,
        modifierIds: selected.map((m) => m.id),
        delta: selected.reduce((sum, modifier) => sum + modifier.delta, 0),
        before: start,
        after,
      })
  }
  return { values, changes }
}
export function finalizeVariableOutput(
  output: JsonOutput,
  defs: ResolvedVariable[],
  before: Record<string, number>
): JsonOutput {
  check(
    output && typeof output.response === 'string' && output.response.trim().length > 0,
    'the model response is empty'
  )
  const variables = applyVariableModifiers(defs, before, output.values)
  const values = Object.fromEntries(
    Object.entries(output.values).filter(([key]) => !key.startsWith(VARIABLE_PREFIX))
  )
  return { ...output, values, variables }
}
export function variableContext(
  defs: ResolvedVariable[],
  state: Record<string, number>,
  userName = 'You',
  automaticUpdates = true
): string {
  if (!defs.length) return ''
  const lines = [
    '[Chat variables]',
    automaticUpdates
      ? 'Use the current values and context below. Select each modifier only if its condition occurs in this turn; otherwise return false. Do not repeat a change from an earlier turn. Agnai calculates the new values after your response.'
      : 'Use these current values and context. Automatic variable updates are disabled.',
  ]
  for (const def of defs) {
    const value = state[def.id] ?? def.initial
    const replace = (text: string) =>
      text.replace(/{{char}}/gi, () => def.ownerName).replace(/{{user}}/gi, () => userName)
    lines.push(
      `${
        def.ownerKind === 'character' ? def.ownerName : `Scenario: ${def.ownerLabel || def.ownerId}`
      } — ${def.name}: ${value} (range ${def.min} to ${def.max})`
    )
    for (const band of def.bands) {
      if (value >= band.min && value <= band.max) lines.push(replace(band.text))
    }
    if (automaticUpdates)
      for (const modifier of def.modifiers)
        lines.push(
          `${modifierField(def.id, modifier.id)}: ${replace(modifier.condition)} → ${
            modifier.delta > 0 ? '+' : ''
          }${modifier.delta}`
        )
  }
  return lines.join('\n')
}
