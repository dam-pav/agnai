export const comfyApi = {
  getSystemInfo,
  getHistory,
  getQueue,
  interrupt,
  clearQueue,
}

async function getSystemInfo(hostname: string) {
  const res = await fetch(getUrl({ host: hostname, path: '/object_info' }))
  return await res.json()
}

async function getHistory(hostname: string, promptId?: string) {
  const path = promptId ? `/history/${encodeURIComponent(promptId)}` : '/history'
  const res = await fetch(getUrl({ host: hostname, path }))
  return await res.json()
}

async function getQueue(hostname: string) {
  const res = await fetch(getUrl({ host: hostname, path: '/queue' }))
  return await res.json()
}

async function interrupt(hostname: string) {
  const res = await fetch(getUrl({ host: hostname, path: '/interrupt' }), { method: 'post' })
  return await res.json()
}

async function clearQueue(hostname: string) {
  const res = await fetch(getUrl({ host: hostname, path: '/queue' }), {
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clear: true }),
  })
  return await res.json()
}

function getUrl({ host, path }: { host: string; path: string }) {
  const baseUrl = host.endsWith('/') ? host.slice(0, -1) : host
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${baseUrl}${cleanPath}`
}
