import { expect } from 'chai'
import { createServer, Server } from 'http'
import { browserSSE } from '../common/requests/browser-sse'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

describe('browser streaming transport', () => {
  let server: Server
  let url: string

  beforeEach(async () => {
    server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    url = `http://127.0.0.1:${address.port}/chat/completions`
  })

  afterEach(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  function request(timeoutMs: number, signal?: AbortSignal) {
    const events: Array<[string, any?]> = []
    const headers = deferred()
    const promise = browserSSE({
      url,
      headers: {},
      body: { prompt: 'test prompt', stream: true },
      timeoutMs,
      signal,
      onHeaders: () => {
        events.push(['headers'])
        headers.resolve()
      },
      onJson: (json) => {
        events.push(['json', json])
        return !!json.choices?.[0]?.finish_reason
      },
      onDone: () => events.push(['done']),
      onAbort: () => events.push(['abort']),
      onError: (error) => events.push(['error', error]),
    })
    return { events, promise, headers: headers.promise }
  }

  it('sends the prompt immediately and waits past 10 seconds for headers', async function () {
    this.timeout(15000)
    const received = deferred<string>()
    const release = deferred()
    server.on('request', async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      received.resolve(body)
      await release.promise
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end('data: {"token":"reply"}\n\ndata: [DONE]\n\n')
    })
    const stream = request(120000)
    expect(JSON.parse(await received.promise).prompt).to.equal('test prompt')
    expect(stream.events).to.deep.equal([])
    await new Promise((resolve) => setTimeout(resolve, 10500))
    expect(stream.events).to.deep.equal([])
    release.resolve()
    await stream.promise
    expect(stream.events).to.deep.equal([['headers'], ['json', { token: 'reply' }], ['done']])
  })

  it('reports a header timeout once and closes the provider connection', async () => {
    const closed = deferred()
    server.on('request', (_req, res) => res.on('close', () => closed.resolve()))
    const stream = request(100)
    await stream.promise
    await closed.promise
    expect(stream.events).to.deep.equal([
      ['error', 'No response headers received within 0.1 seconds'],
    ])
  })

  it('does not apply the header timeout to an established stream', async () => {
    const release = deferred()
    server.on('request', async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.flushHeaders()
      await release.promise
      res.end('data: [DONE]\n\n')
    })
    const stream = request(100)
    await stream.headers
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(stream.events).to.deep.equal([['headers']])
    release.resolve()
    await stream.promise
    expect(stream.events).to.deep.equal([['headers'], ['done']])
  })

  for (const sendHeaders of [false, true]) {
    it(`cancels the actual HTTP request ${
      sendHeaders ? 'during streaming' : 'before headers'
    }`, async () => {
      const received = deferred()
      const closed = deferred()
      server.on('request', (_req, res) => {
        res.on('close', () => closed.resolve())
        if (sendHeaders) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          res.flushHeaders()
        }
        received.resolve()
      })
      const controller = new AbortController()
      const stream = request(0, controller.signal)
      await received.promise
      if (sendHeaders) await stream.headers
      controller.abort()
      await stream.promise
      await closed.promise
      expect(stream.events).to.deep.equal(sendHeaders ? [['headers'], ['abort']] : [['abort']])
    })
  }

  it('does not send an already cancelled request', async () => {
    let requests = 0
    server.on('request', () => requests++)
    const controller = new AbortController()
    controller.abort()
    const stream = request(100, controller.signal)
    await stream.promise
    expect(requests).to.equal(0)
    expect(stream.events).to.deep.equal([['abort']])
  })

  it('preserves UTF-8 and events split across chunks, and finishes only once', async () => {
    server.on('request', async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const bytes = Buffer.from(
        ': keepalive\r\n\r\ndata: {"token":"č🙂"}\r\n\r\ndata: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
      )
      for (const byte of bytes) {
        if (res.destroyed) break
        res.write(Buffer.from([byte]))
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      res.end()
    })
    const stream = request(1000)
    await stream.promise
    expect(stream.events).to.deep.equal([
      ['headers'],
      ['json', { token: 'č🙂' }],
      ['json', { choices: [{ finish_reason: 'stop' }] }],
      ['done'],
    ])
  })

  it('reports an incomplete stream as an error instead of saving it as complete', async () => {
    server.on('request', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end('data: {"token":"partial"}\n\n')
    })
    const stream = request(1000)
    await stream.promise
    expect(stream.events).to.deep.equal([
      ['headers'],
      ['json', { token: 'partial' }],
      ['error', 'Stream interrupted before completion'],
    ])
  })
})
