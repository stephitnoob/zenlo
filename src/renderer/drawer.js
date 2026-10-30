/*
  Zenlo – trình quản lí hội thoại Zalo

  The Zenlo drawer (renderer): one panel docked as the last column of Zalo's window, so the chat
  narrows instead of being covered. Tabs "Tóm tắt" and "Bản tin", and a gear for "Cài đặt".
  The Zenlo button in Zalo's left bar opens "Bản tin", the button on a conversation's title bar
  opens "Tóm tắt"; it closes with ×, the same button again, or Esc.
  Exposed as ZenloCore.drawer; each feature fills its own pane.
*/

(function () {
  const Z = window.ZenloCore

  const LOGO_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 8.5A8 8 0 1 0 20 12"/><path d="M9 9h6l-6 6h6"/></svg>'
  const GEAR_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'

  const TABS = [
    { id: 'summary', label: 'Tóm tắt' },
    { id: 'digest', label: 'Bản tin' }
  ]

  let drawer = null
  let current = 'digest'
  const showHandlers = {}

  function build () {
    const el = document.createElement('aside')
    el.className = 'zenlo-drawer'
    el.hidden = true
    el.setAttribute('aria-label', 'Zenlo')
    el.innerHTML = `
      <div class="zenlo-drawer__head">
        <span class="zenlo-drawer__logo">${LOGO_SVG}</span>
        <span class="zenlo-drawer__name">zenlo</span>
        <button type="button" class="zenlo-drawer__close js-drawer-close" title="Đóng (Esc)" aria-label="Đóng Zenlo">&times;</button>
      </div>
      <div class="zenlo-drawer__tabs" role="tablist">
        ${TABS.map((t) => `<button type="button" role="tab" class="zenlo-drawer__tab" data-tab="${t.id}">${t.label}</button>`).join('')}
        <span class="zenlo-drawer__spacer"></span>
        <button type="button" role="tab" class="zenlo-drawer__tab zenlo-drawer__tab--icon" data-tab="settings" title="Cài đặt Zenlo" aria-label="Cài đặt Zenlo">${GEAR_SVG}</button>
      </div>
      <div class="zenlo-drawer__notice" hidden>
        <span class="js-drawer-notice-text"></span>
        <button type="button" class="zenlo__inline-link js-drawer-notice-action">Mở Cài đặt</button>
      </div>
      <div class="zenlo-drawer__notice zenlo-drawer__ask js-drawer-ask" hidden>
        <span>Báo cho bạn khi có Zenlo bản mới? Zenlo sẽ hỏi GitHub mỗi ngày một lần, không gửi gì về bạn.</span>
        <span class="zenlo-drawer__ask-actions">
          <button type="button" class="zenlo__inline-link js-drawer-ask-yes">Có, báo cho tôi</button>
          <button type="button" class="zenlo__inline-link zenlo-drawer__ask-no js-drawer-ask-no">Không</button>
        </span>
      </div>
      <div class="zenlo-drawer__body">
        <div class="zenlo-drawer__pane" data-pane="summary"></div>
        <div class="zenlo-drawer__pane" data-pane="digest"></div>
        <div class="zenlo-drawer__pane" data-pane="settings"></div>
      </div>
    `
    el.querySelector('.js-drawer-close').addEventListener('click', close)
    el.querySelector('.js-drawer-notice-action').addEventListener('click', (event) => {
      if (event.target.closest('.zenlo-drawer__notice').dataset.update) Z.openLink(Z.LINKS.versions)
      else open('settings')
    })
    el.querySelector('.js-drawer-ask-yes').addEventListener('click', async () => {
      Z.setSetting(Z.STORAGE_KEYS.updateCheck, 'on')
      refreshAsk()
      const result = await Z.checkForUpdate()
      if (!result.newer) return
      refreshNotice()
      Z.notifyUpdate(result.latest)
    })
    el.querySelector('.js-drawer-ask-no').addEventListener('click', () => {
      Z.setSetting(Z.STORAGE_KEYS.updateCheck, 'off')
      refreshAsk()
    })
    el.querySelector('.zenlo-drawer__tabs').addEventListener('click', (event) => {
      const tab = event.target.closest('[data-tab]')
      if (tab) open(tab.dataset.tab)
    })
    return el
  }

  function ensure () {
    if (!drawer) drawer = build()
    return drawer
  }

  // The last column of Zalo's window row; re-attached if Zalo re-renders it
  function attach () {
    const container = document.getElementById('container')
    if (!drawer || !container || drawer.parentElement === container) return
    container.appendChild(drawer)
  }

  function render () {
    drawer.querySelectorAll('[data-tab]').forEach((tab) => {
      const active = tab.dataset.tab === current
      tab.classList.toggle('zenlo-drawer__tab--active', active)
      tab.setAttribute('aria-selected', String(active))
    })
    drawer.querySelectorAll('[data-pane]').forEach((pane) => {
      pane.hidden = pane.dataset.pane !== current
    })
  }

  function open (tab = current) {
    ensure()
    attach()
    current = tab
    render()
    drawer.hidden = false
    updateTheme()
    refreshNotice()
    refreshAsk()
    if (showHandlers[tab]) showHandlers[tab]()
  }

  function close () {
    if (drawer) drawer.hidden = true
  }

  function isOpen (tab) {
    return !!drawer && !drawer.hidden && (!tab || current === tab)
  }

  // Opens the drawer on a tab, or closes it when it already shows that tab
  function toggle (tab) {
    if (isOpen(tab)) close()
    else open(tab)
  }

  // The element a feature fills with its content
  function pane (tab) {
    return ensure().querySelector(`[data-pane="${tab}"]`)
  }

  // Called each time the drawer shows that tab
  function onShow (tab, fn) {
    showHandlers[tab] = fn
  }

  // ---------- First run ----------

  // A line above the tabs while the chosen AI cannot be used yet (no Gemini key, no Claude Code or Codex)
  async function refreshNotice () {
    if (!drawer || !window.$zenlo || !window.$zenlo.getSettings) return
    const notice = drawer.querySelector('.zenlo-drawer__notice')
    let text = ''
    let update = ''
    try {
      const settings = await window.$zenlo.getSettings()
      const { provider } = Z.getAISettings()
      if (provider === 'gemini' && !settings.geminiKeys.length) {
        text = 'Zenlo cần một API key Gemini (miễn phí) để tóm tắt. Lấy key mất khoảng 1 phút.'
      } else if (provider === 'claude' && !settings.claudePath) {
        text = 'Chưa tìm thấy Claude Code trên máy. Hãy cài Claude Code, hoặc chuyển sang Gemini.'
      } else if (provider === 'codex' && !settings.codexPath) {
        text = 'Chưa tìm thấy Codex trên máy. Hãy cài Codex và đăng nhập bằng tài khoản ChatGPT, hoặc chuyển sang Gemini.'
      }
    } catch (error) {}
    // Nothing to set up: tell about a newer version found by the check, if any
    if (!text && Z.availableUpdate()) {
      update = Z.availableUpdate()
      text = `Đã có Zenlo ${update}.`
    }
    notice.querySelector('.js-drawer-notice-text').textContent = text
    notice.querySelector('.js-drawer-notice-action').textContent = update ? 'Xem bản mới' : 'Mở Cài đặt'
    notice.dataset.update = update ? '1' : ''
    notice.hidden = !text || (current === 'settings' && !update)
  }

  // Asked once, the first time Zenlo opens (also after updating from a version without the
  // question): whether to look for new versions every day. Either answer can be changed in Cài đặt.
  function refreshAsk () {
    if (!drawer) return
    drawer.querySelector('.js-drawer-ask').hidden = Z.getSetting(Z.STORAGE_KEYS.updateCheck, ['on', 'off'], '') !== ''
  }

  // ---------- Theme ----------

  // Zalo's own theme (light or dark) picks the accent shade; Zalo has no class for it, so the
  // page background decides
  function updateTheme () {
    const target = document.getElementById('container') || document.body
    const match = window.getComputedStyle(target).backgroundColor.match(/\d+(\.\d+)?/g)
    if (!match) return
    const [r, g, b] = match.map(Number)
    const dark = (0.299 * r + 0.587 * g + 0.114 * b) < 128
    document.documentElement.classList.toggle('zenlo-dark', dark)
  }

  // ---------- Left bar ----------

  // One Zenlo button above "Zalo Cloud"; the badge counts unread conversations that mention you
  function injectNavButton () {
    const bottom = document.querySelector('#main-tab .nav__tabs__bottom')
    if (!bottom || bottom.querySelector('.zenlo-nav-btn')) return
    const tab = document.createElement('div')
    tab.className = 'clickable leftbar-tab flx flx-col flx-al-c flx-center rel zenlo-nav-btn'
    tab.title = 'Zenlo'
    tab.innerHTML = `<div class="mmi-icon-wr zenlo-nav-btn__icon">${LOGO_SVG}<span class="zenlo-nav-btn__badge" hidden></span></div><div class="lb-tab-title truncate">Zenlo</div>`
    tab.addEventListener('click', (event) => {
      event.stopPropagation()
      // The left-bar button is the way to the digest; the title-bar button is the way to the summary
      toggle('digest')
    })
    bottom.prepend(tab)
  }

  function updateBadge () {
    const badge = document.querySelector('.zenlo-nav-btn__badge')
    if (!badge) return
    let count = 0
    try {
      count = Z.countMentionedConversations()
    } catch (error) {
      return
    }
    badge.hidden = !count
    badge.textContent = count > 9 ? '9+' : String(count)
    badge.closest('.zenlo-nav-btn').title = count ? `Zenlo · ${count} hội thoại nhắc bạn` : 'Zenlo'
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) close()
  })

  Z.onDomChange(() => {
    injectNavButton()
    if (isOpen()) attach()
  })
  setInterval(() => {
    updateBadge()
    if (isOpen()) updateTheme()
  }, 2000)

  Z.drawer = { open, close, toggle, isOpen, pane, onShow, refreshNotice, current: () => current }
})()
