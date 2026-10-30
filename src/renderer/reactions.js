/*
  Zenlo – trình quản lí hội thoại Zalo

  More reactions (renderer). Zalo knows about 80 reactions but its bar on a message shows 6.
  - a "+" at the end of that bar opens every reaction Zalo knows, with the ones used lately on top
  - "Sửa thanh nhanh" picks which 6 the bar itself shows (Zalo then draws them natively)
  Everything comes from Zalo at runtime: the list (updated by Zalo's server, so new or seasonal
  reactions show up by themselves), the emoji pictures, and the send itself (Zalo's own handler
  for that message, so a reaction is sent exactly like one clicked in Zalo's bar).
*/

(function () {
  const Z = window.ZenloCore

  const STORAGE_KEYS = {
    // rTypes of the quick bar, only while the user has changed it
    quick: '@Zenlo:REACTION_QUICK',
    // rTypes of the reactions last sent from the "+" panel, newest first
    recent: '@Zenlo:REACTION_RECENT'
  }
  const QUICK_MAX = 6
  const RECENT_MAX = 12

  const PLUS_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'

  // ---------- Zalo internals ----------

  const cache = {}

  // rType -> rIcon for every reaction Zalo knows
  function getIconMap () {
    try {
      const map = Z.getReactionCache().getIconMap()
      return map && typeof map === 'object' ? map : {}
    } catch (error) {
      return {}
    }
  }

  function getReactions () {
    const map = getIconMap()
    return Object.keys(map)
      .map(Number)
      .filter((rType) => Number.isInteger(rType) && typeof map[rType] === 'string')
      .sort((a, b) => a - b)
      .map((rType) => ({ rType, rIcon: map[rType] }))
  }

  // Zalo's settings object; its reactionMsgInfo is the list its quick bar draws
  function getZaloConfig () {
    if (!cache.config) cache.config = Z.findExport('NDmK', 'default', (v) => Array.isArray(v.reactionMsgInfo) && 'default_reaction' in v)
    return cache.config
  }

  // Turns an emoji code into what Zalo itself shows for it (React elements)
  function getEmojiRenderer () {
    if (!cache.renderer) cache.renderer = Z.findExport('AM4K', 'a', (v) => typeof v.getHtmlFromText === 'function')
    return cache.renderer
  }

  // The send handler of the message whose bar was hovered, found on Zalo's React component
  function findSendReaction (el) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactInternalInstance'))
    let fiber = key && el[key]
    for (let depth = 0; fiber && depth < 15; depth++) {
      const props = fiber.memoizedProps
      if (props && typeof props.sendReaction === 'function') return props.sendReaction
      fiber = fiber.return
    }
    return null
  }

  // ---------- Saved lists ----------

  function readTypes (key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null')
      return Array.isArray(value) ? value.filter(Number.isInteger) : null
    } catch (error) {
      return null
    }
  }

  function writeTypes (key, types) {
    try {
      if (types) localStorage.setItem(key, JSON.stringify(types))
      else localStorage.removeItem(key)
    } catch (error) {}
  }

  // Only reactions Zalo still knows, so a reaction Zalo drops never breaks the bar
  function toReactions (types) {
    const map = getIconMap()
    return (types || []).filter((t) => typeof map[t] === 'string').map((rType) => ({ rType, rIcon: map[rType] }))
  }

  function getRecent () {
    return toReactions(readTypes(STORAGE_KEYS.recent)).slice(0, RECENT_MAX)
  }

  function addRecent (rType) {
    const types = (readTypes(STORAGE_KEYS.recent) || []).filter((t) => t !== rType)
    types.unshift(rType)
    writeTypes(STORAGE_KEYS.recent, types.slice(0, RECENT_MAX))
  }

  // ---------- Quick bar ----------

  // Zalo's own list, kept up to date when Zalo changes it, so "Mặc định của Zalo" stays right
  let zaloQuick = null
  let customQuick = null
  let customQuickKey = ''

  function loadCustomQuick () {
    const types = readTypes(STORAGE_KEYS.quick)
    const key = types ? types.join(',') : ''
    if (key === customQuickKey && customQuick) return customQuick
    const list = toReactions(types).slice(0, QUICK_MAX)
    customQuickKey = key
    customQuick = list.length ? list : null
    return customQuick
  }

  function getZaloQuick () {
    return (zaloQuick || []).map((r) => ({ rType: r.rType, rIcon: r.rIcon }))
  }

  function getQuick () {
    return loadCustomQuick() || getZaloQuick()
  }

  // Zalo reads reactionMsgInfo every time it draws the bar; reading it now gives the user's list,
  // and Zalo writing it (a settings update from its server) still lands in zaloQuick
  function hookQuickBar () {
    const config = getZaloConfig()
    if (!config) return
    const descriptor = Object.getOwnPropertyDescriptor(config, 'reactionMsgInfo')
    if (descriptor && descriptor.get && descriptor.get.zenlo) return
    zaloQuick = descriptor && 'value' in descriptor ? descriptor.value : config.reactionMsgInfo
    const get = () => loadCustomQuick() || zaloQuick
    get.zenlo = true
    Object.defineProperty(config, 'reactionMsgInfo', {
      configurable: true,
      enumerable: true,
      get,
      set (value) {
        zaloQuick = value
      }
    })
  }

  function saveQuick (types) {
    const same = types.join(',') === getZaloQuick().map((r) => r.rType).join(',')
    writeTypes(STORAGE_KEYS.quick, types.length && !same ? types : null)
  }

  // ---------- Emoji pictures ----------

  const emojiCache = new Map()

  // React element tree -> DOM, enough for Zalo's emoji spans
  function toDOM (node) {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return document.createTextNode(String(node))
    if (Array.isArray(node)) {
      const fragment = document.createDocumentFragment()
      for (const child of node) {
        const el = toDOM(child)
        if (el) fragment.appendChild(el)
      }
      return fragment
    }
    if (typeof node.type !== 'string') return toDOM(node.props && node.props.children)
    const el = document.createElement(node.type)
    const props = node.props || {}
    if (props.className) el.className = props.className
    if (props.style) {
      for (const [name, value] of Object.entries(props.style)) {
        const css = name.replace(/^Webkit/, '-webkit-').replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
        el.style.setProperty(css, typeof value === 'number' && !/opacity|z-index/.test(css) ? value + 'px' : String(value))
      }
    }
    const child = toDOM(props.children)
    if (child) el.appendChild(child)
    return el
  }

  function emojiNode (rIcon) {
    if (!emojiCache.has(rIcon)) {
      let node = null
      try {
        node = toDOM(getEmojiRenderer().getHtmlFromText(rIcon))
      } catch (error) {}
      const wrap = document.createElement('span')
      wrap.className = 'zenlo-react__glyph'
      if (node) wrap.appendChild(node)
      else wrap.textContent = rIcon
      // A picture keeps its code as hidden text; a plain emoji (no picture) is shown as text
      if (!wrap.querySelector('[style*="background-image"]')) wrap.classList.add('zenlo-react__glyph--text')
      emojiCache.set(rIcon, wrap)
    }
    return emojiCache.get(rIcon).cloneNode(true)
  }

  function emojiButton (reaction, extraClass = '') {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'zenlo-react__emoji' + (extraClass ? ' ' + extraClass : '')
    button.dataset.rtype = String(reaction.rType)
    button.title = reaction.rIcon
    button.appendChild(emojiNode(reaction.rIcon))
    return button
  }

  // ---------- The "+" panel ----------

  let panel = null
  let target = null
  let editing = null

  function buildPanel () {
    const el = document.createElement('div')
    el.className = 'zenlo-react'
    el.hidden = true
    el.innerHTML = `
      <div class="zenlo-react__head">
        <span class="zenlo-react__title js-react-title"></span>
        <button type="button" class="zenlo__inline-link js-react-edit">Sửa thanh nhanh</button>
      </div>
      <div class="zenlo-react__edit js-react-edit-area" hidden>
        <div class="zenlo-react__hint">Bấm emoji bên dưới để thêm, bấm emoji ở đây để bỏ. Tối đa ${QUICK_MAX}.</div>
        <div class="zenlo-react__row zenlo-react__slots js-react-slots"></div>
        <div class="zenlo-react__actions">
          <button type="button" class="zenlo__inline-link js-react-default">Mặc định của Zalo</button>
          <span class="zenlo-react__spacer"></span>
          <button type="button" class="zenlo__inline-link js-react-cancel">Huỷ</button>
          <button type="button" class="zenlo-react__done js-react-done">Lưu</button>
        </div>
      </div>
      <div class="zenlo-react__section js-react-recent">
        <div class="zenlo-react__label">Gần đây</div>
        <div class="zenlo-react__row js-react-recent-row"></div>
      </div>
      <div class="zenlo-react__section">
        <div class="zenlo-react__label js-react-all-label">Tất cả</div>
        <div class="zenlo-react__grid js-react-all"></div>
      </div>`

    el.addEventListener('mousedown', (event) => event.stopPropagation())
    el.addEventListener('click', (event) => {
      event.stopPropagation()
      const button = event.target.closest('button')
      if (!button) return
      if (button.classList.contains('js-react-edit')) return startEditing()
      if (button.classList.contains('js-react-cancel')) return stopEditing()
      if (button.classList.contains('js-react-done')) {
        saveQuick(editing)
        return stopEditing()
      }
      if (button.classList.contains('js-react-default')) {
        editing = getZaloQuick().map((r) => r.rType)
        return render()
      }
      if (!button.dataset.rtype) return
      const rType = Number(button.dataset.rtype)
      if (editing) return toggleSlot(rType, button.classList.contains('zenlo-react__emoji--slot'))
      send(rType)
    })
    document.body.appendChild(el)
    return el
  }

  function startEditing () {
    editing = getQuick().map((r) => r.rType)
    render()
  }

  function stopEditing () {
    editing = null
    render()
  }

  function toggleSlot (rType, fromSlots) {
    const index = editing.indexOf(rType)
    if (index !== -1) editing.splice(index, 1)
    else if (!fromSlots && editing.length < QUICK_MAX) editing.push(rType)
    else if (!fromSlots) {
      const slots = panel.querySelector('.js-react-slots')
      // Shakes the full row (restarted on every extra click)
      slots.classList.remove('zenlo-react__slots--full')
      requestAnimationFrame(() => slots.classList.add('zenlo-react__slots--full'))
      return
    }
    render()
  }

  function fillRow (row, reactions, extraClass) {
    const fragment = document.createDocumentFragment()
    for (const reaction of reactions) fragment.appendChild(emojiButton(reaction, extraClass))
    row.replaceChildren(fragment)
  }

  function render () {
    const all = getReactions()
    const isEditing = !!editing
    panel.classList.toggle('zenlo-react--editing', isEditing)
    panel.querySelector('.js-react-title').textContent = isEditing ? 'Sửa thanh nhanh' : 'Thả cảm xúc'
    panel.querySelector('.js-react-edit').hidden = isEditing
    panel.querySelector('.js-react-edit-area').hidden = !isEditing
    panel.querySelector('.js-react-all-label').textContent = `Tất cả (${all.length})`

    const recent = isEditing ? [] : getRecent()
    panel.querySelector('.js-react-recent').hidden = !recent.length
    fillRow(panel.querySelector('.js-react-recent-row'), recent)

    if (isEditing) {
      const slots = toReactions(editing)
      const row = panel.querySelector('.js-react-slots')
      fillRow(row, slots, 'zenlo-react__emoji--slot')
      for (let i = slots.length; i < QUICK_MAX; i++) {
        const empty = document.createElement('span')
        empty.className = 'zenlo-react__empty'
        row.appendChild(empty)
      }
      panel.querySelector('.js-react-done').disabled = !slots.length
    }

    const grid = panel.querySelector('.js-react-all')
    fillRow(grid, all)
    if (isEditing) {
      for (const button of grid.children) button.classList.toggle('zenlo-react__emoji--picked', editing.includes(Number(button.dataset.rtype)))
    }
    place()
  }

  // Next to the bar it was opened from; again after every render, as editing changes the height
  function place () {
    const rect = target && target.anchor
    if (!rect) return
    const margin = 8
    panel.style.left = '0px'
    panel.style.top = '0px'
    const { width, height } = panel.getBoundingClientRect()
    const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin)
    // Above the bar when it fits there, else below it
    let top = rect.top - height - 6
    if (top < margin) top = Math.min(rect.bottom + 6, window.innerHeight - height - margin)
    panel.style.left = Math.round(left) + 'px'
    panel.style.top = Math.round(Math.max(margin, top)) + 'px'
  }

  function open (anchor, sendReaction) {
    if (!panel) panel = buildPanel()
    target = { sendReaction, anchor: anchor.getBoundingClientRect() }
    editing = null
    panel.hidden = false
    render()
  }

  function close () {
    if (!panel || panel.hidden) return
    panel.hidden = true
    target = null
    editing = null
  }

  function send (rType) {
    const icon = getIconMap()[rType]
    const sendReaction = target && target.sendReaction
    close()
    if (!sendReaction || typeof icon !== 'string') return
    try {
      sendReaction({ rType, rIcon: icon })
      addRecent(rType)
    } catch (error) {
      Z.log('reaction failed', error)
    }
  }

  // ---------- The "+" in Zalo's bar ----------

  function addPlusButtons () {
    if (!Z.isZaloReady()) return
    try {
      hookQuickBar()
    } catch (error) {}
    for (const list of document.querySelectorAll('.emoji-list-wrapper .reaction-emoji-list')) {
      if (list.querySelector(':scope > .zenlo-react-plus')) continue
      const plus = document.createElement('div')
      plus.className = 'reaction-emoji-icon zenlo-react-plus'
      plus.title = 'Thêm cảm xúc (Zenlo)'
      plus.innerHTML = PLUS_SVG
      plus.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (panel && !panel.hidden) return close()
        const sendReaction = findSendReaction(list.closest('.emoji-list-wrapper') || list)
        if (sendReaction) open(list, sendReaction)
      })
      list.appendChild(plus)
    }
  }

  Z.onDomChange(addPlusButtons)

  // Closes on a click elsewhere, Esc (before the drawer sees it), or scrolling the chat under it
  document.addEventListener('mousedown', (event) => {
    if (panel && !panel.contains(event.target) && !event.target.closest('.zenlo-react-plus')) close()
  }, true)
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !panel || panel.hidden) return
    event.stopPropagation()
    if (editing) stopEditing()
    else close()
  }, true)
  document.addEventListener('wheel', (event) => {
    if (panel && !panel.hidden && !panel.contains(event.target)) close()
  }, true)
  window.addEventListener('resize', close)
})()
