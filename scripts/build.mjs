/*
  Zenlo – trình quản lí hội thoại Zalo

  Builds Zenlo into dist/:
  - zenlo.js          everything that runs in Zalo's page (src/renderer), one file
  - zenlo.css         the styles (src/styles)
  - zenlo-main.js     Zalo's main process: runs the AI (src/main/main.js)
  - zenlo-preload.js  the bridge between the two (src/main/preload.js)

  and the browser extension for Zalo web into dist-ext/ (src/extension). "npm run build:ext" then
  packs it into build/ext/Zenlo-ZaloWeb.zip.

  node scripts/build.mjs            build once, minified (the extension stays readable)
  node scripts/build.mjs --watch    rebuild on every change, readable output with DEBUG on.
                                    Files are overwritten in place, so a Zalo installed in dev mode
                                    (linked to dist/) never sees the folder disappear.
  node scripts/build.mjs --ext-dev  build once; the extension then reloads itself on every build
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
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const common = {
  bundle: true,
  minify: !watching,
  legalComments: 'none',
  logLevel: 'info',
  define: { DEBUG: String(watching), ZENLO_VERSION: JSON.stringify(version), ZENLO_WEB: 'false' }
}

const targets = [
  // Zalo's page (Chromium in Electron 22)
  { ...common, entryPoints: [path.join(ROOT, 'src', 'renderer', 'index.js')], outfile: path.join(DIST, 'zenlo.js'), format: 'iife', platform: 'browser', target: 'chrome108' },
  // Zalo's main process and preload (Node 16 in Electron 22)
  { ...common, entryPoints: [path.join(ROOT, 'src', 'main', 'main.js')], outfile: path.join(DIST, 'zenlo-main.js'), format: 'cjs', platform: 'node', target: 'node16', external: ['electron'] },
  { ...common, entryPoints: [path.join(ROOT, 'src', 'main', 'preload.js')], outfile: path.join(DIST, 'zenlo-preload.js'), format: 'cjs', platform: 'node', target: 'node16', external: ['electron'] }
]

// ---------- Browser extension (Zalo web), built into dist-ext/ ----------

// The folder is loaded as an unpacked extension, so it is never removed, only written over: a
// browser that saw it disappear would turn the extension off
const EXT = path.join(ROOT, 'dist-ext')
const EXT_SRC = path.join(ROOT, 'src', 'extension')
// A dev build reloads the extension and Zalo web's tab by itself when a new build lands
// (src/extension/dev-reload.js, added to the content script and the service worker)
const extDev = watching || process.argv.includes('--ext-dev')
const BUILD_ID = 'build-id.txt'
const devReload = extDev ? [path.join(EXT_SRC, 'dev-reload.js')] : []
// Never minified, Vietnamese kept as is (not \u escapes): anyone who loads the folder by hand can
// read what it does
const ext = { ...common, minify: false, charset: 'utf8', define: { ...common.define, ZENLO_WEB: 'true' }, format: 'iife', platform: 'browser', target: 'chrome111' }

function writeBuildId () {
  if (extDev) fs.writeFileSync(path.join(EXT, BUILD_ID), String(Date.now()))
}

// In watch mode the dev reload is told once the files of a rebuild are all written
let buildIdTimer = null
const buildIdPlugin = {
  name: 'build-id',
  setup (build) {
    build.onEnd(() => {
      if (!watching) return
      clearTimeout(buildIdTimer)
      buildIdTimer = setTimeout(writeBuildId, 300)
    })
  }
}

const extTargets = [
  // Zenlo itself, in Zalo web's page
  { ...ext, entryPoints: [path.join(ROOT, 'src', 'renderer', 'index.js')], outfile: path.join(EXT, 'zenlo.js'), plugins: [buildIdPlugin] },
  // window.$zenlo in the page, the content script that answers it, the service worker
  { ...ext, entryPoints: [path.join(EXT_SRC, 'shim.js')], outfile: path.join(EXT, 'zenlo-shim.js'), plugins: [buildIdPlugin] },
  { ...ext, entryPoints: [path.join(EXT_SRC, 'bridge.js')], outfile: path.join(EXT, 'zenlo-bridge.js'), inject: devReload, plugins: [buildIdPlugin] },
  { ...ext, entryPoints: [path.join(EXT_SRC, 'background.js')], outfile: path.join(EXT, 'background.js'), inject: devReload, plugins: [buildIdPlugin] }
]

function buildExtensionFiles () {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_SRC, 'manifest.json'), 'utf8'))
  manifest.version = version
  // Only a dev build checks build-id.txt; a release has neither the file nor the page's access to it
  if (!extDev) {
    for (const entry of manifest.web_accessible_resources) entry.resources = entry.resources.filter((file) => file !== BUILD_ID)
    fs.rmSync(path.join(EXT, BUILD_ID), { force: true })
  }
  fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  fs.cpSync(path.join(EXT_SRC, 'icons'), path.join(EXT, 'icons'), { recursive: true })
  console.log(`  dist-ext/manifest.json, icons${extDev ? ' (tự nạp lại khi build mới)' : ''}`)
}

function buildStyles () {
  try {
    const { css } = sass.compile(path.join(STYLES, 'zenlo.scss'), { style: watching ? 'expanded' : 'compressed' })
    fs.writeFileSync(path.join(DIST, 'zenlo.css'), css)
    fs.writeFileSync(path.join(EXT, 'zenlo.css'), css)
    console.log('  dist/zenlo.css, dist-ext/zenlo.css')
    if (watching) writeBuildId()
  } catch (error) {
    console.error(error.message)
    if (!watching) process.exitCode = 1
  }
}

if (!watching) fs.rmSync(DIST, { recursive: true, force: true })
fs.mkdirSync(DIST, { recursive: true })
fs.mkdirSync(EXT, { recursive: true })
buildExtensionFiles()

if (watching) {
  for (const options of [...targets, ...extTargets]) await (await esbuild.context(options)).watch()
  buildStyles()
  let timer = null
  fs.watch(STYLES, { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(buildStyles, 100)
  })
  console.log('Đang theo dõi thay đổi. Build xong thì bấm Ctrl+Shift+R trong Zalo.')
} else {
  await Promise.all([...targets, ...extTargets].map((options) => esbuild.build(options)))
  buildStyles()
  // Last, once every file is written: a dev build reloads on it
  writeBuildId()
}
