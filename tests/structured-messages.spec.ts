import './init'
import { expect } from 'chai'
import { toChatMessages } from '../common/template-messages'
import { GenerateRequestV2 } from '../srv/adapter/type'
import { entities } from './util'
import { templates } from '../common/presets/templates'

function request(structured = true): GenerateRequestV2 {
  const { chat, main, user, profile } = entities
  return {
    requestId: 'structured-test',
    kind: 'retry',
    chat,
    char: main,
    replyAs: main,
    user,
    sender: profile,
    members: [],
    characters: {},
    lines: ['You: Hello'],
    history: [{ _id: 'user', role: 'user', msg: 'You: Hello', json: {} }],
    settings: {
      service: 'kobold',
      maxContextLength: 4096,
      maxTokens: 128,
      useAdvancedPrompt: 'no-validation',
      gaslight: templates.Universal,
    },
    parts: {
      persona: '',
      allPersonas: [],
      chatEmbeds: [],
      userEmbeds: [],
      post: [`${main.name}:`],
      prefill: 'A character prefill',
    },
    jsonSchema: structured
      ? {
          fields: [
            { name: 'response', type: { type: 'string' }, disabled: false },
            { name: 'warming', type: { type: 'bool' }, disabled: false },
          ],
          entities: { char: main },
        }
      : undefined,
  }
}

describe('Structured chat messages', () => {
  it('ends JSON requests with a user instruction and omits plaintext assistant prefixes', async () => {
    const req = request()
    const result = await toChatMessages(req, async (text) => text.length)
    expect(result.messages.at(-1)?.role).to.equal('user')
    expect(result.messages.at(-1)?.content).to.include('JSON object matching the response schema')
    expect(JSON.stringify(result.messages)).not.to.include('A character prefill')
    expect(result.assembled.prompt).not.to.include(`${req.replyAs.name}:`)
    expect(req.parts.prefill).to.equal('A character prefill')
  })
  it('preserves custom post instructions as user instructions', async () => {
    const req = request()
    req.parts.post.unshift('Describe the weather.')
    const { messages } = await toChatMessages(req, async (text) => text.length)
    expect(messages.at(-1)?.role).to.equal('user')
    expect(messages.at(-1)?.content).to.include('Describe the weather.')
  })
  it('starts a fresh structured response when continuing an assistant turn', async () => {
    const req = request()
    req.kind = 'continue'
    req.lines = ['You: Hello', 'MainChar: Earlier reply.']
    req.history!.push({ _id: 'bot', role: 'model', msg: 'MainChar: Earlier reply.', json: {} })
    req.settings!.skipRoleMerging = true
    const { messages } = await toChatMessages(req, async (text) => text.length)
    expect(messages.at(-2)?.role).to.equal('assistant')
    expect(messages.at(-1)?.role).to.equal('user')
    expect(messages.at(-1)?.content).to.include('Continue the previous assistant reply')
  })
  it('adds a JSON instruction even when a custom template omits the post placeholder', async () => {
    const req = request()
    req.settings!.gaslight = '<system>Stay in character.</system>\n{{history}}'
    const { messages } = await toChatMessages(req, async (text) => text.length)
    expect(messages.at(-1)?.role).to.equal('user')
    expect(messages.at(-1)?.content).to.include('JSON object')
  })
  it('retains existing prefixes and prefills for ordinary prose generation', async () => {
    const req = request(false)
    const { messages } = await toChatMessages(req, async (text) => text.length)
    expect(messages.at(-1)?.role).to.equal('assistant')
    expect(messages.at(-1)?.content)
      .to.include(`${req.replyAs.name}:`)
      .and.include('A character prefill')
  })
})
