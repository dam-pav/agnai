import { expect } from 'chai'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { runInNewContext } from 'vm'
import ts from 'typescript'

// Exercise the browser entry point while prompt preparation is held pending.
function fixture() {
  const gates: Array<{ reject: (error: Error) => void }> = []
  let state: any = {}
  const stores: any = {
    responses: { getState: () => state },
    chat: {
      getState: () => ({ lastChatId: 'chat', details: { chat: { chat: { _id: 'chat' } } } }),
    },
    user: { getState: () => ({ ui: {} }) },
  }
  const dependencies: Record<string, any> = {
    '../create': { getStore: (name: string) => stores[name] },
    './common': {
      getPromptEntities: () => new Promise((_resolve, reject) => gates.push({ reject })),
    },
    './storage': {
      localApi: { result: (result: any) => ({ result }), error: (error: any) => ({ error }) },
    },
    '/common/prompt': { registerTemplateLocator: () => {} },
    '/common/debug': { debug: () => () => {} },
    '/common/util': { inline: () => '' },
    '/web/emitter': {
      EVENTS: { setWaiting: 'waiting' },
      events: { emit: (_event: string, waiting: any) => (state = { waiting }) },
    },
    'iconv-lite': { enableStreamingAPI: () => {} },
  }
  const source = readFileSync(resolve(__dirname, '../web/store/data/bot-generate.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const exports: any = {}
  runInNewContext(compiled, {
    exports,
    require: (name: string) => dependencies[name] || {},
    localStorage: {},
    console: { error: () => {}, log: () => {} },
    Date,
  })
  return {
    gates,
    state: () => state,
    cancel: () => {
      state.waiting.signal.abort()
      state = {}
    },
    generate: (signal = new AbortController()) =>
      exports.botGen.streamResponse({ kind: 'request', characterId: 'character', signal }),
  }
}

describe('generation lifecycle', () => {
  it('marks prompt preparation as pending immediately and blocks another participant request', async () => {
    const app = fixture()
    const first = app.generate()
    expect(app.state().waiting.phase).to.equal('preparing')
    expect(app.gates.length).to.equal(1)
    const second = await app.generate()
    expect(second.error).to.contain('already being generated')
    expect(app.gates.length).to.equal(1)
    app.cancel()
    app.gates[0].reject(new Error('Preparation finished after cancellation'))
    await first
    expect(app.state().waiting).to.equal(undefined)
  })

  it('does not let a cancelled preparation clear the state of a newer request', async () => {
    const app = fixture()
    const first = app.generate()
    app.cancel()
    const newerSignal = new AbortController()
    const newer = app.generate(newerSignal)
    app.gates[0].reject(new Error('Old preparation finished'))
    await first
    expect(app.state().waiting.signal).to.equal(newerSignal)
    app.cancel()
    app.gates[1].reject(new Error('New preparation finished'))
    await newer
  })

  it('clears the pending state after a preparation error', async () => {
    const app = fixture()
    const result = app.generate().catch((error: Error) => error)
    app.gates[0].reject(new Error('Preparation failed'))
    expect((await result).message).to.equal('Preparation failed')
    expect(app.state().waiting).to.equal(undefined)
  })

  it('does not start preparing an already cancelled generation', async () => {
    const app = fixture()
    const signal = new AbortController()
    signal.abort()
    await app.generate(signal)
    expect(app.gates.length).to.equal(0)
    expect(app.state().waiting).to.equal(undefined)
  })
})
