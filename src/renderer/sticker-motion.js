import { drawFrame, FRAME_COUNT, FRAME_MS, THUMBNAIL_FRAME } from './sticker-effects.js'

export { MOTION_DURATION, MOTION_SCALE } from './sticker-effects.js'

function makeCanvas (side) {
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  return canvas
}

export function canvasBlob (canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob && blob.type === type) resolve(blob)
      else reject(new Error('Không xuất được ảnh sticker.'))
    }, type, quality)
  })
}

const fourCC = (name) => Uint8Array.from(name, (char) => char.charCodeAt(0))

function put24 (bytes, offset, number) {
  bytes[offset] = number & 255
  bytes[offset + 1] = (number >> 8) & 255
  bytes[offset + 2] = (number >> 16) & 255
}

function chunk (name, payload) {
  const data = new Uint8Array(8 + payload.length + (payload.length % 2))
  data.set(fourCC(name))
  new DataView(data.buffer).setUint32(4, payload.length, true)
  data.set(payload, 8)
  return data
}

function readChunks (bytes) {
  const tag = (offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) {
    throw new Error('Tệp ảnh WebP không hợp lệ.')
  }
  const chunks = []
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('Tệp WebP thiếu dữ liệu.')
    const size = view.getUint32(offset + 4, true)
    const end = offset + 8 + size + (size % 2)
    if (end > bytes.length) throw new Error('Tệp WebP thiếu dữ liệu.')
    chunks.push({ tag: tag(offset), bytes: bytes.subarray(offset, end) })
    offset = end
  }
  return chunks
}

// https://developers.google.com/speed/webp/docs/riff_container
// The canvas encodes each still frame. Keep its alpha and VP8 data, then wrap
// those chunks with WebP's animation headers. The browser's encoder does the
// compression, and no separate encoder is needed.
async function animationFrame (canvas) {
  const still = await canvasBlob(canvas, 'image/webp', 0.8)
  const chunks = readChunks(new Uint8Array(await still.arrayBuffer()))
  const image = chunks.filter(({ tag }) => ['ALPH', 'VP8 ', 'VP8L'].includes(tag))
  if (!image.some(({ tag }) => tag === 'VP8 ' || tag === 'VP8L')) throw new Error('Không mã hoá được khung sticker.')
  const header = new Uint8Array(16)
  put24(header, 6, canvas.width - 1)
  put24(header, 9, canvas.height - 1)
  put24(header, 12, FRAME_MS)
  header[15] = 2 // each frame replaces the whole canvas, including transparent pixels
  const frame = new Uint8Array(header.length + image.reduce((n, part) => n + part.bytes.length, 0))
  frame.set(header)
  let offset = header.length
  for (const part of image) {
    frame.set(part.bytes, offset)
    offset += part.bytes.length
  }
  return chunk('ANMF', frame)
}

// An animated WebP of FRAME_COUNT frames of the effects `fx` on `picture` (see sticker-effects.js),
// plus a still PNG of one frame for the places that show no animation
export async function createMotionSticker (side, fx, picture) {
  const canvas = makeCanvas(side)
  const ctx = canvas.getContext('2d')
  const extended = new Uint8Array(10)
  extended[0] = 0x12 // alpha + animation
  put24(extended, 4, side - 1)
  put24(extended, 7, side - 1)
  const chunks = [chunk('VP8X', extended), chunk('ANIM', new Uint8Array(6))]
  let thumbnail
  for (let i = 0; i < FRAME_COUNT; i++) {
    ctx.clearRect(0, 0, side, side)
    drawFrame(ctx, side, fx, i / FRAME_COUNT, picture)
    if (i === THUMBNAIL_FRAME) thumbnail = await canvasBlob(canvas)
    chunks.push(await animationFrame(canvas))
  }
  const header = new Uint8Array(12)
  header.set(fourCC('RIFF'))
  new DataView(header.buffer).setUint32(4, 4 + chunks.reduce((size, item) => size + item.length, 0), true)
  header.set(fourCC('WEBP'), 8)
  const webp = new Blob([header, ...chunks], { type: 'image/webp' })
  if (webp.size > 2 * 1024 * 1024) throw new Error('Sticker động quá lớn. Hãy thử hiệu ứng khác hoặc ảnh ít chi tiết hơn.')
  return { blob: webp, thumbnail }
}

export async function checkMotionUpload (url, original) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), cache: 'no-store' })
  if (!response.ok) throw new Error('Không đọc được sticker động trên Zalo.')
  const uploaded = new Uint8Array(await response.arrayBuffer())
  const source = new Uint8Array(await original.arrayBuffer())
  if (uploaded.length !== source.length || !uploaded.every((value, i) => value === source[i])) {
    throw new Error('Zalo đã đổi tệp WebP khi tải lên. Hãy thử ảnh khác.')
  }
}
