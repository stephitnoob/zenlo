/*
  Zenlo – trình quản lí hội thoại Zalo

  The Zenlo drawer (renderer): one panel at the right end of Zalo's window, with its room kept as the
  last column of Zalo's window row, so the chat narrows instead of being covered. Tabs "Tóm tắt" and "Bản tin", and a gear for "Cài đặt".
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
  // The empty column in Zalo's window row that keeps the room of the docked drawer
  let space = null
  let current = 'digest'
  const showHandlers = {}

  function build () {
    const el = document.createElement('aside')
    el.className = 'zenlo-drawer'
    el.hidden = true
    el.setAttribute('aria-label', 'Zenlo')
    el.innerHTML = `
      <div class="zenlo-drawer__resize" title="Kéo để đổi độ rộng · bấm đúp để về mặc định"></div>
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
    const handle = el.querySelector('.zenlo-drawer__resize')
    handle.addEventListener('pointerdown', startDrag)
    handle.addEventListener('dblclick', resetWidth)
    el.querySelector('.js-drawer-notice-action').addEventListener('click', (event) => {
      if (event.target.closest('.zenlo-drawer__notice').dataset.update) Z.openLink(Z.LINKS.update)
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

  const host = () => document.getElementById('container')

  // Where the drawer lives. Zalo works out the style of its whole page again each time an element
  // is added or removed anywhere inside #app-page (measured 11/2026: 0.1 to 0.2 s each time). A
  // drawer in Zalo's window row made Zalo do that for every line an AI wrote, and opened late.
  // So the drawer is a child of #app, fixed over the right end of the window, and only an empty
  // column stays in Zalo's window row to keep its room: the chat narrows as before, and nothing
  // Zenlo writes in the drawer costs Zalo anything. Both are put back if Zalo re-renders its page.
  function attach () {
    const row = host()
    if (!row) return
    if (!space) {
      space = document.createElement('div')
      space.className = 'zenlo-drawer-space'
      space.style.display = 'none'
    }
    if (space.parentElement !== row) row.appendChild(space)
    if (!drawer) return
    const home = document.getElementById('app') || document.body
    if (drawer.parentElement !== home) home.appendChild(drawer)
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
    // Out of the way for want of room is as good as closed to the user: the button brings it up
    const opening = drawer.hidden || isAway()
    drawer.hidden = false
    updateTheme()
    refreshNotice()
    refreshAsk()
    if (showHandlers[tab]) showHandlers[tab]()
    if (opening) {
      // Zenlo is the one opened last: a panel of Zalo's that is showing now gives way
      infoSeen = noticeInfo()
      makeRoom()
    }
    // The tab's content may come in a moment later: its buttons and fields may need more room
    relayout(true)
  }

  function close () {
    if (!drawer) return
    if (cancelDrag) cancelDrag()
    drawer.hidden = true
    floating = false
    drawer.classList.remove('zenlo-drawer--float', 'zenlo-drawer--away')
    setSpace(0)
  }

  function isOpen (tab) {
    return !!drawer && !drawer.hidden && (!tab || current === tab)
  }

  // Opens the drawer on a tab, or closes it when it already shows that tab
  function toggle (tab) {
    if (isOpen(tab) && !isAway()) close()
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

  // ---------- Width and room ----------

  // The width is the user's: dragged at the drawer's left edge, kept, reset by a double click. It
  // never makes Zalo overflow, and nothing is measured once and hard-coded: every check looks at the
  // page as it is now (window, Windows' zoom, Zalo's info panel, the open conversation). The drawer
  // behaves like Zalo's own info panel:
  // - beside the chat while there is room, narrower if it must;
  // - out of the way while the window is too small, back once there is room again;
  // - opened when there is no room: over the chat, as Zalo's panel opens in a small window.
  // Zalo's info panel and Zenlo share the right side: when both cannot fit, the one opened last stays.
  const DEFAULT_WIDTH = 400
  // Never narrower, beside the chat or dragged: a little more than the widest of the three tabs
  // needs with its usual content (measured 11/2026: 205 to 291). Without it the drawer took its
  // place by what was in it on opening, next to nothing while a list was still being read, and
  // jumped once the list came in.
  const MIN_WIDTH = 300
  let wanted = readWidth()
  let floating = false

  function readWidth () {
    try {
      const width = Number(localStorage.getItem(Z.STORAGE_KEYS.drawerWidth))
      return width > 0 ? Math.max(width, MIN_WIDTH) : DEFAULT_WIDTH
    } catch (error) {
      return DEFAULT_WIDTH
    }
  }

  // Kept even when it is the default: a missing key would come back from Zenlo's storage backup
  function saveWidth (width) {
    Z.setSetting(Z.STORAGE_KEYS.drawerWidth, String(width))
  }

  // 1 px of slack, as everywhere else: at an odd display scale scrollWidth may round one above
  const overflows = (el) => !!el && el.scrollWidth > el.clientWidth + 1
  const chatView = () => document.getElementById('chatViewContainer')
  const infoPanel = () => {
    const chat = chatView()
    return chat && chat.parentElement.querySelector(':scope > aside')
  }
  const infoButton = () => {
    // "fa-outline-right-bar", or "…-active" while the panel is open
    const icon = document.querySelector('#headerBtns [class*="fa-outline-right-bar"]')
    return icon && icon.closest('.z--btn--v2')
  }
  const isAway = () => !!drawer && drawer.classList.contains('zenlo-drawer--away')
  const isFloat = () => !!drawer && drawer.classList.contains('zenlo-drawer--float')
  const setWidth = (width) => { drawer.style.width = `${width}px` }

  // The room kept for the docked drawer in Zalo's window row (0: none), and how much it is now
  function setSpace (width) {
    if (!space) return
    space.style.display = width ? '' : 'none'
    if (width) space.style.width = `${width}px`
  }
  const spaceWidth = () => (space && space.isConnected && space.style.display !== 'none' ? space.getBoundingClientRect().width : 0)

  // The column the docked drawer takes its room from: the one that grows to fill Zalo's window row
  // (the chat, the welcome page, the contacts). None while a narrow window shows only the
  // conversation list.
  function area () {
    const row = host()
    if (!row) return null
    for (const child of row.children) {
      if (child === space || child.id === 'sidebarNav') continue
      // Zalo wraps the chat in an element that has no box of its own
      const items = window.getComputedStyle(child).display === 'contents' ? [...child.children] : [child]
      const growing = items.find((el) => Number(window.getComputedStyle(el).flexGrow) > 0)
      if (growing) return growing
    }
    return null
  }

  // What must keep its least width beside the drawer: the chat (Zalo's info panel may stand beside
  // it), or the whole column when it shows something else
  const kept = () => chatView() || area()

  // The narrowest chat Zalo itself ever shows: its window at its smallest, with only the icon bar
  // beside the chat. Narrower, Zalo's cards (files, links) clip what is inside them. Asked again
  // each time the room is worked out: Zalo sets its smallest window only once it has loaded.
  let windowMinWidth = 0
  function refreshMinWidth () {
    if (!window.$zenlo || !window.$zenlo.windowMinWidth) return
    window.$zenlo.windowMinWidth().then((width) => {
      if (!width || width === windowMinWidth) return
      windowMinWidth = width
      relayout()
    }, () => {})
  }
  function chatMinWidth () {
    const iconBar = document.getElementById('main-tab')
    return windowMinWidth && iconBar ? windowMinWidth - iconBar.getBoundingClientRect().width : 0
  }

  // Zalo's side still fits beside the room kept for the drawer: the chat is no narrower than Zalo
  // ever makes it, the title bar keeps all its buttons, no message sticks out of the chat (cards
  // such as link previews and photos have a width of their own and do not wrap), and that room is
  // not pushed out of the window
  function zaloFits () {
    const beside = kept()
    const row = host()
    if (!beside || !row) return false
    if (beside.getBoundingClientRect().width < chatMinWidth()) return false
    if (space.getBoundingClientRect().right > row.getBoundingClientRect().right + 1) return false
    const chat = chatView()
    if (!chat) return true
    if (overflows(document.getElementById('header'))) return false
    const { left, right } = chat.getBoundingClientRect()
    for (const frame of chat.querySelectorAll('[id^="message-frame_"]')) {
      const box = frame.getBoundingClientRect()
      if (box.width && (box.left < left - 1 || box.right > right + 1)) return false
    }
    return true
  }

  // Nothing of Zenlo sticks out of it: tabs, buttons, the length choice, the fields of the open tab
  function zenloFits () {
    const { right } = drawer.getBoundingClientRect()
    for (const el of drawer.querySelectorAll('.zenlo-drawer__head, .zenlo-drawer__tabs, .zenlo-drawer__notice, .zenlo-drawer__pane:not([hidden]) *')) {
      // An open dropdown may stick out for a moment; it is not what the drawer needs room for
      if (el.closest('.zenlo-select__list, .zenlo-copy__menu')) continue
      const box = el.getBoundingClientRect()
      if (box.width && box.right > right + 1) return false
    }
    return true
  }

  // Binary search between a width where ok() is `atLo` and one where it is not; `set` puts a width
  // on the drawer (what Zenlo needs) or on the room kept for it (what Zalo can give)
  function edge (lo, hi, ok, atLo, set = setWidth) {
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      set(mid)
      if (ok() === atLo) lo = mid
      else hi = mid
    }
    return atLo ? lo : hi
  }

  // What Zenlo needs is measured on the drawer alone: it lies over Zalo's page, so trying a width
  // on it costs Zalo nothing.

  // The narrowest width up to `most` at which nothing of Zenlo sticks out, or 0 when there is none
  function narrowestZenlo (most) {
    if (most < 1) return 0
    setWidth(most)
    if (!zenloFits()) return 0
    setWidth(1)
    return zenloFits() ? 1 : edge(1, most, zenloFits, false)
  }

  // The least width from `width` up to `most` at which nothing of Zenlo sticks out, or 0 when there
  // is none. Most often that is `width` itself, found with one look.
  function widthFrom (width, most) {
    width = Math.min(width, most)
    if (width < 1) return 0
    setWidth(width)
    if (zenloFits()) return width
    // Zenlo's content needs more than the user's width: a tab with wider fields, a longer line
    if (width === most) return 0
    setWidth(most)
    return zenloFits() ? edge(width, most, zenloFits, false) : 0
  }

  // The widest docked width up to `limit` with which everything fits, or 0 when there is none.
  // Leaves the room kept for the drawer at the last width tried.
  //
  // Zalo lays the whole chat out again for every width tried beside it, slowest of all for a chat
  // squeezed to nothing. So next to nothing is tried there: the most the chat can give comes from
  // its width now, less the least Zalo keeps for it, and only that one width is put beside it.
  function roomFor (limit) {
    const beside = kept()
    if (!beside || !space || !space.isConnected) return 0
    const taken = spaceWidth()
    const free = Math.floor(beside.getBoundingClientRect().width + taken - chatMinWidth())
    if (free < MIN_WIDTH) return 0
    const width = widthFrom(limit, free)
    if (!width) return 0
    if (Math.abs(taken - width) >= 1) setSpace(width)
    if (zaloFits()) return width
    // The title bar or a card of this conversation needs more than Zalo's least width
    const narrowest = Math.max(narrowestZenlo(width), MIN_WIDTH)
    if (narrowest >= width) return 0
    setSpace(narrowest)
    if (!zaloFits()) return 0
    return edge(narrowest, width, zaloFits, true, setSpace)
  }

  // The widest the drawer can be over the chat: what it covers there, never Zalo's icon bar
  function floatMost () {
    const under = kept()
    const row = host()
    const iconBar = document.getElementById('main-tab')
    let most = wanted
    if (under) most = under.getBoundingClientRect().width
    else if (row) most = row.clientWidth - (iconBar ? iconBar.getBoundingClientRect().width : 0)
    return Math.max(1, Math.floor(most))
  }

  // Over the chat: as wide as wanted (wider if Zenlo's content needs it), never wider than what it
  // covers
  function floatWidth () {
    const most = floatMost()
    return widthFrom(wanted, most) || most
  }

  // The drawer lies over the right end of Zalo's window row, from the top of its columns to their
  // bottom, so below Zalo's title bar: the window's own buttons (minimize, close) are there
  function place () {
    const row = host()
    if (!row) return
    const column = area() || document.getElementById('sidebarNav') || row
    const outer = row.getBoundingClientRect()
    const inner = column.getBoundingClientRect()
    const view = document.documentElement
    const edges = {
      top: `${inner.top}px`,
      bottom: `${view.clientHeight - inner.bottom}px`,
      right: `${view.clientWidth - (outer.left + row.clientLeft + row.clientWidth)}px`
    }
    // Written only when it moved: this also runs each time Zalo's page changes
    for (const side in edges) {
      if (drawer.style[side] !== edges[side]) drawer.style[side] = edges[side]
    }
  }

  // Zalo's info panel, as last looked at: there or not, and whether the one showing was opened by
  // the user (they did something in Zalo just before it came up) or brought back by Zalo itself
  // (its window got wide enough again). Looked at both when Zalo's page changes and when the
  // drawer is placed, whichever comes first.
  let infoThere = false
  let infoByUser = false
  function noticeInfo () {
    const there = !!infoPanel()
    if (there && !infoThere) infoByUser = Date.now() - lastAct < 1500
    infoThere = there
    return there
  }
  // Whether Zalo's info panel was there when the drawer last took its place
  let infoSeen = false

  // Places the drawer for the room there is now. `own`: what Zenlo itself shows changed (another
  // tab, a list that came in, a width the user set), not the room around it.
  // A layout asked for during a drag (the window changed size meanwhile) is done once it ends
  let missedLayout = false
  function layout (own) {
    if (dragging) {
      missedLayout = true
      return
    }
    if (!drawer || drawer.hidden) return
    attach()
    const shown = !isAway()
    const info = noticeInfo()
    // Measured as it will show: in place (its height decides whether a scrollbar takes width)
    drawer.classList.remove('zenlo-drawer--away')
    place()
    const width = roomFor(wanted)
    if (shown && info && !infoSeen && !width) {
      // Zalo's info panel came up while the drawer had its place, and the two do not fit: the one
      // opened last stays. Opened by the user: that is Zalo's panel, and Zenlo closes.
      infoSeen = true
      if (infoByUser) return close()
      // Brought back by Zalo: Zenlo was opened last and keeps its place, once the panel is gone
      closeInfo().then(() => layout(own))
      return
    }
    if (width) floating = false
    // Zenlo now needs more room than there is: over the chat rather than gone. Only less room
    // around it (a smaller window, Zalo's info panel) puts it out of the way.
    else if (own && shown) floating = true
    drawer.classList.toggle('zenlo-drawer--float', !width && floating)
    drawer.classList.toggle('zenlo-drawer--away', !width && !floating)
    setSpace(width)
    if (width) setWidth(width)
    else setWidth(floating ? floatWidth() : wanted)
    if (!isAway()) infoSeen = info
  }

  // Zalo's info panel is closed with its own button; Zalo takes it away at once or a moment later
  async function closeInfo () {
    const button = infoButton()
    if (!infoPanel() || !button) return
    button.click()
    for (let i = 0; i < 20 && infoPanel(); i++) await new Promise((resolve) => setTimeout(resolve, 25))
  }

  // The drawer was just opened: Zalo's info panel gives way if both cannot fit, and with no room
  // even then, the drawer opens over the chat
  async function makeRoom () {
    floating = false
    layout()
    if (!isAway()) return
    if (infoPanel()) {
      await closeInfo()
      if (drawer.hidden) return
      layout()
      if (!isAway()) return
    }
    floating = true
    layout()
  }

  // The narrowest and widest the drawer can be dragged to now. The widest starts from the one the
  // chat's own least width allows, which most often is it. Puts back what it tried, all before the
  // next paint.
  function dragBounds (startWidth) {
    const min = Math.min(Math.max(narrowestZenlo(startWidth), MIN_WIDTH), startWidth)
    setWidth(startWidth)
    if (floating) return { min, max: Math.max(floatMost(), startWidth) }
    const beside = kept()
    const taken = spaceWidth()
    let max = Math.floor(taken + (beside ? beside.getBoundingClientRect().width : 0) - Math.max(chatMinWidth(), 1))
    if (max > taken) {
      setSpace(max)
      if (!zaloFits()) {
        setSpace(taken)
        max = zaloFits() ? edge(taken, max, zaloFits, true, setSpace) : taken
      }
      setSpace(taken)
    }
    return { min, max: Math.max(max, startWidth) }
  }

  // Dragging moves only a line, and the drawer takes the width when the mouse is let go: Zalo lays
  // out the whole chat again for every width, too slow to do at each step of the mouse
  let dragging = false
  let cancelDrag = null
  function startDrag (event) {
    if (event.button !== 0 || dragging) return
    event.preventDefault()
    const handle = event.currentTarget
    const pointer = event.pointerId
    handle.setPointerCapture(pointer)
    const startX = event.clientX
    const box = drawer.getBoundingClientRect()
    const startWidth = box.width
    let bounds = null
    let target = startWidth
    dragging = true
    drawer.classList.add('zenlo-drawer--dragging')
    const line = document.createElement('div')
    line.className = 'zenlo-resize-line'
    line.style.top = `${box.top}px`
    line.style.height = `${box.height}px`
    line.style.left = `${box.left}px`
    document.body.append(line)
    const move = (e) => {
      if (!bounds) bounds = dragBounds(startWidth)
      target = Math.min(bounds.max, Math.max(bounds.min, Math.round(startWidth + startX - e.clientX)))
      line.style.transform = `translateX(${startWidth - target}px)`
    }
    const stop = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', stop)
      handle.removeEventListener('lostpointercapture', stop)
      // Cancelled with Esc: the mouse goes back to Zalo now, not when the button is let go
      try {
        handle.releasePointerCapture(pointer)
      } catch (error) {}
      line.remove()
      dragging = false
      cancelDrag = null
      drawer.classList.remove('zenlo-drawer--dragging')
      if (missedLayout) {
        missedLayout = false
        relayout()
      }
    }
    const end = () => {
      stop()
      if (Math.round(target) === Math.round(startWidth)) return
      wanted = Math.round(target)
      saveWidth(wanted)
      layout(true)
    }
    cancelDrag = stop
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', stop)
    handle.addEventListener('lostpointercapture', stop)
  }

  function resetWidth () {
    wanted = DEFAULT_WIDTH
    saveWidth(wanted)
    layout(true)
  }

  // Re-placed when the window or what is beside the drawer changes size
  let layoutTimer = null
  let layoutOwn = false
  function relayout (own) {
    // Also called with an event or a ResizeObserver's entries
    layoutOwn = layoutOwn || own === true
    clearTimeout(layoutTimer)
    layoutTimer = setTimeout(() => {
      const wasOwn = layoutOwn
      layoutOwn = false
      // Asked once per layout, and only while the drawer shows (not at every streamed line)
      if (isOpen()) refreshMinWidth()
      layout(wasOwn)
    }, 120)
  }
  refreshMinWidth()
  window.addEventListener('resize', relayout)
  // Zalo folds its conversation list, and hides or brings back its info panel, a moment after the
  // window changed size: the columns beside the drawer tell when
  const sizeWatch = new window.ResizeObserver(relayout)
  let watched = []
  function watchSizes () {
    const now = [document.getElementById('sidebarNav'), area()].filter(Boolean)
    if (now.length === watched.length && now.every((el, i) => el === watched[i])) return
    sizeWatch.disconnect()
    now.forEach((el) => sizeWatch.observe(el))
    watched = now
  }

  // When the user last did something in Zalo itself: tells a panel the user opened from one Zalo
  // brought back by itself
  // Only a click in Zalo's conversation header (its info button, the name) asks for that panel: the
  // window's maximize button also brings it back, Zalo's doing, and Zenlo must not close for it
  let lastAct = 0
  const noteAct = (event) => {
    if (event.isTrusted && event.target && event.target.closest && event.target.closest('#header')) lastAct = Date.now()
  }
  document.addEventListener('click', noteAct, true)
  document.addEventListener('keydown', noteAct, true)

  // The open conversation or Zalo's panels changed: the title bar may need more or less room
  let lastShape = ''
  function watchShape () {
    const info = noticeInfo()
    if (!isOpen()) return
    watchSizes()
    // Zalo's window row moved (it was still loading, a banner came up above it): the drawer follows
    if (!isAway()) place()
    const conv = Z.getCurrentConversation()
    const column = area()
    const shape = `${conv ? conv.id : ''}|${info}|${document.getElementById('header') ? 1 : 0}|${column ? column.tagName + column.id : ''}`
    // Also when Zalo draws a wide card (a photo, a link) that no longer fits while scrolling, or
    // Zenlo's own content (a tab just filled in) needs more room
    const shown = !dragging && !isAway()
    const ownMisfit = shown && !zenloFits()
    const misfit = ownMisfit || (shown && !isFloat() && !zaloFits())
    if (shape === lastShape && !misfit) return
    lastShape = shape
    relayout(ownMisfit)
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

  // One Zenlo button above "Zalo Cloud"
  function injectNavButton () {
    const bottom = document.querySelector('#main-tab .nav__tabs__bottom')
    if (!bottom || bottom.querySelector('.zenlo-nav-btn')) return
    const tab = document.createElement('div')
    tab.className = 'clickable leftbar-tab flx flx-col flx-al-c flx-center rel zenlo-nav-btn'
    tab.title = 'Zenlo'
    tab.innerHTML = `<div class="mmi-icon-wr zenlo-nav-btn__icon">${LOGO_SVG}</div><div class="lb-tab-title truncate">Zenlo</div>`
    tab.addEventListener('click', (event) => {
      event.stopPropagation()
      // The left-bar button is the way to the digest; the title-bar button is the way to the summary
      toggle('digest')
    })
    bottom.prepend(tab)
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen()) return
    // Esc while the width is dragged only drops the drag; a drawer that is out of the way stays open
    if (cancelDrag) cancelDrag()
    else if (!isAway()) close()
  })

  Z.onDomChange(() => {
    injectNavButton()
    // The room for the drawer is put in Zalo's window row ahead of time, so opening adds nothing there
    attach()
    watchShape()
  })
  setInterval(() => {
    if (isOpen()) updateTheme()
  }, 2000)

  Z.drawer = { open, close, toggle, isOpen, pane, onShow, refreshNotice, current: () => current }
})()
