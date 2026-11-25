import Cookies from 'js-cookie'
import { EVENTS, events } from '../emitter'
import { jwtDecode } from 'jwt-decode'
import { browserSSE } from '/common/requests/browser-sse'
import { getStore } from './create'
import { parseSearchQuery } from '/common/util'
import type { TickHandler } from '/common/prompt'
import { getNextThoughts, getNextTokens, joinThoughtTokens, joinUrl } from '/common/requests/util'

let socketId = ''

export function setSocketId(id: string) {
  socketId = id
}

const PROTO = location.protocol
const HOST = location.hostname.toLowerCase()
const PORT = location.port

// Sometimes a user has DNS issues with a particular API url.
// We can provide them a `?api_url=...` url to try alternate API urls
if (location.search && typeof localStorage !== 'undefined') {
  const search = parseSearchQuery(location.search)
  if (search.api_url && search.api_url.endsWith('.agnai.chat')) {
    localStorage.setItem('api_url', search.api_url)
  }
}

const API_OVERRIDE = typeof localStorage !== 'undefined' ? localStorage.getItem('api_url') : ''

export const baseUrl = API_OVERRIDE
  ? `${PROTO}//${API_OVERRIDE}`
  : PORT === '1234' || PORT === '3001' // || HOST === 'localhost' || HOST === '127.0.0.1'
  ? `${PROTO}//${HOST}:3001`
  : HOST === 'agnai.chat'
  ? `${PROTO}//edge-api.agnai.chat`
  : HOST === 'prd-assets.agnai.chat'
  ? `${PROTO}//prd-api.agnai.chat`
  : HOST === 'dev.agnai.chat' || HOST === 'dev-assets.agnai.chat'
  ? `${PROTO}//edge-api.agnai.chat`
  : HOST === 'stg.agnai.chat'
  ? `${PROTO}//stg-api.agnai.chat`
  : location.origin

export const api = {
  get,
  post,
  callApi,
  method,
  upload,
  streamGet,
  streamPost,
  toApiUrl,
  fetchSSE,
  localSSE,
  isCdnApi,
  getFallbackApiUrl,
}

type Query = { [key: string]: string | number | undefined | boolean }

function getFallbackApiUrl() {
  if (baseUrl.includes('prd-api.agnai.chat')) {
    return 'api.agnai.chat'
  }

  if (baseUrl.includes('/api.agnai.chat')) {
    return 'edge-api.agnai.chat'
  }
}

function isCdnApi() {
  return baseUrl.includes('edge-api.agnai.chat')
}

async function method<T = any>(
  method: 'get' | 'post' | 'delete' | 'put',
  path: string,
  body = {},
  opts?: RequestInit & { noAuth?: boolean }
) {
  if (method === 'get') {
    return get<T>(path, body)
  }

  return callApi<T>(path, {
    method,
    ...opts,
    body: JSON.stringify(body),
  })
}

async function get<T = any>(path: string, query: Query = {}) {
  const params = Object.keys(query)
    .map((key) => `${key}=${query[key]}`)
    .join('&')

  const infix = path.includes('?') ? '&' : '?'
  let url = params ? `${path}${infix}${params}` : path

  return callApi<T>(url, {
    method: 'get',
  })
}

async function post<T = any>(path: string, body = {}) {
  return callApi<T>(path, {
    method: 'post',
    body: JSON.stringify(body),
  })
}

async function upload<T = any>(path: string, form: FormData) {
  const result = await callApi<T>(path, {
    method: 'post',
    body: form,
    headers: {
      Authorization: `Bearer ${getAuth()}`,
    },
  })
  return result
}

async function streamGet<T = any>(path: string, query: Query) {
  const params = Object.keys(query)
    .map((key) => `${key}=${query[key]}`)
    .join('&')

  return callApiStream<T>(`${path}?${params}`, { method: 'get' })
}

async function streamPost<T = any>(path: string, body: any) {
  return callApiStream<T>(path, {
    method: 'post',
    body: JSON.stringify(body),
  })
}

function toApiUrl(path: string) {
  const prefix = path.startsWith('/') ? '/api' : '/api'
  const fullUrl = path.startsWith('http') ? path : `${baseUrl}${prefix}${path}`
  return fullUrl
}

async function callApi<T = any>(
  path: string,
  opts: RequestInit & { noAuth?: boolean }
): Promise<{ result: T | undefined; status: number; error?: string }> {
  const prefix = path.startsWith('/') ? '/api' : '/api'
  const fullUrl = path.startsWith('http') ? path : `${baseUrl}${prefix}${path}`
  const res = await fetch(fullUrl, {
    ...headers(opts?.noAuth),
    ...opts,
  }).catch((err) => ({ error: err }))

  if ('error' in res) {
    if (isSessionExpired() && fullUrl.includes(baseUrl)) {
      events.emit(EVENTS.sessionExpired)
      return {
        result: undefined,
        status: 401,
        error: 'Your session has expired. Please login again.',
      }
    }

    return { result: undefined, status: 503, error: res.error.message || res.error }
  }

  const json = await res.json()

  const msg = json?.message || ''
  if (json.user_banned === true) {
    events.emit(EVENTS.userBanned, msg)
    return { result: undefined, status: res.status, error: msg }
  }

  if (res.status === 401 && fullUrl.includes(baseUrl)) {
    events.emit(EVENTS.sessionExpired)
    return {
      result: undefined,
      status: 401,
      error: 'Your session has expired. Please login again.',
    }
  }

  if (res.status >= 400) {
    return { result: undefined, status: res.status, error: json.message || res.statusText }
  }

  return { result: json, status: res.status, error: res.status >= 400 ? res.statusText : undefined }
}

type SSEOpts<T = {}> = T & {
  path: string
  headers: any
  body: any
  signal?: AbortController
  onData?: (event: any) => void
  onDone?: () => void
  onError?: (err: any) => void
  onTick?: TickHandler
}

function getStreamOpenTimeoutMs() {
  return (getStore('settings').getState().config.streamOpenTimeout ?? 90) * 1000
}

export function localSSE(opts: SSEOpts<{ host: string }>) {
  let accum = ''
  let thoughts = ''
  const meta: any = {}

  return browserSSE({
    url: joinUrl(opts.host, opts.path),
    body: opts.body,
    headers: opts.headers,
    signal: opts.signal?.signal,
    timeoutMs: getStreamOpenTimeoutMs(),
    onHeaders: (status) => opts.onTick?.(`${status}`, 'headers'),
    onJson: (json) => {
      opts.onData?.(json)
      const changed = getChoiceProp(json, meta, ['model', 'finish_reason', 'provider'])
      if (changed.found) opts.onTick?.('', 'meta', meta)

      const thought = getNextThoughts(json)
      const token = getNextTokens(json) || json?.token || json?.response
      if (thought) {
        thoughts += thought
        opts.onTick?.(thought, 'thought')
      }
      if (token) {
        accum += token
        opts.onTick?.(accum, 'partial')
      }
      return !!changed.matches.finish_reason || !!json.response
    },
    onDone: () => {
      opts.onTick?.(joinThoughtTokens(accum, thoughts), 'done')
      opts.onDone?.()
    },
    onAbort: () => {
      opts.onTick?.(joinThoughtTokens(accum, thoughts), 'done')
      opts.onDone?.()
    },
    onError: (error) => {
      opts.onError?.(error)
      opts.onTick?.(error, 'error')
    },
  })
}

function getChoiceProp<T = any>(json: any, assign: any, props: string[]) {
  let found = false
  let matches: any = {}
  for (const prop of props) {
    const choice = json?.choices?.[0]
    const value = choice?.delta?.[prop] || choice?.[prop] || json?.[prop]
    if (assign && value) {
      if (assign[prop] === value) continue
      matches[prop] = value
      assign[prop] = value
      found = true
    }
  }
  return { found, matches }
}

export function fetchSSE(opts: SSEOpts) {
  let accum = ''
  let thoughts = ''

  return browserSSE({
    url: api.toApiUrl(opts.path),
    body: opts.body,
    headers: opts.headers,
    signal: opts.signal?.signal,
    timeoutMs: getStreamOpenTimeoutMs(),
    onHeaders: (status) => opts.onTick?.(`${status}`, 'headers'),
    onJson: (json) => {
      opts.onData?.(json)
      switch (json.type) {
        case 'message-partial':
        case 'inference-partial':
          accum = json.partial
          opts.onTick?.(accum, 'partial')
          break
        case 'message-error':
        case 'inference-error':
          throw new Error(json.error)
        case 'message-warning':
        case 'inference-warning':
          opts.onTick?.(json.warning, 'warning')
          break
        case 'message-created':
          accum = json.msg.msg
          return true
        case 'message-retry':
          accum = json.message
          return true
        case 'chat-json':
        case 'chat-query':
        case 'inference':
          accum = json.response || accum
          return true
        case 'chat-summary':
          accum = json.summary
          return true
        case 'inference-thought':
          thoughts += json.thoughts
          opts.onTick?.(json.thoughts, 'thought')
          break
        case 'inference-meta':
        case 'message-meta':
          opts.onTick?.('', 'meta', json.meta)
          break
      }
    },
    onDone: () => {
      opts.onTick?.(joinThoughtTokens(accum, thoughts), 'done')
      opts.onDone?.()
    },
    onAbort: () => {
      opts.onTick?.(joinThoughtTokens(accum, thoughts), 'done')
      opts.onDone?.()
    },
    onError: (error) => {
      opts.onError?.(error)
      opts.onTick?.(error, 'error')
    },
  })
}

export function getAuthHeaders() {
  const jwt = getAuth()

  const headers: any = { 'Socket-ID': socketId }

  if (jwt) {
    headers.Authorization = `Bearer ${jwt}`
  }

  return headers
}

function headers(noAuth?: boolean) {
  const jwt = getAuth()
  const headers: any = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Socket-ID': socketId,
  }

  if (!noAuth && jwt) {
    headers.Authorization = `Bearer ${jwt}`
  }

  return { headers }
}

async function* callApiStream<T = any>(path: string, opts: RequestInit) {
  const prefix = path.startsWith('/') ? '/api' : '/api'
  const stream = await fetch(`${baseUrl}${prefix}${path}`, {
    ...opts,
    ...headers(),
  }).then((res) => res.body)

  if (!stream) {
    return
  }

  const reader = stream.getReader()
  let done = false
  do {
    const result = await reader.read()
    let done = result.done
    if (done) return
    if (!result.value) {
      yield
      continue
    }

    const buffer = Buffer.from(result.value)
    const str = buffer.toString()
    const responses = str.split('\n\n')
    for (const value of responses) {
      try {
        const json = JSON.parse(value)
        yield json
      } catch (ex) {
        yield value
      }
    }
  } while (!done)
}

export function setAuth(jwt: string) {
  Cookies.set('auth', jwt, { sameSite: 'strict', expires: 120 })
}

function isSessionExpired() {
  const jwt = getAuth()

  // No jwt = no session
  if (!jwt) return false

  const token = getTokenBody(jwt)
  const expiry = new Date(token.exp * 1000)

  return Date.now() > expiry.valueOf()
}

export function getAuth() {
  return Cookies.get('auth')
}

export function clearAuth() {
  Cookies.remove('auth')
}

export function isLoggedIn() {
  return !!getAuth()
}

export function getUserId() {
  const auth = getAuth()
  if (!auth) return 'anon'

  const data = getTokenBody(auth)
  return data?.userId
}

function getTokenBody(jwt: string) {
  const data = jwtDecode(jwt)
  return data as { admin: boolean; exp: number; iat: number; userId: string; username: string }
}

export function setAltAuth(jwt: string) {
  const prev = Cookies.get('auth')
  if (!prev) {
    return new Error(`Could not get previous auth`)
  }

  Cookies.set('original-auth', prev, { sameSite: 'strict', expires: 30 })
  Cookies.set('auth', jwt, { sameSite: 'strict', expires: 30 })
  location.href = `${location.origin}/settings?tab=3`
}

export function revertAuth() {
  const prev = Cookies.get('original-auth')
  if (!prev) {
    return new Error(`Could not get previous auth`)
  }

  setAuth(prev)
  Cookies.remove('original-auth')
  location.href = `${location.origin}/admin/users`
}

export function isImpersonating() {
  const prev = Cookies.get('original-auth')
  return !!prev
}
