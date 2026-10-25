/*
  Zenlo – serves site/ at http://127.0.0.1:4173 for previewing the website. Every response says
  "no-store", so the browser never mixes a new page with an old cached script or stylesheet.
*/

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site')
const PORT = 4173
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json'
}

http.createServer((request, response) => {
  let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  if (name.endsWith('/')) name += 'index.html'
  const file = path.join(ROOT, name)
  // Nothing outside site/
  if (!file.startsWith(ROOT + path.sep)) {
    response.writeHead(403).end()
    return
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Không có trang này')
      return
    }
    response.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    }).end(data)
  })
}).listen(PORT, '127.0.0.1', () => console.log(`Website: http://127.0.0.1:${PORT}/`))
