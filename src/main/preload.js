/*
  Zenlo – trình quản lí hội thoại Zalo

  Preload: exposes a small IPC bridge to the renderer as `window.$zenlo`.
*/

const { contextBridge, ipcRenderer } = require('electron')

const listeners = new Map()

ipcRenderer.on('zenlo:summary:event', (event, payload) => {
  const listener = payload && listeners.get(payload.id)
  if (!listener) return
  if (payload.type === 'done' || payload.type === 'error') listeners.delete(payload.id)
  listener(payload)
})

// Only Zalo's own local pages get the bridge
if (window.location.protocol === 'file:') {
  try {
    exposeBridge()
  } catch (error) {
    // Already exposed, or this page runs without context isolation
  }
}

function exposeBridge () {
  contextBridge.exposeInMainWorld('$zenlo', {
    run: (request, onEvent) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      listeners.set(id, onEvent)
      ipcRenderer.send('zenlo:summary:run', { ...request, id })
      return id
    },
    cancel: (id) => {
      listeners.delete(id)
      ipcRenderer.send('zenlo:summary:cancel', id)
    },
    // { geminiKeys, maxKeys, claudePath, encryption }
    getSettings: () => ipcRenderer.invoke('zenlo:settings:get'),
    // The keys are encrypted by the main process; an empty list deletes them
    setGeminiKeys: (keys) => ipcRenderer.invoke('zenlo:settings:setGeminiKeys', keys),
    // { models: [{ id, label, level, exhausted, resetAt }], keys: [{ masked, exhausted: [{ label, resetAt }] }] }
    geminiStatus: () => ipcRenderer.invoke('zenlo:gemini:status'),
    // Backup of Zenlo's localStorage in %APPDATA%\Zenlo
    saveStorage: (data) => ipcRenderer.send('zenlo:storage:save', data),
    loadStorage: () => ipcRenderer.invoke('zenlo:storage:load')
  })
}
