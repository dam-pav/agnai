import './init'
import { expect } from 'chai'
import {
  VariableClass,
  ResolvedVariable,
  VariableMessage,
  VariableInstance,
  normalizeVariableValue,
  validateVariableDefinition,
  validateVariableInstances,
  resolveVariables,
  variableContext,
  variableState,
  modifierField,
  applyVariableModifiers,
  finalizeVariableOutput,
  withVariableSchema,
  assertVariableSupport,
} from '../common/chat-variables'
import {
  prepareJsonSchema,
  getJsonSchemaPayload,
  getJsonDialogue,
  continueJsonDialogue,
} from '../common/guidance/json-schema'
import { injectPlaceholders } from '../common/prompt'
import { parseTemplate } from '../common/template-parser'
import { getThirdPartyPayload } from '../common/requests/payloads'
import { entities } from './util'

const cls: VariableClass = {
  _id: 'temperature',
  kind: 'variable-class',
  userId: 'user',
  revision: 1,
  name: 'Temperature in Celsius',
  min: -50,
  max: 50,
  precision: 1,
  bands: [{ id: 'cold', min: -5, max: 5, text: '{{char}} is very cold' }],
  modifiers: [
    { id: 'warm', name: 'Warming', condition: '{{char}} is exposed to a heat source', delta: 3 },
    { id: 'cool', name: 'Cooling', condition: '{{char}} is exposed to cold', delta: -2 },
  ],
}
const instance: VariableInstance = {
  id: 'body-temperature',
  classId: cls._id,
  name: 'Temperature',
  initial: 0,
  classSnapshot: cls,
}
const owner = { _id: 'alice', kind: 'character' as const, name: 'Alice', variables: [instance] }
const defs = () => resolveVariables([owner], [cls], 'Alice')
const selections = (def: ResolvedVariable, warm: unknown = false, cool: unknown = false) => ({
  [modifierField(def.id, 'warm')]: warm,
  [modifierField(def.id, 'cool')]: cool,
})

describe('Chat variables', () => {
  it('resolves inherited definitions and independent empty overrides without mutating the class', () => {
    const inherited = defs()[0]
    expect(inherited.initial).to.equal(0)
    const overridden = resolveVariables(
      [{ ...owner, variables: [{ ...instance, bands: [] }] }],
      [cls],
      'Alice'
    )[0]
    expect(overridden.bands).to.deep.equal([])
    expect(overridden.modifiers).to.deep.equal(cls.modifiers)
    inherited.bands[0].text = 'changed'
    expect(cls.bands[0].text).to.equal('{{char}} is very cold')
  })
  it('uses portable snapshots when the class is missing, and newest library definitions for new snapshots', () => {
    expect(resolveVariables([owner], [], 'Alice')[0].revision).to.equal(1)
    expect(
      resolveVariables([owner], [{ ...cls, revision: 2, modifiers: [] }], 'Alice')[0].modifiers
    ).to.deep.equal([])
  })
  it('keeps a chat’s starting value when adopting changes to an attachment', () => {
    const previous = defs()
    const next = resolveVariables(
      [{ ...owner, variables: [{ ...instance, initial: 20 }] }],
      [cls],
      'Alice',
      previous
    )
    expect(next[0].initial).to.equal(0)
    expect(
      resolveVariables([{ ...owner, variables: [{ ...instance, initial: 20 }] }], [cls], 'Alice')[0]
        .initial
    ).to.equal(20)
  })
  it('namespaces instances by owner and resolves character context to its owner', () => {
    const result = resolveVariables(
      [owner, { ...owner, _id: 'bob', name: 'Bob' }, { ...owner, _id: 'world', kind: 'scenario' }],
      [cls],
      'Main'
    )
    expect(new Set(result.map((def) => def.id)).size).to.equal(3)
    const context = variableContext(result, variableState(result, []))
    expect(context)
      .to.include('Alice is very cold')
      .and.include('Bob is very cold')
      .and.include('Main is very cold')
    expect(context).not.to.include('{{char}}')
  })
  it('includes both endpoints and every overlapping context band', () => {
    const def = defs()[0]
    def.bands.push({ id: 'other', min: 0, max: 10, text: 'Other text' })
    expect(variableContext([def], { [def.id]: -5 })).to.include('very cold')
    expect(variableContext([def], { [def.id]: 5 }))
      .to.include('very cold')
      .and.include('Other text')
    expect(variableContext([def], { [def.id]: 5.1 })).not.to.include('very cold')
    expect(variableContext([def], {}, 'You', false)).not.to.include(modifierField(def.id, 'warm'))
  })
  it('validates malformed bounds, bands, modifier IDs, precision, and starting values', () => {
    for (const value of [
      { ...cls, min: 50 },
      { ...cls, max: Infinity },
      { ...cls, precision: 7 },
      { ...cls, bands: [{ ...cls.bands[0], min: -51 }] },
      { ...cls, modifiers: [cls.modifiers[0], cls.modifiers[0]] },
      { ...cls, modifiers: [{ ...cls.modifiers[0], delta: 0 }] },
    ])
      expect(() => validateVariableDefinition(value)).to.throw('Chat variables:')
    expect(() => validateVariableInstances([{ ...instance, initial: 51 }])).to.throw()
    expect(() => validateVariableInstances([{ ...instance, initial: 0.01 }])).to.throw()
  })
  it('preserves bounds and normalization idempotence over a broad numeric domain', () => {
    // Deterministic generated coverage without introducing a new testing dependency.
    for (let precision = 0; precision <= 6; precision++) {
      for (let value = -2000; value <= 2000; value++) {
        const def = { min: -50, max: 50, precision }
        const normalized = normalizeVariableValue(def, value / 7)
        expect(normalized).to.be.at.least(-50).and.at.most(50)
        expect(normalizeVariableValue(def, normalized)).to.equal(normalized)
      }
    }
    expect(() => normalizeVariableValue(cls, NaN)).to.throw()
  })
  it('adds selected modifiers together, rounds, clamps, and rejects incomplete or nonboolean output', () => {
    const def = defs()[0]
    expect(
      applyVariableModifiers([def], { [def.id]: 0 }, selections(def, true, true)).values[def.id]
    ).to.equal(1)
    expect(
      applyVariableModifiers([def], { [def.id]: 49 }, selections(def, true)).values[def.id]
    ).to.equal(50)
    expect(() => applyVariableModifiers([def], {}, {})).to.throw('missing or invalid')
    expect(() => applyVariableModifiers([def], {}, selections(def, 'true'))).to.throw(
      'missing or invalid'
    )
    expect(() =>
      applyVariableModifiers([def], {}, { ...selections(def), agnai_var_unknown: true })
    ).to.throw('unknown modifier')
    for (let start = -50; start <= 50; start++) {
      for (const warm of [false, true])
        for (const cool of [false, true]) {
          const result = applyVariableModifiers(
            [def],
            { [def.id]: start },
            selections(def, warm, cool)
          )
          const reversed = { ...def, modifiers: def.modifiers.slice().reverse() }
          expect(
            applyVariableModifiers([reversed], { [def.id]: start }, selections(def, warm, cool))
              .values
          ).to.deep.equal(result.values)
          expect(result.values[def.id]).to.be.at.least(-50).and.at.most(50)
        }
    }
  })
  it('replays only the selected branch and does not apply retries twice', () => {
    const [def] = defs()
    const warm = applyVariableModifiers([def], {}, selections(def, true))
    const cool = applyVariableModifiers([def], {}, selections(def, false, true))
    const messages: VariableMessage[] = [
      { _id: 'root' },
      { _id: 'left', parent: 'root', json: { variables: warm } },
      { _id: 'right', parent: 'root', json: { variables: cool } },
    ]
    expect(variableState([def], messages, 'left')[def.id]).to.equal(3)
    expect(variableState([def], messages, 'right')[def.id]).to.equal(-2)
    expect(variableState([def], messages, 'root')[def.id]).to.equal(0)
    expect(
      variableState(
        [def],
        messages.map((msg) => (msg._id === 'left' ? { ...msg, json: { variables: cool } } : msg)),
        'left'
      )[def.id]
    ).to.equal(-2)
  })
  it('replays adjustments after middle deletion and preserves manual absolute settings', () => {
    const [def] = defs()
    const warm = applyVariableModifiers([def], {}, selections(def, true))
    const next = applyVariableModifiers([def], warm.values, selections(def, true))
    expect(variableState([def], [{ _id: 'next', json: { variables: next } }])[def.id]).to.equal(3)
    const manual = {
      values: { [def.id]: 10 },
      changes: [{ variableId: def.id, modifierIds: [], before: 3, after: 10 }],
    }
    expect(
      variableState(
        [def],
        [
          { _id: 'first', json: { variables: warm } },
          { _id: 'manual', json: { variables: manual } },
          { _id: 'next', json: { variables: next } },
        ]
      )[def.id]
    ).to.equal(13)
  })
  it('merges existing response schemas and removes transport fields from persisted values', () => {
    const [def] = defs()
    const merged = withVariableSchema(
      {
        response: '{{response}} ({{hp}})',
        history: '{{response}}',
        imageCaption: '',
        systemPrompt: '',
        jailbreak: '',
        schema: [{ name: 'hp', type: { type: 'integer' }, disabled: false }],
      },
      [def]
    )
    const prepared = prepareJsonSchema(merged, { char: 'Alice' }, true)!
    const output = prepared.hydrator(
      JSON.stringify({ "Alice's response": 'Hello', hp: 4, ...selections(def, true) })
    )
    const final = finalizeVariableOutput(output, [def], {})
    expect(() => finalizeVariableOutput({ ...output, response: '' }, [def], {})).to.throw(
      'model response is empty'
    )
    expect(final.response).to.equal('Hello (4)')
    expect(getJsonDialogue(final, { char: 'Alice' })).to.equal('Hello')
    const continued = continueJsonDialogue(
      output,
      'Earlier reply.',
      { char: 'Alice' },
      prepared.hydrator
    )
    expect(continued.response).to.equal('Earlier reply. Hello (4)')
    expect(finalizeVariableOutput(continued, [def], {}).variables?.values[def.id]).to.equal(3)
    expect(final.values).to.have.property('hp', 4)
    expect(final.values).to.have.property('response', 'Hello')
    expect(final.values).not.to.have.property(modifierField(def.id, 'warm'))
    expect(final.variables?.values[def.id]).to.equal(3)
    expect(
      getJsonSchemaPayload(prepared.schema, 'openai', { char: 'Alice' }).json_schema.schema
        .properties[modifierField(def.id, 'warm')].type
    ).to.equal('boolean')
  })
  it('keeps zero-valued numeric placeholders', async () => {
    const result = await parseTemplate('Value: {{json.temperature}}', {
      jsonValues: { temperature: 0 },
    })
    expect(result.parsed).to.equal('Value: 0')
  })
  it('sends valid boolean schemas for local and server provider payloads', () => {
    const [def] = defs()
    const prepared = prepareJsonSchema(
      withVariableSchema(undefined, [def]),
      { char: 'Alice' },
      true
    )!
    for (const format of ['openai-chatv2', 'tabby', 'vllm', 'llamacpp'] as const) {
      for (const jsonSchema of [
        prepared.schema,
        { fields: prepared.schema, entities: prepared.entities },
      ]) {
        const payload = getThirdPartyPayload({
          user: entities.user,
          gen: { service: 'kobold', thirdPartyFormat: format },
          jsonSchema: jsonSchema as any,
        })
        const schema =
          payload.response_format?.json_schema?.schema ||
          payload.response_format?.schema ||
          payload.json_schema ||
          payload.guided_json
        expect(schema, format).to.exist
        expect(schema.properties[modifierField(def.id, 'warm')].type, format).to.equal('boolean')
        expect(schema.properties["Alice's response"].maxLength, format).not.to.equal(0)
      }
    }
  })
  it('injects variable context even into custom templates and includes it in the system section', async () => {
    const { chat, main, user, profile } = entities
    const result = await injectPlaceholders('{{history}}', {
      opts: {
        chat,
        char: main,
        replyAs: main,
        sender: profile,
        user,
        members: [],
        settings: { maxContextLength: 1000 },
      },
      parts: {
        variableContext: 'Alice is very cold',
        persona: '',
        allPersonas: [],
        post: [],
        userEmbeds: [],
        chatEmbeds: [],
      },
      lastMessage: '',
      characters: {},
      jsonValues: {},
      lines: ['User: Hello'],
      encoder: async (text) => text.length,
    })
    expect(result.parsed).to.include('Alice is very cold')
    expect(result.sections.strictSystem.join('')).to.include('Alice is very cold')
  })
  it('requires structured-output support for automatic updates', () => {
    expect(() => assertVariableSupport('novel')).to.throw('structured output')
    expect(() => assertVariableSupport('openai')).not.to.throw()
    expect(() => assertVariableSupport(undefined, 'gemini')).not.to.throw()
    expect(() => assertVariableSupport('agnaistic', undefined, true)).not.to.throw()
  })
})
