/*
  Zenlo – trình quản lí hội thoại Zalo

  Browser extension, in Zalo web's own page (runs before Zalo's scripts): window.$zenlo, the same
  bridge Zalo PC's preload gives. Settings, keys and Gemini are answered by the extension's content
  script (bridge.js) through window messages; no key ever comes to this page.
*/

(function () {
  if (window.$zenlo) return

  const TAG = 'zenlo-ext'
  // Taken before Zalo's scripts run
  const post = window.postMessage.bind(window)
  const origin = window.location.origin
  const send = (message) => post({ [TAG]: 'to-bridge', ...message }, origin)

  const pending = new Map()
  const listeners = new Map()
  let counter = 0
  const newId = () => `${Date.now()}-${++counter}-${Math.random().toString(36).slice(2)}`

  window.addEventListener('message', (event) => {
    const data = event.source === window && event.data
    if (!data || data[TAG] !== 'to-page') return
    if (data.kind === 'reply') {
      const waiting = pending.get(data.id)
      if (!waiting) return
      pending.delete(data.id)
      if (data.error) waiting.reject(new Error(data.error))
      else waiting.resolve(data.result)
    } else if (data.kind === 'event') {
      const listener = listeners.get(data.id)
      const payload = data.payload
      if (!listener || !payload) return
      if (payload.type === 'done' || payload.type === 'error') listeners.delete(data.id)
      listener(payload)
    }
  })

  // The bridge goes silent when the extension was reloaded or updated under this page. Longer than
  // its own 10-second wait for GitHub (latestRelease).
  const CALL_WAIT = 20000
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = newId()
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Tiện ích Zenlo không trả lời. Hãy tải lại trang Zalo web (F5).'))
    }, CALL_WAIT)
    pending.set(id, {
      resolve: (result) => { clearTimeout(timer); resolve(result) },
      reject: (error) => { clearTimeout(timer); reject(error) }
    })
    send({ kind: 'call', id, method, args })
  })

  // Links Zenlo may open from its settings: Google AI Studio (Gemini keys), Zenlo's website and
  // repository, and e-mail. Anything else is refused.
  const EXTERNAL_HOSTS = ['aistudio.google.com', 'ai.google.dev', 'github.com', 'zenlo.io.vn']

  function parse (url) {
    try {
      return new URL(String(url))
    } catch (error) {
      return null
    }
  }

  function openExternal (url) {
    const parsed = parse(url)
    if (!parsed) return false
    if (parsed.protocol === 'mailto:') {
      window.location.href = parsed.href
      return true
    }
    if (parsed.protocol !== 'https:' || !EXTERNAL_HOSTS.includes(parsed.hostname)) return false
    window.open(parsed.href, '_blank', 'noopener,noreferrer')
    return true
  }

  // A link in a summary (from the messages), when the user clicks it: any http(s) address
  function openLink (url) {
    const parsed = parse(url)
    if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return false
    window.open(parsed.href, '_blank', 'noopener,noreferrer')
    return true
  }

  Object.defineProperty(window, '$zenlo', {
    value: Object.freeze({
      run: (request, onEvent) => {
        const id = newId()
        listeners.set(id, onEvent)
        send({ kind: 'run', id, request })
        return id
      },
      cancel: (id) => {
        listeners.delete(id)
        send({ kind: 'cancel', id })
      },
      // Gemini: leave the model that keeps the run waiting and ask the next one
      skip: (id) => send({ kind: 'skip', id }),
      // { geminiKeys (masks only), maxKeys }
      getSettings: () => call('getSettings'),
      setGeminiKeys: (keys) => call('setGeminiKeys', keys),
      geminiStatus: () => call('geminiStatus'),
      // Backup of Zenlo's localStorage in the extension's own storage
      saveStorage: (data) => {
        call('saveStorage', data).catch(() => {})
      },
      loadStorage: () => call('loadStorage'),
      // { tag } of Zenlo's newest release on GitHub, or { error }
      latestRelease: () => call('latestRelease'),
      openExternal: async (url) => openExternal(url),
      openLink: async (url) => openLink(url),
      // A browser window has no smallest width of Zalo's own
      windowMinWidth: async () => 0
    })
  })
})()
