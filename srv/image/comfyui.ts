import { v4 } from 'uuid'
import { ImageAdapter } from './types'
import { resolveComfyHost } from './comfy-network'

const POLL_INTERVAL_MS = 1000
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000

type ComfyImage = {
  filename: string
  subfolder?: string
  type?: string
}

export const handleComfyImage: ImageAdapter = async (opts) => {
  const { provider } = opts
  if (!provider.url) {
    throw new Error('ComfyUI URL is not configured')
  }
  if (!provider.model) {
    throw new Error('ComfyUI checkpoint name is not configured')
  }

  const { baseUrl, headers } = await resolveComfyHost(provider.url)
  const params = opts.params
  const clipSkip = params?.clip_skip ?? opts.settings?.clipSkip ?? 0
  const clip = clipSkip > 0 ? ['10', 0] : ['8', 1]
  const prompt = {
    3: {
      class_type: 'KSampler',
      inputs: {
        cfg: params?.cfg_scale ?? opts.settings?.cfg ?? 8,
        denoise: 1,
        latent_image: ['5', 0],
        model: ['8', 0],
        negative: ['7', 0],
        positive: ['6', 0],
        sampler_name: params?.sampler || provider.sampler || 'euler',
        scheduler: provider.scheduler || 'normal',
        seed: params?.seed || opts.settings?.seed || Math.floor(Math.random() * 1_000_000_000) + 1,
        steps: params?.steps ?? opts.settings?.steps ?? 20,
      },
    },
    4: {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['3', 0],
        vae: ['8', 2],
      },
    },
    5: {
      class_type: 'EmptyLatentImage',
      inputs: {
        batch_size: 1,
        height: params?.height ?? opts.settings?.height ?? 512,
        width: params?.width ?? opts.settings?.width ?? 512,
      },
    },
    6: {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: opts.prompt,
        clip,
      },
    },
    7: {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: params?.negative ?? opts.negative,
        clip,
      },
    },
    8: {
      class_type: 'CheckpointLoaderSimple',
      inputs: {
        ckpt_name: provider.model,
      },
    },
    9: {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: `agnai_${v4()}`,
        images: ['4', 0],
      },
    },
    ...(clipSkip > 0
      ? {
          10: {
            class_type: 'CLIPSetLastLayer',
            inputs: {
              clip: ['8', 1],
              stop_at_clip_layer: -Math.abs(clipSkip),
            },
          },
        }
      : {}),
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS)

  try {
    const queued = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: v4() }),
      signal: controller.signal,
    })

    if (!queued.ok) {
      throw new Error(`ComfyUI request failed (${queued.status}): ${await readError(queued)}`)
    }

    const body = (await queued.json()) as { prompt_id?: string; error?: string }
    if (!body.prompt_id) {
      throw new Error(`ComfyUI did not return a prompt ID${body.error ? `: ${body.error}` : ''}`)
    }

    const image = await waitForImage(baseUrl, headers, body.prompt_id, controller.signal)
    const query = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder ?? '',
      type: image.type ?? 'output',
    })
    const imageRes = await fetch(`${baseUrl}/view?${query}`, {
      headers,
      signal: controller.signal,
    })
    if (!imageRes.ok) {
      throw new Error(
        `ComfyUI image download failed (${imageRes.status}): ${await readError(imageRes)}`
      )
    }

    return { ext: extensionOf(image.filename), content: Buffer.from(await imageRes.arrayBuffer()) }
  } catch (err: any) {
    if (controller.signal.aborted) {
      throw new Error('ComfyUI generation timed out')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForImage(
  baseUrl: string,
  headers: Record<string, string>,
  promptId: string,
  signal: AbortSignal
) {
  while (!signal.aborted) {
    const res = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, {
      headers,
      signal,
    })
    if (!res.ok) {
      throw new Error(`ComfyUI history request failed (${res.status}): ${await readError(res)}`)
    }

    const history = (await res.json()) as Record<
      string,
      {
        outputs?: Record<string, { images?: ComfyImage[] }>
        status?: { status_str?: string; messages?: any[] }
      }
    >
    const entry = history[promptId]
    if (!entry) {
      await delay(POLL_INTERVAL_MS, signal)
      continue
    }

    for (const output of Object.values(entry.outputs ?? {})) {
      const image = output.images?.[0]
      if (image?.filename) return image
    }

    throw new Error(`ComfyUI completed without an image${formatStatus(entry.status)}`)
  }

  throw new Error('ComfyUI generation timed out')
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('Aborted'))
      },
      { once: true }
    )
  })
}

async function readError(res: Response) {
  const text = await res.text()
  return text.slice(0, 500) || res.statusText
}

function formatStatus(status?: { status_str?: string; messages?: any[] }) {
  if (!status) return ''
  const message = status.messages?.find((item) => item?.[0] === 'execution_error')?.[1]
    ?.exception_message
  return `: ${message || status.status_str || 'unknown execution error'}`
}

function extensionOf(filename: string) {
  const match = filename.match(/\.([a-zA-Z0-9]+)$/)
  return match?.[1]?.toLowerCase() || 'png'
}
