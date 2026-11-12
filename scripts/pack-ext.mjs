/*
  Zenlo – trình quản lí hội thoại Zalo

  Packs the browser extension for Zalo web (dist-ext/, from "npm run build") into
  build/ext/Zenlo-ZaloWeb.zip, the file people download and load by hand into their browser.
  The files sit at the zip's root, so Windows' "Extract All" gives one folder to pick in the
  browser. Writes the zip's SHA-256 next to it, in build/ext/SHA256.txt.

  Fixed dates and a fixed order: the zip changes only when the files in it do.
*/

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXT = path.join(ROOT, 'dist-ext')
const OUT = path.join(ROOT, 'build', 'ext')
const NAME = 'Zenlo-ZaloWeb.zip'
const FILES = ['manifest.json', 'zenlo.js', 'zenlo.css', 'zenlo-shim.js', 'zenlo-bridge.js', 'background.js']
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

for (const name of FILES) {
  if (!fs.existsSync(path.join(EXT, name))) throw new Error(`Thiếu dist-ext/${name}. Hãy chạy "npm run build" trước.`)
}
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'))
if (manifest.version !== version) throw new Error(`dist-ext/manifest.json ghi bản ${manifest.version}, package.json ghi ${version}. Hãy chạy "npm run build" lại.`)
if (!manifest.key) throw new Error('dist-ext/manifest.json thiếu "key": mã extension sẽ đổi theo thư mục người dùng giải nén.')
// A dev build (--ext-dev, --watch) reloads itself and polls build-id.txt: never shipped
if (fs.existsSync(path.join(EXT, 'build-id.txt')) || /build-id\.txt/.test(fs.readFileSync(path.join(EXT, 'zenlo-bridge.js'), 'utf8'))) {
  throw new Error('dist-ext/ là bản build phát triển. Hãy chạy "npm run build" (không có --ext-dev).')
}

const entries = [
  ...FILES,
  ...fs.readdirSync(path.join(EXT, 'icons')).filter((name) => name.endsWith('.png')).sort().map((name) => `icons/${name}`),
  'LICENSE'
].map((name) => ({ name, data: fs.readFileSync(name === 'LICENSE' ? path.join(ROOT, name) : path.join(EXT, name)) }))

// ---------- Zip (deflated, or stored when that is smaller; no zip64, no extra fields) ----------

// 2026-01-01 00:00 in MS-DOS format, for every file
const DOS_TIME = 0
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1
// Bit 11: names are UTF-8
const FLAGS = 0x0800

const locals = []
const centrals = []
let offset = 0
for (const { name, data } of entries) {
  const nameBytes = Buffer.from(name, 'utf8')
  const deflated = zlib.deflateRawSync(data, { level: 9 })
  // PNGs are compressed already
  const method = deflated.length < data.length ? 8 : 0
  const packed = method ? deflated : data
  const crc = zlib.crc32(data)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // version needed: 2.0 (deflate)
  local.writeUInt16LE(FLAGS, 6)
  local.writeUInt16LE(method, 8)
  local.writeUInt16LE(DOS_TIME, 10)
  local.writeUInt16LE(DOS_DATE, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(packed.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  local.writeUInt16LE(0, 28)
  locals.push(local, nameBytes, packed)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4) // made by: MS-DOS, 2.0
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(FLAGS, 8)
  central.writeUInt16LE(method, 10)
  central.writeUInt16LE(DOS_TIME, 12)
  central.writeUInt16LE(DOS_DATE, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(packed.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  // extra, comment, disk, internal attributes, external attributes: none
  central.writeUInt32LE(offset, 42)
  centrals.push(central, nameBytes)

  offset += local.length + nameBytes.length + packed.length
}

const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(entries.length, 8)
end.writeUInt16LE(entries.length, 10)
end.writeUInt32LE(centralSize, 12)
end.writeUInt32LE(offset, 16)

const zip = Buffer.concat([...locals, ...centrals, end])
const hash = crypto.createHash('sha256').update(zip).digest('hex')

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, NAME), zip)
fs.writeFileSync(path.join(OUT, 'SHA256.txt'), `${hash}  ${NAME}\n`)
console.log(`build/ext/${NAME} (bản ${version}, ${entries.length} file, ${Math.round(zip.length / 1024)} KB)`)
console.log(`SHA-256: ${hash}`)
