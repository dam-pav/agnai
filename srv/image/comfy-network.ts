import { lookup } from 'dns/promises'
import { isIP } from 'net'

const DNS_CACHE_TTL_MS = 5 * 60 * 1000

type CachedAddress = {
  address: string
  expires: number
}

const addressCache = new Map<string, CachedAddress>()

export async function resolveComfyHost(input: string) {
  const url = new URL(input)
  const originalHost = url.host

  // Replacing the hostname would break TLS certificate validation. HTTPS
  // endpoints retain their original URL and use Node's normal resolver.
  if (url.protocol !== 'http:' || isIP(url.hostname)) {
    return { baseUrl: trimSlash(url.toString()), headers: {} as Record<string, string> }
  }

  const address = await getAddress(url.hostname)
  url.hostname = address

  return {
    baseUrl: trimSlash(url.toString()),
    headers: { Host: originalHost },
  }
}

async function getAddress(hostname: string) {
  const cached = addressCache.get(hostname)
  if (cached && cached.expires > Date.now()) return cached.address

  const result = await lookup(hostname)
  addressCache.set(hostname, {
    address: result.address,
    expires: Date.now() + DNS_CACHE_TTL_MS,
  })
  return result.address
}

function trimSlash(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url
}
