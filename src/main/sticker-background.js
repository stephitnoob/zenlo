/*
  Background removal for stickers, on this computer. Nothing ships with the installer: the first
  time the user asks for it, two files are downloaded into %APPDATA%\Zenlo\models (about 15 MB)
  and checked against fixed SHA-256 sums: ONNX Runtime's WebAssembly engine and the U²-Net small
  model. Each file is fetched from Zenlo's own release first, then from where it was published.
  The mask runs in a worker so it does not block Zalo's main process. Only a 320 × 320 pixel buffer
  enters it.
*/

const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const https = require('node:https')
const path = require('node:path')
const { Worker } = require('node:worker_threads')

const PIXEL_BYTES = 320 * 320 * 4
// Zenlo's copy of both files: a release of its own, so they stay if the original pages go away
const MIRROR = 'https://github.com/stephitnoob/zenlo/releases/download/sticker-tools-v1/'
const FILES = {
  engine: {
    name: 'ort-wasm-simd.wasm',
    size: 10551547,
    sha256: '6783fcd6647ce1b426a527c31412a9c40894552faa609e9c931b3239a3438071',
    sources: [MIRROR + 'ort-wasm-simd.wasm', 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/ort-wasm-simd.wasm']
  },
  model: {
    name: 'u2netp.onnx',
    size: 4574861,
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    sources: [MIRROR + 'u2netp.onnx', 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx']
  }
}
const HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'cdn.jsdelivr.net'])
const WORKER_IDLE = 120000
const INFERENCE_TIMEOUT = 30000
const DOWNLOAD_TIMEOUT = 10 * 60 * 1000
const STALL_TIMEOUT = 30000

// A slow line still gets there (10.5 MB at 30 KB/s is about 6 minutes); a line that stops sending
// for STALL_TIMEOUT is given up on
function download (url, maxSize, redirects = 3, signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT)) {
  const address = new URL(url)
  if (address.protocol !== 'https:' || !HOSTS.has(address.hostname)) {
    return Promise.reject(new Error('Địa chỉ tải công cụ tách nền không hợp lệ.'))
  }
  return new Promise((resolve, reject) => {
    const request = https.get(address, { signal, rejectUnauthorized: true, timeout: STALL_TIMEOUT }, (response) => {
      const { statusCode, headers } = response
      if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location && redirects > 0) {
        response.resume()
        resolve(download(new URL(headers.location, address).href, maxSize, redirects - 1, signal))
        return
      }
      if (statusCode !== 200) {
        response.resume()
        reject(new Error(`Không tải được công cụ tách nền (HTTP ${statusCode}).`))
        return
      }
      const chunks = []
      let length = 0
      response.on('error', reject)
      response.on('data', (chunk) => {
        length += chunk.length
        if (length > maxSize) {
          response.destroy(new Error('Công cụ tách nền lớn hơn kích thước dự kiến.'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
    })
    request.on('timeout', () => request.destroy(new Error('Mạng không gửi tiếp dữ liệu, chưa tải được công cụ tách nền.')))
    request.on('error', reject)
  })
}

const isValid = (file, bytes) => bytes.length === file.size && createHash('sha256').update(bytes).digest('hex') === file.sha256

async function ensureFile (directory, file) {
  const target = path.join(directory, file.name)
  const existing = await fs.readFile(target).catch(() => null)
  if (existing && isValid(file, existing)) return existing
  let lastError = null
  for (const source of file.sources) {
    try {
      const bytes = await download(source, file.size)
      if (!isValid(file, bytes)) throw new Error('File công cụ tách nền không khớp mã kiểm tra.')
      await fs.mkdir(directory, { recursive: true })
      // Written under another name first, so a half-written file is never taken for a good one
      await fs.writeFile(target + '.part', bytes)
      await fs.rename(target + '.part', target)
      return bytes
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('Không tải được công cụ tách nền.')
}

// true when both files are already on this computer and intact (no download needed)
async function toolsReady (directory) {
  for (const file of Object.values(FILES)) {
    const bytes = await fs.readFile(path.join(directory, file.name)).catch(() => null)
    if (!bytes || !isValid(file, bytes)) return false
  }
  return true
}

function createStickerBackground (directory) {
  let worker = null
  let pending = null
  let idle = null

  function stop (current, error) {
    if (worker !== current) return
    worker = null
    clearTimeout(idle)
    current.terminate().catch(() => {})
    if (pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      pending = null
    }
  }

  async function openWorker () {
    await ensureFile(directory, FILES.engine)
    const model = await ensureFile(directory, FILES.model)
    const current = new Worker(path.join(__dirname, 'zenlo-sticker-worker.js'), {
      workerData: { model, wasmDir: directory + path.sep }
    })
    worker = current
    current.on('error', (error) => stop(current, error))
    current.on('exit', () => stop(current, new Error('Tiến trình tách nền đã dừng.')))
    current.on('message', ({ mask, error }) => {
      if (worker !== current || !pending) return
      const { resolve, reject, timer } = pending
      pending = null
      clearTimeout(timer)
      current.unref()
      idle = setTimeout(() => stop(current), WORKER_IDLE)
      idle.unref()
      if (error) reject(new Error(error))
      else resolve(mask)
    })
    return current
  }

  let busy = false
  const removeBackground = async (pixels) => {
    if (!(pixels instanceof Uint8Array) || pixels.byteLength !== PIXEL_BYTES) {
      throw new Error('Dữ liệu ảnh tách nền không hợp lệ.')
    }
    if (busy) throw new Error('Zenlo đang tách nền một ảnh khác.')
    busy = true
    clearTimeout(idle)
    try {
      const current = worker || await openWorker()
      current.ref()
      const mask = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => stop(current, new Error('Tách nền quá lâu. Hãy thử lại.')), INFERENCE_TIMEOUT)
        pending = { resolve, reject, timer }
        try {
          current.postMessage(pixels)
        } catch (error) {
          stop(current, error)
        }
      })
      return mask
    } finally {
      busy = false
    }
  }
  removeBackground.ready = () => toolsReady(directory)
  return removeBackground
}

module.exports = { createStickerBackground }
