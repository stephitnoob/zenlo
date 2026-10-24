/*
  Zenlo – trình quản lí hội thoại Zalo

  Builds Zenlo into dist/:
  - zenlo.js          everything that runs in Zalo's page (src/renderer), one file
  - zenlo.css         the styles (src/styles)
  - zenlo-main.js     Zalo's main process: runs the AI (src/main/main.js)
  - zenlo-preload.js  the bridge between the two (src/main/preload.js)

  node scripts/build.mjs           build once, minified
  node scripts/build.mjs --watch   rebuild on every change, readable output with DEBUG on.
                                   Files are overwritten in place, so a Zalo installed in dev mode
                                   (linked to dist/) never sees the folder disappear.
*/

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import * as sass from 'sass'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const STYLES = path.join(ROOT, 'src', 'styles')
const watching = process.argv.includes('--watch')

const common = {
  bundle: true,
  minify: !watching,
  legalComments: 'none',
  logLevel: 'info',
  define: { DEBUG: String(watching) }
}

const targets = [
  // Zalo's page (Chromium in Electron 22)
  { ...common, entryPoints: [path.join(ROOT, 'src', 'renderer', 'index.js')], outfile: path.join(DIST, 'zenlo.js'), format: 'iife', platform: 'browser', target: 'chrome108' },
  // Zalo's main process and preload (Node 16 in Electron 22)
  { ...common, entryPoints: [path.join(ROOT, 'src', 'main', 'main.js')], outfile: path.join(DIST, 'zenlo-main.js'), format: 'cjs', platform: 'node', target: 'node16', external: ['electron'] },
  { ...common, entryPoints: [path.join(ROOT, 'src', 'main', 'preload.js')], outfile: path.join(DIST, 'zenlo-preload.js'), format: 'cjs', platform: 'node', target: 'node16', external: ['electron'] }
]

function buildStyles () {
  try {
    const { css } = sass.compile(path.join(STYLES, 'zenlo.scss'), { style: watching ? 'expanded' : 'compressed' })
    fs.writeFileSync(path.join(DIST, 'zenlo.css'), css)
    console.log('  dist/zenlo.css')
  } catch (error) {
    console.error(error.message)
    if (!watching) process.exitCode = 1
  }
}

if (!watching) fs.rmSync(DIST, { recursive: true, force: true })
fs.mkdirSync(DIST, { recursive: true })

if (watching) {
  for (const options of targets) await (await esbuild.context(options)).watch()
  buildStyles()
  let timer = null
  fs.watch(STYLES, { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(buildStyles, 100)
  })
  console.log('Đang theo dõi thay đổi. Build xong thì bấm Ctrl+Shift+R trong Zalo.')
} else {
  await Promise.all(targets.map((options) => esbuild.build(options)))
  buildStyles()
}
