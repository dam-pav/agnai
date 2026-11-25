/** Send immediately; the timeout only limits how long we wait for response headers. */
export async function browserSSE(opts: {
  url: string
  body: any
  headers: Record<string, string>
  signal?: AbortSignal
  timeoutMs: number
  onHeaders: (status: number) => void
  onJson: (json: any) => boolean | void
  onDone: () => void
  onAbort: () => void
  onError: (error: string) => void
}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  let timedOut = false
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true
        controller.abort()
      }, opts.timeoutMs)
    : undefined

  opts.signal?.addEventListener('abort', abort, { once: true })
  if (opts.signal?.aborted) controller.abort()

  try {
    if (controller.signal.aborted) {
      opts.onAbort()
      return
    }

    const response = await fetch(opts.url, {
      method: 'POST',
      headers: {
        ...opts.headers,
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(opts.body),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!response.ok) {
      throw new Error(`Streaming request failed with status code ${response.status}`)
    }
    opts.onHeaders(response.status)
    if (!response.body) throw new Error('Streaming response body is empty')

    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) throw new Error('Stream interrupted before completion')
      buffer += decoder.decode(value, { stream: true })

      let boundary: RegExpExecArray | null
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n')
        if (!data) continue // SSE comments and keep-alives.
        if (data === '[DONE]') {
          opts.onDone()
          return
        }
        const json = JSON.parse(data)
        if (json.error) {
          throw new Error(json.error.message || String(json.error))
        }
        if (opts.onJson(json)) {
          opts.onDone()
          return
        }
      }
    }
  } catch (err: any) {
    if (timedOut) {
      opts.onError(`No response headers received within ${opts.timeoutMs / 1000} seconds`)
    } else if (opts.signal?.aborted) {
      opts.onAbort()
    } else {
      opts.onError(err?.message || String(err))
    }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', abort)
    controller.abort()
    await reader?.cancel().catch(() => {})
  }
}
