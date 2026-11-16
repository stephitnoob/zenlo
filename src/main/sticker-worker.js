const { parentPort, workerData } = require('node:worker_threads')
const ort = require('onnxruntime-web')

const SIDE = 320
const PIXELS = SIDE * SIDE
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

ort.env.wasm.numThreads = 1
// Only the SIMD engine is downloaded (every Electron Zalo ships with supports SIMD)
ort.env.wasm.simd = true
ort.env.wasm.wasmPaths = workerData.wasmDir

let session

async function infer (data) {
  if (!session) session = await ort.InferenceSession.create(workerData.model, { executionProviders: ['wasm'] })
  // Match the model's reference preprocessing. The editor flattens transparency for inference.
  let max = 1
  for (let i = 0; i < data.length; i += 4) max = Math.max(max, data[i], data[i + 1], data[i + 2])
  const input = new Float32Array(3 * PIXELS)
  for (let channel = 0; channel < 3; channel++) {
    for (let i = 0; i < PIXELS; i++) {
      input[channel * PIXELS + i] = (data[i * 4 + channel] / max - MEAN[channel]) / STD[channel]
    }
  }
  const [outputName] = session.outputNames
  const value = new ort.Tensor('float32', input, [1, 3, SIDE, SIDE])
  const output = await session.run({ [session.inputNames[0]]: value }, [outputName])
  const scores = output[outputName].data
  let lo = Infinity
  let hi = -Infinity
  for (const score of scores) {
    lo = Math.min(lo, score)
    hi = Math.max(hi, score)
  }
  if (scores.length !== PIXELS || !Number.isFinite(hi - lo) || !(hi - lo > 0.00001)) {
    throw new Error('Không tìm thấy chủ thể rõ trong ảnh này.')
  }
  const mask = new Uint8Array(PIXELS)
  for (let i = 0; i < mask.length; i++) {
    // Drop faint background pixels and keep partially transparent edges.
    const strength = ((scores[i] - lo) / (hi - lo) - 0.08) / 0.84
    mask[i] = Math.round(Math.min(1, Math.max(0, strength)) * 255)
  }
  return mask
}

parentPort.on('message', async (pixels) => {
  try {
    const mask = await infer(pixels)
    parentPort.postMessage({ mask }, [mask.buffer])
  } catch (error) {
    parentPort.postMessage({ error: error.message || 'Tách nền thất bại.' })
  }
})
