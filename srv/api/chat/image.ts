import { assertValid } from '/common/valid'
import { AppRequest, handle } from '../wrap'
import { joinUrl } from '/common/requests/util'
import { decryptText } from '/srv/db/util'
import { swarmApi } from '/common/requests/swarmui'
import { resolveComfyHost } from '/srv/image/comfy-network'

export const getSdModelList = handle(async (req, res) => {
  assertValid({ url: 'string', key: 'string?', providerId: 'string?' }, req.body)
  const models = await getSDModels(req, req.body)
  return models
})

export const getComfyOptions = handle(async (req) => {
  assertValid({ url: 'string' }, req.body)

  const { baseUrl, headers } = await resolveComfyHost(req.body.url)
  const url = joinUrl(baseUrl, '/object_info')
  const result = await fetch(url, { headers: { ...headers, accept: 'application/json' } })
  if (!result.ok) {
    throw new Error(`ComfyUI options request failed (${result.status}): ${result.statusText}`)
  }

  const info = (await result.json()) as Record<string, any>
  return {
    checkpoints: getComfyChoices(info, 'CheckpointLoaderSimple', 'ckpt_name'),
    samplers: getComfyChoices(info, 'KSampler', 'sampler_name'),
    schedulers: getComfyChoices(info, 'KSampler', 'scheduler'),
  }
})

export const getImageModelList = handle(async (req) => {
  assertValid({ type: 'string', url: 'string', key: 'string?', providerId: 'string?' }, req.body)

  try {
    switch (req.body.type) {
      case 'swarm': {
        const models = await swarmApi.getModelList(req.body.url)
        return models
      }

      case 'sd': {
        const models = await getSDModels(req, req.body)
        return models
      }
    }
  } catch (ex) {}

  return { models: [] }
})

async function getSDModels(
  req: AppRequest,
  opts: { url: string; key?: string; providerId?: string }
) {
  try {
    const url = joinUrl(opts.url, '/sdapi/v1/sd-models')
    const headers: any = { accept: 'application/json' }

    if (opts.key) {
      headers.Authorization = `Bearer ${opts.key}`
    } else if (opts.providerId) {
      const provider = req.authed?.providers?.find((p) => p._id === opts.providerId)
      const key = decryptText(provider?.key || '', true)
      if (key) {
        headers.Authorization = `Bearer ${key}`
      }
    }

    const result = await fetch(url, { method: 'get', headers })
    const json = await result.json()

    if (!Array.isArray(json)) {
      return { models: [], data: json }
    }

    return { models: json }
  } catch (ex) {}

  return { models: [] }
}

function getComfyChoices(info: Record<string, any>, node: string, input: string): string[] {
  const choices = info[node]?.input?.required?.[input]?.[0]
  if (!Array.isArray(choices)) return []
  return choices.filter((value): value is string => typeof value === 'string')
}
