/*
  Zenlo – trình quản lí hội thoại Zalo

  Digest ("Bản tin", renderer): a button in Zalo's left bar that lists every conversation
  with unread messages (by Zenlo's own read watermark, not Zalo's) and summarizes them all.
  Messages are read from the local store, so Zalo sends no "seen" receipt.
*/

(function () {
  const Z = window.ZenloCore
  const { formatTime, escapeHTML } = Z

  const SYSTEM_PROMPT = [
    'Bạn viết bản tin lướt nhanh các cuộc trò chuyện Zalo có tin mới cho người dùng Zenlo ("Tôi" trong bản chép). Gọi người dùng là "bạn"; gọi người khác theo tên hiển thị.',
    'Mục tiêu: liếc qua là biết cuộc nào cần bạn để ý, có gì mới. Rất ngắn, đúng nội dung, không suy đoán.',
    'Đổi mốc thời gian tương đối ("mai", "thứ 6", "tối nay") thành ngày cụ thể dd/mm, tính từ ngày của tin nhắn chứa nó; hạn đã qua thì ghi "(đã qua)".',
    'Bỏ qua chào hỏi, tán gẫu, sticker và tin hệ thống, trừ khi chúng mang thông tin quan trọng. Không dùng bảng hay dấu `code`.',
    Z.CITATION_RULE
  ].join('\n')

  const ICON_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6M7 17h4"/><path d="M18.5 13.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></svg>'

  let overlay = null
  // Each item is either pending (unread, can be ticked) or done (already summarized, kept from the saved digest)
  let items = []
  let activeCall = null
  let rawOutput = ''

  // The latest digest results, kept so they survive closing the panel, "Làm mới" and Zalo restarts
  const DIGEST_KEY = '@Zenlo:DIGEST_LAST'

  function loadSavedDigest () {
    try {
      const saved = JSON.parse(localStorage.getItem(DIGEST_KEY) || '[]')
      // Results older than 24h are no longer useful
      return Array.isArray(saved) ? saved.filter((entry) => Date.now() - entry.at < Z.MAX_RANGE) : []
    } catch (error) {
      return []
    }
  }

  function saveDigest (entries) {
    try {
      localStorage.setItem(DIGEST_KEY, JSON.stringify(entries))
    } catch (error) {}
  }

  function rememberSummaries (summarized) {
    const ids = new Set(summarized.map((item) => item.convId))
    const at = Date.now()
    const kept = loadSavedDigest().filter((entry) => !ids.has(entry.convId))
    saveDigest(kept.concat(summarized.map((item) => ({
      convId: item.convId,
      name: item.name,
      isGroup: item.isGroup,
      mentions: item.mentions,
      count: item.count,
      lastTime: item.lastTime,
      start: item.start,
      summary: item.summary,
      at
    }))))
  }

  function forgetSummary (convId) {
    saveDigest(loadSavedDigest().filter((entry) => entry.convId !== convId))
  }

  // ---------- Data ----------

  let scanId = 0

  // Every conversation with messages from others after its unread start (at most 24h back).
  // Zalo's in-memory previews pick the candidates first, so only those are read from the message store.
  async function collectUnread (onProgress) {
    const myScan = ++scanId
    const now = Date.now()
    const mentions = Z.getMentionCounts()
    const candidates = Z.getConversationPreviews()
      .filter((p) => !p.fromMe && p.time > Math.max(Z.getReadWatermark(p.convId), now - Z.MAX_RANGE))
      .sort((a, b) => b.time - a.time)
    const found = []

    for (let i = 0; i < candidates.length; i++) {
      // A newer scan started (e.g. "Làm mới"): stop this one
      if (myScan !== scanId) return null
      const { convId, time: lastTime } = candidates[i]
      onProgress(i + 1, candidates.length)

      const { messages: recent } = await Z.loadMessagesInRange(convId, now - Z.MAX_RANGE, now)
      const start = await Z.getUnreadStart(convId, recent, now)
      const unread = recent.filter((m) => Number(m.sendDttm) > start && m.fromUid !== '0')
      if (!unread.length) continue

      const messages = recent.filter((m) => Number(m.sendDttm) > start)
      const { lines, count } = await Z.prepareTranscript(messages)
      if (!count) continue

      found.push({
        convId,
        name: Z.getConvName(convId),
        isGroup: convId.startsWith('g'),
        mentions: mentions[convId] || 0,
        start,
        count: unread.length,
        lastTime,
        lines,
        summary: '',
        selected: !unticked.has(convId)
      })
    }

    return sortItems(found)
  }

  // ---------- Priority order ----------

  // The order the user set by dragging, as a list of conversation ids.
  // Keep this storage key stable forever: the user wants this order remembered across every Zenlo update.
  const ORDER_KEY = '@Zenlo:DIGEST_ORDER'

  function loadOrder () {
    try {
      const order = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]')
      return Array.isArray(order) ? order : []
    } catch (error) {
      return []
    }
  }

  function saveOrder (order) {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(order))
    } catch (error) {}
  }

  // Conversations the user unticked; they start unticked next time too.
  // Keep this storage key stable forever, like ORDER_KEY.
  const UNTICKED_KEY = '@Zenlo:DIGEST_UNTICKED'
  let unticked = new Set()
  try {
    unticked = new Set(JSON.parse(localStorage.getItem(UNTICKED_KEY) || '[]'))
  } catch (error) {}

  function rememberTick (convId, selected) {
    if (selected) unticked.delete(convId)
    else unticked.add(convId)
    try {
      localStorage.setItem(UNTICKED_KEY, JSON.stringify([...unticked]))
    } catch (error) {}
  }

  // Automatic order: @mentions first, then direct chats, then the most recent
  function autoCompare (a, b) {
    return (b.mentions > 0) - (a.mentions > 0) || a.isGroup - b.isGroup || b.lastTime - a.lastTime
  }

  // Conversations the user has ranked come first in their order; the rest follow in automatic order
  function sortItems (list) {
    const rank = new Map(loadOrder().map((id, i) => [id, i]))
    return list.sort((a, b) => {
      const ra = rank.has(a.convId) ? rank.get(a.convId) : Infinity
      const rb = rank.has(b.convId) ? rank.get(b.convId) : Infinity
      return ra !== rb ? ra - rb : autoCompare(a, b)
    })
  }

  // Saves the new order of the visible conversations without disturbing the saved rank of
  // conversations that are not in this digest: the visible ones are written back into their own slots.
  function rememberVisibleOrder () {
    const saved = loadOrder()
    for (const item of items) {
      if (!saved.includes(item.convId)) saved.push(item.convId)
    }
    const visible = new Set(items.map((item) => item.convId))
    const slots = saved.map((id, i) => (visible.has(id) ? i : -1)).filter((i) => i >= 0)
    slots.forEach((slot, i) => {
      saved[slot] = items[i].convId
    })
    saveOrder(saved)
  }

  // ---------- UI ----------

  function setStatus (text, isError = false) {
    const el = overlay.querySelector('.zenlo-digest__status')
    el.textContent = text
    el.classList.toggle('zenlo__status--error', isError)
  }

  function renderItems () {
    const list = overlay.querySelector('.zenlo-digest__list')
    const locked = !!activeCall
    list.classList.toggle('zenlo-digest__list--locked', locked)
    list.innerHTML = items.map((item, i) => `
      <div class="zenlo-digest__card${item.done || item.selected ? '' : ' zenlo-digest__card--off'}" data-index="${i}">
        <div class="zenlo-digest__card-head">
          <span class="zenlo-digest__handle" title="Giữ và kéo để sắp xếp ưu tiên">⋮⋮</span>
          ${item.done
            ? '<span class="zenlo-digest__done" title="Đã tóm tắt">✓</span>'
            : `<input type="checkbox" class="zenlo-digest__check js-digest-check" title="Tóm tắt hội thoại này" ${item.selected ? 'checked' : ''} ${locked ? 'disabled' : ''}>`}
          <div class="zenlo-digest__name">${escapeHTML(item.name)}</div>
          <div class="zenlo-digest__meta">
            ${item.mentions ? '<span class="zenlo-digest__badge">@ nhắc bạn</span>' : ''}
            ${item.count} tin${item.done ? '' : ' mới'} · ${formatTime(item.lastTime)}
          </div>
        </div>
        <div class="zenlo-digest__summary">${item.summary ? Z.renderMarkdown(item.summary) : ''}</div>
        <div class="zenlo-digest__card-actions">
          <button class="zenlo__btn js-digest-open">Mở</button>
          <button class="zenlo__btn js-digest-detail">Tóm tắt chi tiết</button>
          <button class="zenlo__btn js-digest-skip">Bỏ qua</button>
        </div>
      </div>
    `).join('')

    const pending = items.filter((item) => !item.done)
    const selected = pending.filter((item) => item.selected)
    const total = selected.reduce((sum, item) => sum + item.count, 0)
    const chars = selected.reduce((sum, item) => sum + item.lines.join('\n').length, 0)
    overlay.querySelector('.zenlo-digest__summary-line').textContent = pending.length
      ? `Đã chọn ${selected.length}/${pending.length} hội thoại · ${total} tin mới · ước tính ~${Z.estimateTokens(chars).toLocaleString('vi-VN')} token`
      : ''
    overlay.querySelector('.js-digest-run').disabled = !selected.length || locked
    overlay.querySelector('.js-digest-read-all').disabled = !items.length || locked
    overlay.querySelector('.zenlo-digest__select').hidden = !items.length

    // Fallback when the answer could not be split per conversation: show it as is
    const raw = overlay.querySelector('.zenlo-digest__raw')
    raw.hidden = !rawOutput
    raw.innerHTML = rawOutput ? Z.renderMarkdown(rawOutput) : ''
    overlay.querySelectorAll('.zenlo-digest__select button').forEach((button) => {
      button.disabled = locked
    })
  }

  function setSelected (item, selected) {
    item.selected = selected
    rememberTick(item.convId, selected)
  }

  function setAllSelected (selected) {
    for (const item of items) {
      if (!item.done) setSelected(item, selected)
    }
    renderItems()
  }

  function removeItem (index) {
    forgetSummary(items[index].convId)
    items.splice(index, 1)
    renderItems()
  }

  // Unread conversations from a fresh scan, plus saved results of conversations with nothing new since
  async function refresh () {
    if (activeCall) return
    const saved = loadSavedDigest().map((entry) => ({ ...entry, done: true, selected: false, lines: [] }))
    items = sortItems(saved)
    rawOutput = ''
    renderItems()
    setStatus('Đang tìm hội thoại có tin mới…')
    try {
      const result = await collectUnread((done, total) => setStatus(`Đang đọc tin mới… ${done}/${total} hội thoại`))
      if (!result) return
      const fresh = new Set(result.map((item) => item.convId))
      items = sortItems(result.concat(saved.filter((entry) => !fresh.has(entry.convId))))
      setStatus(result.length ? '' : 'Không có tin mới trong 24 giờ qua.')
    } catch (error) {
      setStatus(`Lỗi: ${error.message || error}`, true)
    }
    renderItems()
  }

  // Splits the model output into one summary per conversation. The model is asked for "### [n]",
  // but it sometimes writes "### n", "### n." or "## n - name", so all of these are accepted.
  const SECTION_HEADING = /^#{1,4}[ \t]*\[?[ \t]*(\d{1,3})[ \t]*\]?(?=$|[ \t.:)\-–—])[^\n]*$/m

  function applyOutput (text, batch) {
    const parts = text.split(SECTION_HEADING)
    let found = 0
    for (let i = 1; i < parts.length; i += 2) {
      const item = batch[Number(parts[i]) - 1]
      if (item && parts[i + 1].trim()) {
        item.summary = parts[i + 1].trim()
        found++
      }
    }
    return found
  }

  async function runDigest () {
    // Only the ticked conversations; unticked ones keep their read watermark for next time
    const chosen = items.filter((item) => !item.done && item.selected)
    if (activeCall || !chosen.length) return
    const { model, effort } = Z.getModelSettings()
    const stopButton = overlay.querySelector('.js-digest-stop')
    stopButton.hidden = false

    let cancelled = false
    let unparsed = 0
    rawOutput = ''
    const batches = Z.splitIntoChunks(chosen, (item) => item.lines.join('\n').length + 100)

    try {
      for (let b = 0; b < batches.length; b++) {
        const batch = batches[b]
        setStatus(`Đang tạo bản tin${batches.length > 1 ? ` (phần ${b + 1}/${batches.length})` : ''} bằng ${model}…`)

        const input = batch.map((item, i) => [
          `<conversation id="${i + 1}" name="${item.name.replace(/"/g, "'")}" type="${item.isGroup ? 'nhóm' : 'cá nhân'}">`,
          ...item.lines,
          '</conversation>'
        ].join('\n')).join('\n\n')

        let streamed = ''
        // Set before the call starts so the list renders locked (no ticking or dragging while it runs)
        activeCall = { cancel: () => {} }
        renderItems()
        activeCall = Z.runClaude({
          systemPrompt: SYSTEM_PROMPT,
          model,
          effort,
          instruction: [
            `Có ${batch.length} cuộc trò chuyện với tin mới. Với MỖI cuộc trò chuyện, theo đúng thứ tự id, viết "### [id]" trên một dòng riêng (giữ nguyên dấu ngoặc vuông), rồi 1–3 gạch đầu dòng, mỗi dòng tối đa khoảng 25 từ:`,
            'nếu có ai hỏi, nhờ, nhắc hoặc giao việc cho bạn thì dòng đầu bắt đầu bằng **Cần bạn:**; các dòng sau là chuyện chính, quyết định, hạn chót.',
            'Cuộc nào chỉ toàn tán gẫu thì viết đúng một dòng "- Chỉ tán gẫu." (không cần mốc).',
            'Không viết gì ngoài các phần đó. Mẫu:\n### [1]\n- **Cần bạn:** ... [dd/mm hh:mm]\n- ... [dd/mm hh:mm]\n### [2]\n- Chỉ tán gẫu.'
          ].join(' '),
          input
        }, (text) => {
          streamed += text
          applyOutput(streamed, batch)
          renderItems()
        })
        stopButton.onclick = () => {
          cancelled = true
          activeCall.cancel()
        }

        const output = await activeCall.promise
        applyOutput(output, batch)
        if (cancelled) break

        const summarized = batch.filter((item) => item.summary)
        if (summarized.length < batch.length) {
          // Keep the answer visible so nothing is lost; unparsed conversations stay unread
          rawOutput += (rawOutput ? '\n\n' : '') + output
          unparsed += batch.length - summarized.length
        }

        // These conversations have now been shown to the user
        for (const item of summarized) {
          item.done = true
          item.selected = false
          Z.advanceReadWatermark(item.convId, item.lastTime)
        }
        rememberSummaries(summarized)
        renderItems()
      }
      if (cancelled) setStatus('Đã dừng.')
      else if (unparsed) setStatus(`Không tách được phần tóm tắt của ${unparsed} hội thoại, nội dung Claude trả về hiện nguyên văn bên dưới. Các hội thoại này vẫn giữ là chưa đọc.`, true)
      else setStatus(`Bản tin lúc ${formatTime(Date.now(), true)}.`)
    } catch (error) {
      setStatus(cancelled ? 'Đã dừng.' : `Lỗi: ${error.message || error}`, !cancelled)
    } finally {
      activeCall = null
      stopButton.hidden = true
      renderItems()
    }
  }

  function buildOverlay () {
    const el = document.createElement('div')
    el.className = 'zenlo zenlo-digest'
    el.hidden = true
    el.innerHTML = `
      <div class="zenlo__header">
        <div>
          <div class="zenlo__title"><span class="zenlo__brand">Zenlo</span> · Bản tin</div>
          <div class="zenlo__conv">Tin mới từ lần đọc trước, tối đa 24 giờ</div>
        </div>
        <button class="zenlo__close js-digest-close" title="Đóng">&times;</button>
      </div>

      <div class="zenlo__actions">
        <button class="zenlo__btn zenlo__btn--primary js-digest-run">Tạo bản tin</button>
        <button class="zenlo__btn js-digest-stop" hidden>Dừng</button>
        <button class="zenlo__btn js-digest-refresh">Làm mới</button>
        <button class="zenlo__btn js-digest-read-all">Đánh dấu đã đọc hết</button>
      </div>

      <div class="zenlo__status zenlo-digest__summary-line"></div>
      <div class="zenlo__status zenlo-digest__status"></div>

      <div class="zenlo-digest__select" hidden>
        <button class="zenlo-digest__link js-digest-select-all">Chọn hết</button>
        <button class="zenlo-digest__link js-digest-select-none">Bỏ chọn hết</button>
        <button class="zenlo-digest__link js-digest-auto-order" title="Xoá thứ tự bạn đã kéo, quay về sắp xếp tự động">Sắp xếp tự động</button>
      </div>
      <div class="zenlo__result zenlo-digest__raw" hidden></div>
      <div class="zenlo-digest__list"></div>
    `

    el.querySelector('.js-digest-close').addEventListener('click', () => {
      el.hidden = true
    })
    el.querySelector('.js-digest-run').addEventListener('click', runDigest)
    el.querySelector('.js-digest-refresh').addEventListener('click', refresh)
    el.querySelector('.js-digest-read-all').addEventListener('click', () => {
      const now = Date.now()
      for (const item of items) Z.advanceReadWatermark(item.convId, now)
      items = []
      rawOutput = ''
      saveDigest([])
      renderItems()
      setStatus('Đã đánh dấu đã đọc hết.')
    })

    el.querySelector('.js-digest-select-all').addEventListener('click', () => setAllSelected(true))
    el.querySelector('.js-digest-select-none').addEventListener('click', () => setAllSelected(false))
    el.querySelector('.js-digest-auto-order').addEventListener('click', () => {
      if (!window.confirm('Xoá thứ tự ưu tiên bạn đã kéo và quay về sắp xếp tự động?')) return
      saveOrder([])
      items = sortItems(items)
      renderItems()
    })

    const list = el.querySelector('.zenlo-digest__list')
    bindDragAndDrop(list)

    list.addEventListener('change', (event) => {
      const check = event.target.closest('.js-digest-check')
      if (!check) return
      setSelected(items[Number(check.closest('.zenlo-digest__card').dataset.index)], check.checked)
      renderItems()
    })

    list.addEventListener('click', (event) => {
      const card = event.target.closest('.zenlo-digest__card')
      if (!card) return
      const index = Number(card.dataset.index)
      const item = items[index]

      const cite = event.target.closest('.zenlo-cite')
      if (cite) {
        el.hidden = true
        Z.jumpToMessage(item.convId, Number(cite.dataset.time)).catch((error) => {
          el.hidden = false
          setStatus(`Lỗi: ${error.message || error}`, true)
        })
      } else if (event.target.closest('.js-digest-skip')) {
        Z.advanceReadWatermark(item.convId, Date.now())
        removeItem(index)
      } else if (event.target.closest('.js-digest-open')) {
        Z.openConversation(item.convId)
        el.hidden = true
      } else if (event.target.closest('.js-digest-detail')) {
        Z.openConversation(item.convId)
        el.hidden = true
        // Wait for Zalo to show the conversation, then open the summary panel from the unread start
        Z.waitForConversation(item.convId).then(() => window.ZenloSummary && window.ZenloSummary.open({ from: item.start }))
      }
    })

    document.body.appendChild(el)
    return el
  }

  // Drag a card by its ⋮⋮ handle to reorder; the new order is saved as the user's priority
  function bindDragAndDrop (list) {
    let dragIndex = null

    const clearMarkers = () => {
      list.querySelectorAll('.zenlo-digest__card--drop-before, .zenlo-digest__card--drop-after')
        .forEach((card) => card.classList.remove('zenlo-digest__card--drop-before', 'zenlo-digest__card--drop-after'))
    }

    // Only the handle makes a card draggable, so buttons and text selection keep working
    list.addEventListener('mousedown', (event) => {
      const handle = event.target.closest('.zenlo-digest__handle')
      if (!handle || activeCall) return
      handle.closest('.zenlo-digest__card').draggable = true
    })

    list.addEventListener('dragstart', (event) => {
      const card = event.target.closest('.zenlo-digest__card')
      if (!card || !card.draggable) return
      dragIndex = Number(card.dataset.index)
      card.classList.add('zenlo-digest__card--dragging')
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(dragIndex))
    })

    list.addEventListener('dragover', (event) => {
      if (dragIndex === null) return
      const card = event.target.closest('.zenlo-digest__card')
      if (!card) return
      event.preventDefault()
      const rect = card.getBoundingClientRect()
      const before = event.clientY < rect.top + rect.height / 2
      clearMarkers()
      card.classList.add(before ? 'zenlo-digest__card--drop-before' : 'zenlo-digest__card--drop-after')
    })

    list.addEventListener('drop', (event) => {
      if (dragIndex === null) return
      const card = event.target.closest('.zenlo-digest__card')
      if (!card) return
      event.preventDefault()
      const rect = card.getBoundingClientRect()
      let target = Number(card.dataset.index) + (event.clientY < rect.top + rect.height / 2 ? 0 : 1)
      const [moved] = items.splice(dragIndex, 1)
      if (target > dragIndex) target--
      items.splice(target, 0, moved)
      rememberVisibleOrder()
      dragIndex = null
      renderItems()
    })

    list.addEventListener('dragend', () => {
      dragIndex = null
      clearMarkers()
      list.querySelectorAll('.zenlo-digest__card').forEach((card) => {
        card.draggable = false
        card.classList.remove('zenlo-digest__card--dragging')
      })
    })
  }

  function toggleOverlay () {
    if (!overlay) overlay = buildOverlay()
    overlay.hidden = !overlay.hidden
    if (!overlay.hidden && !activeCall) refresh()
  }

  // A tab in Zalo's left bar, styled like Zalo's own tabs, above "Zalo Cloud"
  function injectNavButton () {
    const bottom = document.querySelector('#main-tab .nav__tabs__bottom')
    if (!bottom || bottom.querySelector('.zenlo-nav-btn')) return

    const tab = document.createElement('div')
    tab.className = 'clickable leftbar-tab flx flx-col flx-al-c flx-center rel zenlo-nav-btn'
    tab.title = 'Zenlo · Bản tin'
    tab.innerHTML = `<div class="mmi-icon-wr">${ICON_SVG}</div><div class="lb-tab-title truncate">Bản tin</div>`
    tab.addEventListener('click', (event) => {
      event.stopPropagation()
      toggleOverlay()
    })
    bottom.prepend(tab)
  }

  Z.onDomChange(injectNavButton)
})()
