/*
  Zenlo – trình quản lí hội thoại Zalo

  Stickers from photos (renderer). Any picture becomes a sticker that every Zalo app shows like one
  of Zalo's own: no bubble, no frame, transparency kept, nothing to install on the other side.
  - a button next to Zalo's sticker button opens the user's stickers; "+" makes one from a file
  - right-clicking a photo in a chat adds "Làm sticker" to Zalo's menu
  - the editor places the picture (zoom out or in, move it), removes the background locally,
    frames it, and animates it as WebP with a motion, particles, light, words and an accessory
    dragged into place (sticker-effects.js), 25 frames a second
  - right-clicking a sticker in a chat saves it, or makes a still one move; Zalo's own stickers
    are kept by their id and sent as Zalo sends them, nothing uploaded
  - for a hard picture, remove.bg can do the cut-out: the user sends it there themselves, then
    drops or pastes the result back into the editor
  How it is sent is in core.js (uploadPhoto, sendPhotoSticker). The list of stickers is per Zalo
  account (localStorage, backed up with the rest of Zenlo's data); each sticker and its preview
  stay in IndexedDB, to upload them again if Zalo's server drops their links.
*/

import { canvasBlob, checkMotionUpload, createMotionSticker, MOTION_DURATION, MOTION_SCALE } from './sticker-motion.js'
import { ACCESSORIES, defaultPlace, drawFrame, drawStill, findHead, FRAME_COUNT, FRAMES, framePicture, isAnimated, LIGHTS, makePicture, MOTIONS, NO_EFFECTS, PARTICLES, TEXTS } from './sticker-effects.js'

(function () {
  const Z = window.ZenloCore
  // Zalo web is not tried yet: its upload may differ
  if (Z.IS_WEB) return

  const STORAGE_KEY = '@Zenlo:STICKERS'
  // Side of a sticker, in pixels: large enough for a phone screen, small enough to upload fast
  const SIZE = 512
  const MOTION_SIZE = 256
  const MASK_SIZE = 320
  const EDIT_MAX_SIDE = 2048
  const PREVIEW = 240
  // The picture can be made smaller than the sticker (room for words and effects) or larger
  const ZOOM_MIN = 0.5
  // The most stickers kept: past that, some must be removed before saving more
  const STORE_MAX = 100
  const STORE_FULL = `Bạn đã lưu đủ ${STORE_MAX} sticker. Hãy xoá bớt để lưu thêm.`
  const ZOOM_MAX = 4
  // A link is checked again before sending once it is older than this
  const CHECK_EVERY = 24 * 60 * 60 * 1000
  // A pixel counts as part of the subject from this opacity on (0-255), when trimming to it
  const SUBJECT_ALPHA = 24
  const REMOVE_BG = 'https://www.remove.bg/upload'
  const EXTERNAL_COPIED = 'Ảnh đã được chép. Trên remove.bg bấm Ctrl+V, tải ảnh PNG về, rồi kéo thả file vào đây, dán (Ctrl+V), hoặc '
  const EXTERNAL_NOT_COPIED = 'Không chép được ảnh: hãy tải ảnh lên remove.bg từ máy, tải ảnh PNG về, rồi kéo thả file vào đây, dán (Ctrl+V), hoặc '

  const ICON_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7l-7 7H6a2 2 0 0 1-2-2z"/><path d="M20 13h-5a2 2 0 0 0-2 2v5"/><circle cx="9" cy="9.5" r="1.3" fill="currentColor" stroke="none"/><path d="M7.5 14.5c1.4 1.3 3.6 1.3 5 0"/></svg>'
  const PLUS_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
  // The layers of a sticker, each a tab of the editor
  const FX_TABS = [
    { id: 'motion', label: 'Chuyển động', list: MOTIONS },
    { id: 'particle', label: 'Hiệu ứng', list: PARTICLES },
    { id: 'light', label: 'Ánh sáng', list: LIGHTS },
    { id: 'text', label: 'Chữ', list: TEXTS },
    { id: 'frame', label: 'Khung', list: FRAMES },
    { id: 'accessory', label: 'Phụ kiện', list: ACCESSORIES }
  ]
  // Sizes of an accessory, in the 120-wide space of a sticker
  const ACCESSORY_MIN = 6
  const ACCESSORY_MAX = 100
  // Shown in the previews of the words until the user types some
  const SAMPLE_WORDS = 'HAHA'
  const DICE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/></svg>'
  // Side of the small moving previews of the effects, in canvas pixels
  const TILE = 112

  // ---------- The list and the pictures ----------

  function readList () {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      return Array.isArray(list) ? list.filter((s) => s && typeof s.id === 'string' && typeof s.url === 'string') : []
    } catch (error) {
      return []
    }
  }

  function writeList (list) {
    try {
      if (list.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
      else localStorage.removeItem(STORAGE_KEY)
    } catch (error) {}
  }

  function updateSticker (id, changes) {
    writeList(readList().map((s) => (s.id === id ? { ...s, ...changes } : s)))
  }

  let dbPromise = null
  function openDB () {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = window.indexedDB.open('zenlo-stickers', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('png')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      dbPromise.catch(() => { dbPromise = null })
    }
    return dbPromise
  }

  async function dbRun (mode, action) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('png', mode)
      const request = action(transaction.objectStore('png'))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })
  }

  function savePicture (id, blob, thumbnail) {
    return dbRun('readwrite', (store) => {
      if (thumbnail) store.put(thumbnail, id + ':thumbnail')
      return store.put(blob, id)
    })
  }
  const loadPicture = (id) => dbRun('readonly', (store) => store.get(id)).catch(() => null)
  const deletePicture = (id) => dbRun('readwrite', (store) => store.delete(id)).catch(() => {})

  // ---------- Making and sending ----------

  function uploadImage (blob, width, height) {
    const extension = blob.type === 'image/webp' ? 'webp' : 'png'
    return Z.uploadPhoto(new File([blob], `zenlo-sticker.${extension}`, { type: blob.type }), width, height)
  }

  async function uploadSticker (blob, thumbnail, width, height, account) {
    ensureAccount(account)
    const url = await uploadImage(blob, width, height)
    if (!thumbnail) return { url }
    await checkMotionUpload(url, blob)
    ensureAccount(account)
    const thumbUrl = await uploadImage(thumbnail, width, height)
    return { url, thumbnail: thumbUrl }
  }

  const accountId = () => localStorage.getItem('@Zenlo:ACCOUNT')

  function ensureAccount (account) {
    if (account !== accountId()) throw new Error('Bạn đã đổi tài khoản. Hãy mở lại khung sticker.')
  }

  const isFull = () => readList().length >= STORE_MAX

  async function createSticker (blob, thumbnail, width, height) {
    if (isFull()) throw new Error(STORE_FULL)
    const account = accountId()
    const links = await uploadSticker(blob, thumbnail, width, height, account)
    const sticker = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...links, width, height, at: Date.now() }
    if (thumbnail) sticker.contentId = String(sticker.at)
    await savePicture(sticker.id, blob, thumbnail)
    ensureAccount(account)
    writeList([sticker, ...readList()])
    return sticker
  }

  async function isAlive (url) {
    try {
      const response = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(10000) })
      return response.ok
    } catch (error) {
      return false
    }
  }

  // Zalo keeps uploaded photos a long time, but how long is not known: a link not checked lately is
  // checked, and the picture is uploaded again when the link is gone
  async function refreshSticker (sticker, account) {
    if (Date.now() - (sticker.checkedAt || sticker.at || 0) < CHECK_EVERY) return sticker
    const links = sticker.thumbnail ? [sticker.url, sticker.thumbnail] : [sticker.url]
    if ((await Promise.all(links.map(isAlive))).every(Boolean)) {
      ensureAccount(account)
      updateSticker(sticker.id, { checkedAt: Date.now() })
      return sticker
    }
    const blob = await loadPicture(sticker.id)
    const thumbnail = sticker.thumbnail ? await loadPicture(sticker.id + ':thumbnail') : null
    if (!blob || (sticker.thumbnail && !thumbnail)) {
      throw new Error('Ảnh của sticker này không còn trên máy chủ Zalo và máy này không giữ đủ dữ liệu. Hãy tạo lại sticker.')
    }
    const uploaded = await uploadSticker(blob, thumbnail, sticker.width, sticker.height, account)
    ensureAccount(account)
    updateSticker(sticker.id, { ...uploaded, checkedAt: Date.now() })
    return { ...sticker, ...uploaded }
  }

  async function sendSticker (sticker, convId = Z.getCurrentConversation()?.id) {
    if (!convId) throw new Error('Hãy mở cuộc trò chuyện muốn gửi sticker.')
    if (sticker.zalo) return Z.sendZaloSticker(sticker.zalo, { expectedId: convId })
    const account = accountId()
    const current = await refreshSticker(sticker, account)
    ensureAccount(account)
    await Z.sendPhotoSticker(current.url, current.width, current.height, {
      expectedId: convId,
      thumbnail: current.thumbnail,
      contentId: current.contentId || String(current.at)
    })
  }

  function report (error) {
    Z.log('sticker failed', error)
    window.alert('Zenlo: ' + ((error && error.message) || 'Không làm được sticker.'))
  }

  // ---------- Reading a picture ----------

  async function loadBitmap (sources) {
    for (const source of sources) {
      if (!source) continue
      try {
        const blob = source instanceof Blob ? source : await (await fetch(source, { signal: AbortSignal.timeout(15000) })).blob()
        if (blob.type && !blob.type.startsWith('image/')) continue
        const bitmap = await window.createImageBitmap(blob)
        const ratio = EDIT_MAX_SIDE / Math.max(bitmap.width, bitmap.height)
        if (ratio >= 1) return bitmap
        try {
          return await window.createImageBitmap(bitmap, {
            resizeWidth: Math.max(1, Math.round(bitmap.width * ratio)),
            resizeHeight: Math.max(1, Math.round(bitmap.height * ratio)),
            resizeQuality: 'high'
          })
        } finally {
          bitmap.close()
        }
      } catch (error) {}
    }
    throw new Error('Không đọc được ảnh này.')
  }

  // ---------- Editor ----------

  let editor = null
  let edit = null
  let previewFrame = 0

  function buildEditor () {
    const el = document.createElement('div')
    el.className = 'zenlo-stk-editor'
    el.hidden = true
    el.innerHTML = `
      <div class="zenlo-stk-editor__card" role="dialog" aria-label="Làm sticker">
        <div class="zenlo-stk-editor__title">Làm sticker</div>
        <canvas class="zenlo-stk-editor__stage js-stk-stage" width="${PREVIEW}" height="${PREVIEW}"></canvas>
        <label class="zenlo-stk-editor__zoom js-stk-zoom">
          <span>Thu phóng</span>
          <input type="range" min="${ZOOM_MIN}" max="${ZOOM_MAX}" step="0.01" value="1" class="js-stk-zoom-input">
        </label>
        <div class="zenlo-stk-editor__tools">
          <button type="button" class="zenlo-stk-editor__save js-stk-background">Tách nền</button>
          <button type="button" class="zenlo-stk-editor__save js-stk-removebg" title="Gửi ảnh lên remove.bg để tách kỹ hơn">remove.bg ↗</button>
        </div>
        <div class="zenlo-stk-fx">
          <div class="zenlo-stk-fx__tabs" role="tablist">
            ${FX_TABS.map((tab) => `<button type="button" role="tab" data-fx-tab="${tab.id}">${tab.label}</button>`).join('')}
            <button type="button" class="zenlo-stk-fx__random js-stk-random" title="Chọn ngẫu nhiên chuyển động, hiệu ứng và ánh sáng" aria-label="Ngẫu nhiên">${DICE_SVG}</button>
          </div>
          <input type="text" class="zenlo-stk-fx__words js-stk-words" maxlength="40" placeholder="Gõ chữ cho sticker…" spellcheck="false" hidden>
          <label class="zenlo-stk-editor__zoom js-stk-acc-size" hidden>
            <span>Cỡ phụ kiện</span>
            <input type="range" min="${ACCESSORY_MIN}" max="${ACCESSORY_MAX}" step="1" class="js-stk-acc-size-input">
          </label>
          <div class="zenlo-stk-fx__grid js-stk-fx-grid"></div>
        </div>
        <div class="zenlo-stk-editor__hint js-stk-hint"></div>
        <div class="zenlo-stk-editor__external js-stk-external" hidden><span class="js-stk-external-text"></span><button type="button" class="zenlo__inline-link js-stk-pick">chọn file</button>.</div>
        <input type="file" accept="image/*" class="js-stk-cutout-file" hidden>
        <div class="zenlo-stk-editor__status js-stk-status" role="status"></div>
        <div class="zenlo-stk-editor__actions">
          <button type="button" class="zenlo__inline-link js-stk-cancel">Huỷ</button>
          <span class="zenlo-react__spacer"></span>
          <button type="button" class="zenlo-stk-editor__save js-stk-save">Lưu</button>
          <button type="button" class="zenlo-react__done js-stk-send">Lưu và gửi</button>
        </div>
      </div>`

    const stage = el.querySelector('.js-stk-stage')
    // A picture cut out elsewhere (remove.bg) comes back by file, drop or paste
    const cutoutFile = el.querySelector('.js-stk-cutout-file')
    cutoutFile.addEventListener('change', () => {
      const file = cutoutFile.files && cutoutFile.files[0]
      cutoutFile.value = ''
      if (file) replaceImage(file)
    })
    el.addEventListener('dragover', (event) => {
      if (!edit || edit.busy || !event.dataTransfer || ![...event.dataTransfer.types].includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    })
    el.addEventListener('drop', (event) => {
      const file = [...(event.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'))
      if (!file || !edit || edit.busy) return
      event.preventDefault()
      replaceImage(file)
    })
    el.addEventListener('mousedown', (event) => {
      event.stopPropagation()
      if (event.target === el && canClose()) closeEditor()
    })
    el.addEventListener('click', (event) => {
      event.stopPropagation()
      const button = event.target.closest('button')
      if (button && button.classList.contains('js-stk-cancel') && canClose()) return closeEditor()
      if (!button || !edit || edit.busy) return
      if (button.dataset.fxTab) {
        edit.tab = button.dataset.fxTab
        return renderTabs()
      }
      if (button.dataset.fx) {
        // A rounded or round frame is filled by the picture, unless the user placed it already
        if (edit.tab === 'frame' && ['rounded', 'circle'].includes(button.dataset.fx) && !edit.placed) fillSquare()
        edit.fx = { ...edit.fx, [edit.tab]: button.dataset.fx }
        // An accessory goes where the head seems to be, until the user moves it
        if (edit.tab === 'accessory') {
          edit.fx.place = button.dataset.fx === 'none' ? null : (edit.placeMoved && edit.fx.place) || defaultPlace(button.dataset.fx, edit.head)
        }
        edit.saved = null
        renderEditor()
        // A style of words with no words yet: where to type them
        if (edit.tab === 'text' && button.dataset.fx !== 'none' && !edit.fx.caption.trim()) el.querySelector('.js-stk-words').focus()
        return
      }
      if (button.classList.contains('js-stk-random')) {
        edit.fx = randomEffects()
        edit.saved = null
        return renderEditor()
      }
      if (button.classList.contains('js-stk-background')) return toggleBackground()
      if (button.classList.contains('js-stk-removebg')) return openRemoveBg()
      if (button.classList.contains('js-stk-pick')) return el.querySelector('.js-stk-cutout-file').click()
      if (button.classList.contains('js-stk-cancel')) return closeEditor()
      if (button.classList.contains('js-stk-save')) return finish(false)
      if (button.classList.contains('js-stk-send')) return finish(true)
    })
    const words = el.querySelector('.js-stk-words')
    words.addEventListener('input', () => {
      if (!edit || edit.busy) return
      edit.fx = { ...edit.fx, caption: words.value }
      // Typing picks a style of words if none is picked
      if (words.value.trim() && edit.fx.text === 'none') edit.fx.text = 'bounce'
      edit.saved = null
      renderEditor()
    })
    // Keys typed here are for the words, not for Zalo's shortcuts (Esc still closes the editor)
    for (const type of ['keydown', 'keyup', 'keypress']) {
      words.addEventListener(type, (event) => {
        if (event.key !== 'Escape') event.stopPropagation()
      })
    }
    el.querySelector('.js-stk-acc-size-input').addEventListener('input', (event) => {
      if (!edit || edit.busy || !edit.fx.place) return
      resizeAccessory(Number(event.target.value))
    })
    el.querySelector('.js-stk-zoom-input').addEventListener('input', (event) => {
      if (!edit || edit.busy) return
      zoomTo(Number(event.target.value))
    })

    // Dragging moves the picture under the frame, or the accessory on the picture; the wheel zooms
    // the picture, or sizes the accessory
    let drag = null
    stage.addEventListener('pointerdown', (event) => {
      if (!edit || edit.busy) return
      drag = { x: event.clientX, y: event.clientY, accessory: movingAccessory() }
      stage.setPointerCapture(event.pointerId)
    })
    stage.addEventListener('pointermove', (event) => {
      if (!drag || !edit || edit.busy) return
      if (drag.accessory) {
        // From the stage's pixels to the sticker's 120-wide space
        const unit = 120 / stage.getBoundingClientRect().width
        const place = edit.fx.place
        const limit = 70
        edit.fx = {
          ...edit.fx,
          place: {
            ...place,
            x: Math.min(limit, Math.max(-limit, place.x + (event.clientX - drag.x) * unit)),
            y: Math.min(limit, Math.max(-limit, place.y + (event.clientY - drag.y) * unit))
          }
        }
        edit.placeMoved = true
        edit.saved = null
        edit.frame = -1
        drag = { ...drag, x: event.clientX, y: event.clientY }
        return
      }
      // From the stage's pixels to parts of the picture's square (smaller in an animated sticker)
      const side = stage.getBoundingClientRect().width * (isAnimated(edit.fx) ? MOTION_SCALE : 1)
      edit.ox += (event.clientX - drag.x) / side
      edit.oy += (event.clientY - drag.y) / side
      edit.placed = true
      edit.saved = null
      drag = { x: event.clientX, y: event.clientY }
      clampPlace()
      renderEditor()
    })
    stage.addEventListener('pointerup', () => { drag = null })
    stage.addEventListener('pointercancel', () => { drag = null })
    stage.addEventListener('wheel', (event) => {
      if (!edit || edit.busy) return
      if (movingAccessory()) {
        event.preventDefault()
        return resizeAccessory(edit.fx.place.size * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
      }
      event.preventDefault()
      zoomTo(edit.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
    }, { passive: false })

    document.body.appendChild(el)
    return el
  }

  // The accessory tab is open with an accessory picked: dragging on the preview moves it
  function movingAccessory () {
    return !!edit && edit.tab === 'accessory' && edit.fx.accessory !== 'none' && !!edit.fx.place
  }

  function resizeAccessory (size) {
    const value = Math.min(ACCESSORY_MAX, Math.max(ACCESSORY_MIN, size))
    edit.fx = { ...edit.fx, place: { ...edit.fx.place, size: value } }
    editor.querySelector('.js-stk-acc-size-input').value = String(Math.round(value))
    edit.placeMoved = true
    edit.saved = null
    edit.frame = -1
  }

  // The picture the sticker is made from: the cut-out once the background is removed
  function source () {
    return edit.backgroundRemoved ? edit.cutout : edit.bitmap
  }

  // Where the picture sits in the sticker's square: at 1 it fits whole, ox and oy move its middle
  // away from the square's middle (in parts of the square's side)
  function placedSize (side) {
    const { width, height } = source()
    const scale = (side / Math.max(width, height)) * edit.zoom
    return { w: width * scale, h: height * scale }
  }

  // At least a little of the picture stays in the square
  function clampPlace () {
    const { w, h } = placedSize(1)
    const limitX = Math.max(0, 0.5 + w / 2 - 0.1)
    const limitY = Math.max(0, 0.5 + h / 2 - 0.1)
    edit.ox = Math.min(limitX, Math.max(-limitX, edit.ox))
    edit.oy = Math.min(limitY, Math.max(-limitY, edit.oy))
  }

  function zoomTo (zoom) {
    edit.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
    edit.placed = true
    edit.saved = null
    clampPlace()
    renderEditor()
  }

  // Back to the whole picture, in the middle, after the picture itself changed
  function resetPlace () {
    edit.zoom = 1
    edit.ox = 0
    edit.oy = 0
    edit.placed = false
  }

  // Large enough to cover the whole square, in the middle
  function fillSquare () {
    const { width, height } = source()
    edit.zoom = Math.min(ZOOM_MAX, Math.max(width, height) / Math.min(width, height))
    edit.ox = 0
    edit.oy = 0
  }

  // Draws the picture, as placed, into the square of `side` at (x, y); what is outside is left out
  function drawFitted (ctx, x, y, side) {
    const { w, h } = placedSize(side)
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, side, side)
    ctx.clip()
    ctx.drawImage(source(), x + side / 2 + edit.ox * side - w / 2, y + side / 2 + edit.oy * side - h / 2, w, h)
    ctx.restore()
  }

  function stopPreview () {
    window.cancelAnimationFrame(previewFrame)
    previewFrame = 0
  }

  // The preview and the small previews of the effects move together, frame by frame of the sticker
  // to be made, so what is seen is what is sent
  function startPreview () {
    if (previewFrame) return
    const stage = editor.querySelector('.js-stk-stage').getContext('2d')
    const step = (now) => {
      previewFrame = requestAnimationFrame(step)
      if (!edit || editor.hidden) return stopPreview()
      const index = Math.floor(((now % MOTION_DURATION) / MOTION_DURATION) * FRAME_COUNT)
      if (index === edit.frame) return
      edit.frame = index
      const phase = index / FRAME_COUNT
      stage.clearRect(0, 0, PREVIEW, PREVIEW)
      if (isAnimated(edit.fx)) drawFrame(stage, PREVIEW, edit.fx, phase, edit.picture)
      else if (edit.still) drawStill(stage, PREVIEW, edit.fx, edit.still)
      else drawFitted(stage, 0, 0, PREVIEW)
      // Only the previews in sight of the scrolled list are drawn
      const grid = editor.querySelector('.js-stk-fx-grid')
      const top = grid.scrollTop
      const bottom = top + grid.clientHeight
      for (const tile of edit.tiles) {
        const y = tile.button.offsetTop
        if (y > bottom || y + tile.button.offsetHeight < top) continue
        tile.ctx.clearRect(0, 0, TILE, TILE)
        drawFrame(tile.ctx, TILE, tile.fx, phase, tile.picture || edit.picture)
      }
    }
    previewFrame = requestAnimationFrame(step)
  }

  function renderTabs () {
    for (const button of editor.querySelectorAll('[data-fx-tab]')) {
      const id = button.dataset.fxTab
      button.classList.toggle('is-active', id === edit.tab)
      button.setAttribute('aria-selected', String(id === edit.tab))
      // A dot on the tabs where something is picked
      button.classList.toggle('has-pick', edit.fx[id] !== NO_EFFECTS[id])
    }
    const tab = FX_TABS.find((t) => t.id === edit.tab)
    const grid = editor.querySelector('.js-stk-fx-grid')
    if (grid.dataset.tab !== tab.id) {
      grid.dataset.tab = tab.id
      grid.innerHTML = tab.list.map((effect) => `
        <button type="button" class="zenlo-stk-fx__tile" data-fx="${effect.id}" title="${effect.label}">
          <canvas width="${TILE}" height="${TILE}"></canvas><span>${effect.label}</span>
        </button>`).join('')
      grid.scrollTop = 0
    }
    const words = editor.querySelector('.js-stk-words')
    words.hidden = tab.id !== 'text'
    if (words.value !== edit.fx.caption) words.value = edit.fx.caption
    const moving = movingAccessory()
    editor.querySelector('.js-stk-acc-size').hidden = !moving
    if (moving) editor.querySelector('.js-stk-acc-size-input').value = String(Math.round(edit.fx.place.size))
    editor.querySelector('.js-stk-hint').textContent = moving
      ? 'Kéo phụ kiện vào đúng chỗ trên ảnh, cuộn chuột để đổi cỡ.'
      : 'Kéo ảnh để căn chỉnh, cuộn chuột để thu phóng.'
    edit.tiles = [...grid.querySelectorAll('[data-fx]')].map((button) => {
      const effect = tab.list.find((e) => e.id === button.dataset.fx)
      return {
        button,
        ctx: button.querySelector('canvas').getContext('2d'),
        // Each preview shows its effect alone (with a motion for those seen only on a moving picture)
        fx: {
          ...NO_EFFECTS,
          ...effect.demo,
          [tab.id]: effect.id,
          caption: tab.id === 'text' ? (edit.fx.caption.trim() || SAMPLE_WORDS) : '',
          place: tab.id === 'accessory' && effect.id !== 'none' ? defaultPlace(effect.id, edit.head) : null
        },
        picture: tab.id === 'frame' ? makePicture(TILE, drawFitted, effect.id) : null
      }
    })
    for (const button of grid.querySelectorAll('[data-fx]')) {
      const active = button.dataset.fx === edit.fx[tab.id]
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', String(active))
    }
    edit.frame = -1
  }

  // A motion always, often particles, sometimes light; the words and the frame stay as they are
  function randomEffects () {
    const pick = (list) => list[1 + Math.floor(Math.random() * (list.length - 1))].id
    return {
      ...edit.fx,
      motion: pick(MOTIONS),
      particle: Math.random() < 0.7 ? pick(PARTICLES) : 'none',
      light: Math.random() < 0.5 ? pick(LIGHTS) : 'none'
    }
  }

  function renderEditor () {
    // The sticker's picture with its frame, drawn once; every frame of the previews only moves it
    edit.picture = makePicture(PREVIEW, drawFitted, edit.fx.frame)
    edit.head = findHead(edit.picture)
    if (edit.fx.accessory !== 'none' && !edit.placeMoved) edit.fx = { ...edit.fx, place: defaultPlace(edit.fx.accessory, edit.head) }
    // A still sticker fills the whole square
    edit.still = isAnimated(edit.fx) ? null : framePicture(PREVIEW, drawFitted, edit.fx.frame)
    edit.frame = -1

    editor.querySelector('.js-stk-background').textContent = edit.backgroundRemoved ? 'Khôi phục nền' : 'Tách nền'
    editor.querySelector('.js-stk-zoom-input').value = String(edit.zoom)
    renderTabs()
    startPreview()
  }

  function setBusy (text, isError = false) {
    edit.busy = !!text && !isError
    const status = editor.querySelector('.js-stk-status')
    status.textContent = text || ''
    status.classList.toggle('is-error', isError)
    for (const button of editor.querySelectorAll('button')) button.disabled = edit.busy
    editor.querySelector('.js-stk-zoom-input').disabled = edit.busy
    // Waiting on background removal (the first time, a 15 MB download) can be left with Huỷ or Esc
    if (edit.busy && edit.cancellable) editor.querySelector('.js-stk-cancel').disabled = false
  }

  const canClose = () => edit && (!edit.busy || edit.cancellable)

  async function toggleBackground () {
    if (edit.cutout) {
      edit.backgroundRemoved = !edit.backgroundRemoved
      edit.saved = null
      resetPlace()
      setBusy('')
      return renderEditor()
    }
    // The editor this removal is for: closed (Huỷ, Esc) or reopened meanwhile, the result is dropped
    const job = edit
    job.cancellable = true
    setBusy('Đang tách nền trên máy…')
    try {
      const background = window.$zenlo?.removeStickerBackground
      if (!background) throw new Error('Hãy mở lại Zalo để nạp công cụ tách nền.')
      const ready = window.$zenlo.stickerBackgroundReady ? await window.$zenlo.stickerBackgroundReady() : true
      if (edit !== job) return
      if (!ready) setBusy('Lần đầu: đang tải công cụ tách nền (khoảng 15 MB)…')
      const input = document.createElement('canvas')
      input.width = input.height = MASK_SIZE
      let ctx = input.getContext('2d', { willReadFrequently: true })
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE)
      ctx.drawImage(edit.bitmap, 0, 0, MASK_SIZE, MASK_SIZE)
      const pixels = ctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data
      const result = await background(new Uint8Array(pixels.buffer))
      if (edit !== job) return
      job.cancellable = false
      if (!result?.mask || result.mask.length !== MASK_SIZE * MASK_SIZE) {
        throw new Error(result?.error || 'Không nhận được kết quả tách nền.')
      }
      const mask = ctx.createImageData(MASK_SIZE, MASK_SIZE)
      for (let i = 0; i < result.mask.length; i++) mask.data[i * 4 + 3] = result.mask[i]
      ctx.putImageData(mask, 0, 0)
      const cutout = document.createElement('canvas')
      cutout.width = edit.bitmap.width
      cutout.height = edit.bitmap.height
      ctx = cutout.getContext('2d')
      ctx.drawImage(edit.bitmap, 0, 0)
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(input, 0, 0, cutout.width, cutout.height)
      edit.cutout = trimToSubject(cutout)
      edit.backgroundRemoved = true
      edit.saved = null
      resetPlace()
      setBusy('')
      renderEditor()
    } catch (error) {
      Z.log('sticker: background removal failed', error)
      if (edit !== job) return
      job.cancellable = false
      setBusy(error.message || 'Không tách được nền.', true)
    } finally {
      job.cancellable = false
    }
  }

  // The picture cut to its visible part, with a small margin, so the subject fills the sticker
  // instead of sitting small in an empty frame. The same picture when nothing is transparent.
  function trimToSubject (image) {
    const scale = Math.min(1, MASK_SIZE / Math.max(image.width, image.height))
    const w = Math.max(1, Math.round(image.width * scale))
    const h = Math.max(1, Math.round(image.height * scale))
    const probe = document.createElement('canvas')
    probe.width = w
    probe.height = h
    const ctx = probe.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(image, 0, 0, w, h)
    const pixels = ctx.getImageData(0, 0, w, h).data
    let left = w
    let top = h
    let right = -1
    let bottom = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (pixels[(y * w + x) * 4 + 3] < SUBJECT_ALPHA) continue
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
    if (right < 0) return image
    const margin = Math.round(Math.max(right - left, bottom - top) * 0.04) + 1
    const x0 = Math.max(0, Math.floor((left - margin) / scale))
    const y0 = Math.max(0, Math.floor((top - margin) / scale))
    const x1 = Math.min(image.width, Math.ceil((right + 1 + margin) / scale))
    const y1 = Math.min(image.height, Math.ceil((bottom + 1 + margin) / scale))
    if (x1 - x0 >= image.width * 0.98 && y1 - y0 >= image.height * 0.98) return image
    const trimmed = document.createElement('canvas')
    trimmed.width = x1 - x0
    trimmed.height = y1 - y0
    trimmed.getContext('2d').drawImage(image, x0, y0, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height)
    return trimmed
  }

  // remove.bg is the user's own choice, as the picture leaves this computer for that site. The
  // picture is copied so it can be pasted there; the cut-out comes back by drop, paste or file.
  async function openRemoveBg () {
    let copied = false
    try {
      const canvas = document.createElement('canvas')
      canvas.width = edit.bitmap.width
      canvas.height = edit.bitmap.height
      canvas.getContext('2d').drawImage(edit.bitmap, 0, 0)
      const blob = await canvasBlob(canvas)
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
      copied = true
    } catch (error) {
      Z.log('sticker: copy for remove.bg failed', error)
    }
    editor.querySelector('.js-stk-external-text').textContent = copied ? EXTERNAL_COPIED : EXTERNAL_NOT_COPIED
    editor.querySelector('.js-stk-external').hidden = false
    Z.openLink(REMOVE_BG)
  }

  // A picture from elsewhere (usually remove.bg's PNG) takes the place of the one being edited;
  // the effects stay
  async function replaceImage (file) {
    let bitmap
    try {
      bitmap = await loadBitmap([file])
    } catch (error) {
      // The editor may have closed, or begun saving, while the file was read
      if (edit && !edit.busy) setBusy(error.message, true)
      return
    }
    if (!edit || edit.busy) return bitmap.close()
    if (edit.bitmap.close) edit.bitmap.close()
    edit.bitmap = trimToSubject(bitmap)
    if (edit.bitmap !== bitmap) bitmap.close()
    edit.cutout = null
    edit.backgroundRemoved = false
    edit.saved = null
    resetPlace()
    editor.querySelector('.js-stk-external').hidden = true
    setBusy('')
    renderEditor()
  }

  // options.fx: effects picked from the start (a still sticker made to move)
  async function openEditor (sources, options = {}) {
    let loaded
    try {
      loaded = await loadBitmap(sources)
    } catch (error) {
      return report(error)
    }
    if (!editor) editor = buildEditor()
    if (edit?.busy) return loaded.close()
    // A transparent picture (a sticker, a cut-out) loses its empty border
    const bitmap = trimToSubject(loaded)
    if (bitmap !== loaded) loaded.close()
    closeEditor()
    closeStore()
    edit = {
      bitmap,
      fx: { ...NO_EFFECTS, ...options.fx },
      tab: 'motion',
      tiles: [],
      zoom: 1,
      ox: 0,
      oy: 0,
      busy: false
    }
    editor.querySelector('.js-stk-external').hidden = true
    editor.hidden = false
    // Said at once, not after the work of making it
    setBusy(isFull() ? STORE_FULL : '', isFull())
    renderEditor()
  }

  function closeEditor () {
    if (!editor || editor.hidden) return
    stopPreview()
    editor.hidden = true
    if (edit && edit.bitmap.close) edit.bitmap.close()
    edit = null
  }

  async function finish (andSend) {
    const convId = Z.getCurrentConversation()?.id
    if (andSend && !convId) return setBusy('Hãy mở cuộc trò chuyện muốn gửi sticker.', true)
    try {
      if (!edit.saved) {
        if (isFull()) return setBusy(STORE_FULL, true)
        setBusy('Đang tạo sticker…')
        const still = !isAnimated(edit.fx)
        const width = still ? SIZE : MOTION_SIZE
        const height = width
        let image
        if (still) {
          const canvas = document.createElement('canvas')
          canvas.width = SIZE
          canvas.height = SIZE
          drawStill(canvas.getContext('2d'), SIZE, edit.fx, framePicture(SIZE, drawFitted, edit.fx.frame))
          image = { blob: await canvasBlob(canvas) }
        } else {
          image = await createMotionSticker(MOTION_SIZE, edit.fx, makePicture(MOTION_SIZE, drawFitted, edit.fx.frame))
        }
        setBusy('Đang tải sticker lên Zalo…')
        edit.saved = await createSticker(image.blob, image.thumbnail, width, height)
      }
      if (andSend) {
        setBusy('Đang gửi…')
        await sendSticker(edit.saved, convId)
      }
      edit.busy = false
      closeEditor()
    } catch (error) {
      Z.log('sticker failed', error)
      setBusy((error && error.message) || 'Không làm được sticker.', true)
    }
  }

  // ---------- The user's stickers ----------

  let store = null
  let anchor = null

  function buildStore () {
    const el = document.createElement('div')
    el.className = 'zenlo-react zenlo-stk'
    el.hidden = true
    el.innerHTML = `
      <div class="zenlo-react__head">
        <span class="zenlo-react__title">Sticker của bạn</span>
        <span class="zenlo-stk__count js-stk-count" title="Số sticker đã lưu, tối đa ${STORE_MAX}"></span>
      </div>
      <div class="zenlo-stk__grid js-stk-grid"></div>
      <div class="zenlo-react__hint zenlo-stk__hint js-stk-empty">Bấm + để chọn ảnh trên máy, dán ảnh bằng Ctrl+V, hoặc chuột phải vào một ảnh trong chat rồi chọn "Làm sticker".</div>
      <input type="file" accept="image/*" class="js-stk-file" hidden>`

    const fileInput = el.querySelector('.js-stk-file')
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0]
      fileInput.value = ''
      if (file) openEditor([file])
    })
    el.addEventListener('mousedown', (event) => event.stopPropagation())
    el.addEventListener('click', (event) => {
      event.stopPropagation()
      const button = event.target.closest('button')
      if (!button) return
      if (button.classList.contains('js-stk-new')) return fileInput.click()
      const tile = button.closest('.zenlo-stk__tile')
      if (!tile) return
      const sticker = readList().find((s) => s.id === tile.dataset.id)
      if (!sticker) return renderStore()
      if (button.classList.contains('js-stk-delete')) return tile.classList.add('is-confirming')
      if (button.classList.contains('js-stk-animate')) {
        closeStore()
        loadPicture(sticker.id).then((blob) => openEditor([blob, sticker.url], { fx: { motion: 'bounce' } }))
        return
      }
      if (button.classList.contains('js-stk-confirm')) {
        writeList(readList().filter((s) => s.id !== sticker.id))
        deletePicture(sticker.id)
        if (sticker.thumbnail) deletePicture(sticker.id + ':thumbnail')
        return renderStore()
      }
      closeStore()
      sendSticker(sticker).then(() => moveFirst(sticker.id)).catch(report)
    })
    // Right-click on a sticker asks to remove it, like its ×
    el.addEventListener('contextmenu', (event) => {
      const tile = event.target.closest('.zenlo-stk__tile')
      if (!tile) return
      event.preventDefault()
      tile.classList.add('is-confirming')
    })
    el.addEventListener('mouseleave', () => {
      for (const tile of el.querySelectorAll('.is-confirming')) tile.classList.remove('is-confirming')
    })
    document.body.appendChild(el)
    return el
  }

  // The sticker last sent comes first, so the ones in use are at hand
  function moveFirst (id) {
    const list = readList()
    const sticker = list.find((s) => s.id === id)
    if (!sticker || list[0] === sticker) return
    writeList([sticker, ...list.filter((s) => s !== sticker)])
    if (store && !store.hidden) renderStore()
  }

  function tilePicture (s) {
    const frames = Math.round(Number(s.frames))
    if (s.zalo && frames > 1) {
      // Zalo plays them at about 60 ms a frame; 0% to 100% is the first frame to the last
      const style = `background-image: url('${encodeURI(s.url)}'); background-size: ${frames * 100}% 100%; ` +
        `animation-duration: ${frames * 60}ms; animation-timing-function: steps(${frames}, jump-none);`
      return `<span class="zenlo-stk__sprite" style="${Z.escapeHTML(style)}"></span>`
    }
    return `<img src="${Z.escapeHTML(s.url)}" alt="" loading="lazy" draggable="false">`
  }

  function renderStore () {
    const list = readList()
    const grid = store.querySelector('.js-stk-grid')
    grid.innerHTML = `<button type="button" class="zenlo-stk__new js-stk-new" title="Tạo sticker từ ảnh trên máy, hoặc dán ảnh bằng Ctrl+V">${PLUS_SVG}</button>` +
      list.map((s) => `
        <div class="zenlo-stk__tile" data-id="${Z.escapeHTML(s.id)}">
          <button type="button" class="zenlo-stk__pick" title="Gửi sticker${s.thumbnail || s.frames > 1 ? ' động' : ''}">${tilePicture(s)}</button>
          ${s.thumbnail || s.frames > 1 ? '' : '<button type="button" class="zenlo-stk__animate js-stk-animate" title="Làm sticker động">✦</button>'}
          <button type="button" class="zenlo-stk__delete js-stk-delete" title="Xoá khỏi danh sách">×</button>
          <button type="button" class="zenlo-stk__confirm js-stk-confirm">Xoá?</button>
        </div>`).join('')
    // A link Zalo no longer serves still shows from the copy on this computer
    for (const img of grid.querySelectorAll('img')) {
      img.addEventListener('error', async () => {
        const id = img.closest('.zenlo-stk__tile')?.dataset.id
        if (!id) return
        const blob = await loadPicture(id)
        if (!blob || !img.isConnected) return
        const url = URL.createObjectURL(blob)
        img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true })
        img.addEventListener('error', () => URL.revokeObjectURL(url), { once: true })
        img.src = url
      }, { once: true })
    }
    store.querySelector('.js-stk-empty').hidden = list.length > 0
    const count = store.querySelector('.js-stk-count')
    count.textContent = `${list.length}/${STORE_MAX}`
    count.classList.toggle('is-full', list.length >= STORE_MAX)
    place()
  }

  // Above the button it was opened from
  function place () {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const margin = 8
    store.style.left = '0px'
    store.style.top = '0px'
    const { width, height } = store.getBoundingClientRect()
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin)
    let top = rect.top - height - 6
    if (top < margin) top = Math.min(rect.bottom + 6, window.innerHeight - height - margin)
    store.style.left = Math.round(left) + 'px'
    store.style.top = Math.round(Math.max(margin, top)) + 'px'
  }

  function openStore (button) {
    if (!store) store = buildStore()
    anchor = button
    store.hidden = false
    renderStore()
  }

  function closeStore () {
    if (!store || store.hidden) return
    store.hidden = true
    anchor = null
  }

  // ---------- The button in the message box's toolbar ----------

  function addToolbarButton () {
    const toolbar = document.querySelector('#chat-box-bar-id ul.chat-box-toolbar')
    if (!toolbar || toolbar.querySelector('.zenlo-stk-item')) return
    const item = document.createElement('li')
    item.className = 'chat-box-toolbar-item zenlo-stk-item'
    item.innerHTML = `<div class="z--btn--v2 btn-tertiary-neutral medium chat-box-toolbar-button --rounded icon-only zenlo-stk-button" title="Sticker từ ảnh (Zenlo)">${ICON_SVG}</div>`
    const button = item.firstElementChild
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (store && !store.hidden) return closeStore()
      openStore(button)
    })
    // Next to Zalo's own sticker button
    const zaloSticker = toolbar.querySelector('[data-id="div_Sticker_Menu"]')
    const after = zaloSticker && zaloSticker.closest('li')
    if (after && after.parentElement === toolbar) after.after(item)
    else toolbar.prepend(item)
  }

  // ---------- Zalo's menu on a photo or a sticker in a chat ----------

  // What was last right-clicked: a photo (the links of its larger versions) or a sticker
  let clicked = null

  // The message (of type `type`) an element belongs to
  function messageOf (el, type) {
    let fiber = Z.reactFiberOf(el)
    for (let depth = 0; fiber && depth < 40; depth++) {
      const props = fiber.memoizedProps || {}
      const message = props.message || props.data
      if (message && message.msgType === type && message.message && typeof message.message === 'object') return message.message
      fiber = fiber.return
    }
    return null
  }

  // A sticker of Zalo's: its id, set and type, and how many frames it has (a moving one is drawn
  // from a strip of frames side by side)
  function zaloStickerOf (content, sprite) {
    const id = Number(content.id)
    const catId = Number(content.catId ?? content.cateId)
    const type = Number(content.type)
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(catId) || !Number.isInteger(type)) return null
    let frames = 1
    if (sprite) {
      // Both in CSS pixels (Zalo's zoom changes the size on screen, not these)
      const style = window.getComputedStyle(sprite)
      const strip = parseFloat(style.backgroundSize)
      const width = parseFloat(style.width)
      if (sprite.style.backgroundSize && strip > 0 && width > 0) frames = Math.max(1, Math.round(strip / width))
    }
    const url = frames > 1
      ? `https://zalo-api.zadn.vn/api/emoticon/sprite?eid=${id}&size=130`
      : `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${id}&size=240`
    // The copy Zalo keeps on this computer, for the editor if the link above fails
    const local = sprite && /^url\("(file:[^"]+)"\)$/.exec(sprite.style.backgroundImage || '')
    return { zalo: { id, catId, type }, frames, url, local: local ? local[1] : null, width: 130, height: 130 }
  }

  const isZaloMedia = (url) => {
    try {
      const address = new URL(url)
      return address.protocol === 'https:' && /(^|\.)(zdn\.vn|zadn\.vn)$/.test(address.hostname)
    } catch (error) {
      return false
    }
  }

  // A sticker made from a picture: its file (an animated WebP for a moving one), size and preview
  function stickerOf (content) {
    let params = {}
    try {
      params = JSON.parse(content.params || '{}') || {}
    } catch (error) {}
    const webp = params.webp && params.webp.url
    const url = webp || content.hdUrl || content.oriUrl
    const width = Number((params.webp && params.webp.width) || params.width)
    const height = Number((params.webp && params.webp.height) || params.height)
    if (!isZaloMedia(url) || !(width > 0) || !(height > 0)) return null
    const thumbnail = webp && isZaloMedia(content.thumbUrl) ? content.thumbUrl : null
    if (webp && !thumbnail) return null
    return { url, thumbnail, width, height, contentId: params.contentId ? String(params.contentId) : '' }
  }

  document.addEventListener('contextmenu', (event) => {
    const target = event.target.closest ? event.target : null
    clicked = null
    if (!target) return
    const zaloSticker = target.closest('.normal-sticker-message-content')
    if (zaloSticker) {
      const message = messageOf(target, 4)
      const sprite = zaloSticker.querySelector('.normal-sticker-message-content__sticker')
      const sticker = message && zaloStickerOf(message, sprite)
      if (sticker) clicked = { sticker, at: Date.now() }
      return
    }
    if (target.closest('.ai-sticker-message-content-wrapper, .no-border-photo-sticker-message-content-wrapper')) {
      const content = messageOf(target, 2)
      const sticker = content && stickerOf(content)
      if (sticker) clicked = { sticker, at: Date.now() }
      return
    }
    const img = target.closest('.message-view__scroll__inner img.zimg-el')
    if (!img) return
    const content = messageOf(img, 2) || {}
    // The message's own links are whatever its sender wrote: only Zalo's media servers are read.
    // The picture Zalo itself shows (its cache on this computer) is the last resort.
    const links = [content.hdUrl, content.oriUrl, content.normalUrl].filter(isZaloMedia)
    clicked = { sources: [...links, img.currentSrc || img.src], at: Date.now() }
  }, true)

  const MENU_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7l-7 7H6a2 2 0 0 1-2-2z"/><path d="M20 13h-5a2 2 0 0 0-2 2v5"/></svg>'
  const SAVE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>'
  const MOVE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>'

  function menuItem (icon, label, onClick) {
    const item = document.createElement('div')
    item.className = 'zmenu-item --NORMAL md zenlo-stk-menu'
    item.innerHTML = `<i class="menu-icon left zenlo-stk-menu__icon">${icon}</i><div class="truncate flx-1"><span></span></div>`
    item.querySelector('span').textContent = label
    item.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      closeZaloMenu()
      onClick()
    })
    return item
  }

  function addMenuItem () {
    if (!clicked || Date.now() - clicked.at > 5000) return
    const menus = [...document.querySelectorAll('.popover-v3 .zmenu-body')]
    const body = menus.find((menu) => menu.querySelector('[data-translate-inner="STR_FORWARD_MSG"]'))
    if (!body || body.querySelector('.zenlo-stk-menu')) return
    const copy = body.querySelector('[data-translate-inner="STR_COPY_PHOTO"]')
    if (clicked.sticker) {
      if (copy) return
      const sticker = clicked.sticker
      const after = body.querySelector('[data-translate-inner="STR_FORWARD_MSG"]').closest('.zmenu-item')
      if (!after) return
      const items = [menuItem(SAVE_ICON, 'Lưu sticker', () => saveFromChat(sticker))]
      if (!sticker.thumbnail && !(sticker.frames > 1)) items.push(menuItem(MOVE_ICON, 'Làm sticker động', () => openEditor([sticker.url, sticker.local], { fx: { motion: 'bounce' } })))
      after.after(...items)
      return
    }
    if (!copy) return
    const save = body.querySelector('[data-translate-inner="STR_SAVE_TO_DEVICE"]')
    const after = (save || copy).closest('.zmenu-item')
    if (!after) return
    const sources = clicked.sources
    after.after(menuItem(MENU_ICON, 'Làm sticker', () => openEditor(sources)))
  }

  // The type a file really has: Zalo serves every upload as ".jpg", whatever is inside
  function sniffType (bytes) {
    const text = (from, to) => String.fromCharCode(...bytes.subarray(from, to))
    if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp'
    if (bytes[0] === 0x89 && text(1, 4) === 'PNG') return 'image/png'
    if (text(0, 3) === 'GIF') return 'image/gif'
    return 'image/jpeg'
  }

  // A sticker from a chat is a few hundred KB; anything far larger is not one
  const DOWNLOAD_MAX = 20 * 1024 * 1024

  async function download (url) {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (Number(response.headers.get('content-length')) > DOWNLOAD_MAX) throw new Error('Sticker quá lớn.')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > DOWNLOAD_MAX) throw new Error('Sticker quá lớn.')
    return new Blob([bytes], { type: sniffType(bytes) })
  }

  // A sticker someone sent goes into the user's stickers as it is: same link, so nothing is uploaded;
  // its file is kept on this computer like the user's own
  async function saveFromChat (info) {
    const account = accountId()
    const same = (s) => (info.zalo ? s.zalo && s.zalo.id === info.zalo.id : s.url === info.url)
    if (readList().some(same)) return toast('Sticker này đã có trong Sticker của bạn.')
    if (isFull()) return toast(STORE_FULL)
    if (info.zalo) {
      // Kept by its id: Zalo has the pictures, nothing to download or upload
      const at = Date.now()
      ensureAccount(account)
      writeList([{ id: at.toString(36) + Math.random().toString(36).slice(2, 6), url: info.url, zalo: info.zalo, frames: info.frames, width: info.width, height: info.height, at, checkedAt: at }, ...readList()])
      return toast('Đã lưu vào Sticker của bạn.')
    }
    try {
      const blob = await download(info.url)
      const thumbnail = info.thumbnail ? await download(info.thumbnail) : null
      const at = Date.now()
      const sticker = { id: at.toString(36) + Math.random().toString(36).slice(2, 6), url: info.url, width: info.width, height: info.height, at, checkedAt: at }
      if (info.thumbnail) {
        sticker.thumbnail = info.thumbnail
        sticker.contentId = info.contentId || String(at)
      }
      ensureAccount(account)
      await savePicture(sticker.id, blob, thumbnail)
      writeList([sticker, ...readList()])
      toast('Đã lưu vào Sticker của bạn.')
    } catch (error) {
      Z.log('sticker: save from chat failed', error)
      report(new Error(error.message?.startsWith('Bạn đã đổi') ? error.message : 'Không lưu được sticker này. Hãy thử lại.'))
    }
  }

  let toastTimer = 0
  function toast (text) {
    let el = document.querySelector('.zenlo-stk-toast')
    if (!el) {
      el = document.createElement('div')
      el.className = 'zenlo-stk-toast'
      el.setAttribute('role', 'status')
      document.body.appendChild(el)
    }
    el.textContent = text
    el.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { el.hidden = true }, 2500)
  }

  // Zalo closes its menu on a click outside it
  function closeZaloMenu () {
    const target = document.querySelector('#chat-box-bar-id') || document.body
    for (const type of ['mousedown', 'mouseup', 'click']) target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
  }

  Z.onDomChange(() => {
    if (!Z.isZaloReady()) return
    addToolbarButton()
    addMenuItem()
  })

  // The panel closes on a click elsewhere or Esc (before the drawer sees it); the editor on Esc
  document.addEventListener('mousedown', (event) => {
    if (store && !store.contains(event.target) && !event.target.closest('.zenlo-stk-button')) closeStore()
  }, true)
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    if (editor && !editor.hidden) {
      event.stopPropagation()
      if (canClose()) closeEditor()
    } else if (store && !store.hidden) {
      event.stopPropagation()
      closeStore()
    }
  }, true)
  window.addEventListener('resize', closeStore)
  // Ctrl+V of a picture while the editor is open replaces the one being edited; while the user's
  // stickers are open, it makes a sticker of it
  document.addEventListener('paste', (event) => {
    const editing = editor && !editor.hidden
    const choosing = store && !store.hidden
    if ((!editing && !choosing) || edit?.busy) return
    const items = [...(event.clipboardData?.items || [])]
    const file = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    if (!file) return
    event.preventDefault()
    event.stopPropagation()
    if (editing) replaceImage(file)
    else openEditor([file])
  }, true)
})()
