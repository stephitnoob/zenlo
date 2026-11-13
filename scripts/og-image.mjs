// Zenlo – draws site/og.png from scripts/og-image.html with Microsoft Edge (headless).
// Run: node scripts/og-image.mjs [out.png] [page.html, to try another picture]

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] || path.join(ROOT, 'site', 'og.png'))
const EDGE = [
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe')
].find((file) => fs.existsSync(file))
if (!EDGE) throw new Error('Microsoft Edge not found')

execFileSync(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1200,630',
  '--virtual-time-budget=3000',
  `--screenshot=${out}`,
  pathToFileURL(path.resolve(process.argv[3] || path.join(ROOT, 'scripts', 'og-image.html'))).href
], { stdio: 'ignore' })
console.log('saved', out)
