/*
  Zenlo – loads the real src/renderer/core.js outside Zalo, with just enough of a browser around it,
  so the summary evaluation uses exactly the transcript and prompts Zenlo ships.
*/

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// source: core.js text to load instead of the working copy (e.g. an older version from git)
export function loadCore (source = null) {
  const store = new Map()
  const window = { addEventListener: () => {}, removeEventListener: () => {} }
  const context = {
    window,
    DEBUG: false,
    console,
    document: { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    MutationObserver: class { observe () {} disconnect () {} },
    requestAnimationFrame: () => 0,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout,
    clearTimeout
  }
  vm.createContext(context)
  vm.runInContext(source || fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'core.js'), 'utf8'), context, { filename: 'core.js' })
  return window.ZenloCore
}
