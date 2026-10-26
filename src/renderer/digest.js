/*
  Zenlo – trình quản lí hội thoại Zalo

  Digest ("Bản tin" tab of the Zenlo drawer, renderer): lists every conversation Zalo counts
  as unread and summarizes the ticked ones, each with the same prompt as the summary panel.
  Messages are read from the local store, so making a digest sends no "seen" receipt; only the
  "Đã đọc" buttons mark conversations read in Zalo.
*/

(function () {
  const Z = window.ZenloCore
  const { formatTime, escapeHTML, LENGTHS } = Z

  // Conversations summarized at the same time. Claude Code handles a few parallel runs well;
  // Gemini's free tier allows few requests per minute.
  const PARALLEL = { claude: 3, codex: 2, gemini: 2 }

  // Kinds of messages that automated accounts send (account notices, cards, bank cards)
  const AUTOMATED_KINDS = ['chat.list.action', 'chat.webcontent', 'chat.ecard']

  let overlay = null
  // status: "pending" (can be ticked), "running", "done" (summarized), "error"
  let items = []
  let running = null

  // ---------- Saved results ----------

  // The latest summaries, kept so they survive closing the panel, "Làm mới" and Zalo restarts.
  // A saved summary is shown again while the conversation is still unread with no newer message.
  const DIGEST_KEY = '@Zenlo:DIGEST_LAST'

  function loadSavedDigest () {
    try {
      const saved = JSON.parse(localStorage.getItem(DIGEST_KEY) || '[]')
      return Array.isArray(saved) ? saved.filter((entry) => Date.now() - entry.at < Z.getLookback()) : []
    } catch (error) {
      return []
    }
  }

  function saveDigest (entries) {
    try {
      localStorage.setItem(DIGEST_KEY, JSON.stringify(entries))
    } catch (error) {}
  }

  function rememberSummary (item) {
    const kept = loadSavedDigest().filter((entry) => entry.convId !== item.convId)
    kept.push({ convId: item.convId, lastTime: item.lastTime, start: item.start, summary: item.summary, at: Date.now() })
    saveDigest(kept)
  }

  function forgetSummaries (convIds) {
    const ids = new Set(convIds)
    saveDigest(loadSavedDigest().filter((entry) => !ids.has(entry.convId)))
  }

  // ---------- Data ----------

  let scanId = 0

  // Every conversation Zalo counts as unread, with its unread messages (no further back than the
  // lookback setting). Returns null when a newer scan started.
  async function collectUnread (onProgress) {
    const myScan = ++scanId
    const now = Date.now()
    const unread = [...Z.readZaloUnread().entries()]
    const saved = new Map(loadSavedDigest().map((entry) => [entry.convId, entry]))
    const found = []
    let tooOld = 0

    for (let i = 0; i < unread.length; i++) {
      if (myScan !== scanId) return null
      const [convId, state] = unread[i]
      onProgress(i + 1, unread.length)

      const start = await Z.getUnreadStart(convId, state, now)
      const { messages } = await Z.loadMessagesInRange(convId, start, now)
      const { lines, count } = await Z.prepareTranscript(messages)
      if (!count) {
        tooOld++
        continue
      }

      const fromOthers = messages.filter((m) => m.fromUid !== '0' && Z.describeContent(m))
      const lastTime = Number(messages[messages.length - 1].sendDttm)
      const item = {
        convId,
        name: Z.getConvName(convId),
        isGroup: convId.startsWith('g'),
        mentions: state.mentions,
        start,
        count: state.count || fromOthers.length,
        lastTime,
        lines,
        summary: '',
        status: 'pending',
        error: '',
        selected: isSelectedByDefault(convId, fromOthers)
      }

      // Already summarized and nothing newer since
      const previous = saved.get(convId)
      if (previous && previous.lastTime >= lastTime && previous.summary) {
        item.summary = previous.summary
        item.status = 'done'
        item.selected = false
      }
      found.push(item)
    }
    return { items: sortItems(found), tooOld }
  }

  // ---------- Ticks ----------

  // Conversations the user unticked; they start unticked next time too.
  // Keep this storage key stable forever, like ORDER_KEY.
  const UNTICKED_KEY = '@Zenlo:DIGEST_UNTICKED'
  // Conversations the user ticked by hand, which overrides the automatic untick of automated notices
  const TICKED_KEY = '@Zenlo:DIGEST_TICKED'

  const readSet = (key) => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) || '[]'))
    } catch (error) {
      return new Set()
    }
  }
  const writeSet = (key, set) => {
    try {
      localStorage.setItem(key, JSON.stringify([...set]))
    } catch (error) {}
  }

  // Read each time (not once at load), so a restore from Zenlo's backup is picked up

  // Unticked by default: what the user unticked, and conversations whose unread messages are all
  // automated notices (account notices, cards), unless the user ticked them by hand
  function isSelectedByDefault (convId, fromOthers) {
    if (readSet(UNTICKED_KEY).has(convId)) return false
    if (readSet(TICKED_KEY).has(convId)) return true
    return !(fromOthers.length && fromOthers.every((m) => AUTOMATED_KINDS.includes(m.originMsgType)))
  }

  function rememberTick (convId, selected) {
    const unticked = readSet(UNTICKED_KEY)
    const ticked = readSet(TICKED_KEY)
    if (selected) {
      unticked.delete(convId)
      ticked.add(convId)
    } else {
      unticked.add(convId)
      ticked.delete(convId)
    }
    writeSet(UNTICKED_KEY, unticked)
    writeSet(TICKED_KEY, ticked)
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

  function cardSummary (item) {
    if (item.status === 'error') return `<div class="zenlo__status zenlo__status--error">Lỗi: ${escapeHTML(item.error)}</div>`
    if (item.status === 'running' && !item.summary) return `<div class="zenlo__status">Đang tóm tắt${item.model ? ` bằng ${escapeHTML(item.model)}` : ''}…</div>`
    if (item.status === 'running') return `<pre>${escapeHTML(item.summary)}</pre>`
    if (!item.summary) return ''
    const model = item.model ? `<div class="zenlo__status zenlo-digest__model">bằng ${escapeHTML(item.model)}</div>` : ''
    return Z.renderMarkdown(item.summary, { range: { from: item.start, to: item.lastTime } }) + model
  }

  function renderItems () {
    const list = overlay.querySelector('.zenlo-digest__list')
    const locked = !!running
    list.classList.toggle('zenlo-digest__list--locked', locked)
    list.innerHTML = items.map((item, i) => `
      <div class="zenlo-digest__card${item.status !== 'pending' || item.selected ? '' : ' zenlo-digest__card--off'}" data-index="${i}">
        <div class="zenlo-digest__card-head">
          <span class="zenlo-digest__handle" title="Giữ và kéo để sắp xếp ưu tiên">⋮⋮</span>
          ${item.status === 'done'
            ? '<span class="zenlo-digest__done" title="Đã tóm tắt">✓</span>'
            : `<input type="checkbox" class="zenlo-digest__check js-digest-check" title="Tóm tắt hội thoại này" ${item.selected ? 'checked' : ''} ${locked ? 'disabled' : ''}>`}
          <div class="zenlo-digest__name">${escapeHTML(item.name)}</div>
          <div class="zenlo-digest__meta">
            ${item.mentions ? '<span class="zenlo-digest__badge">@ nhắc bạn</span>' : ''}
            ${item.count} tin chưa đọc · ${formatTime(item.lastTime)}
          </div>
        </div>
        <div class="zenlo-digest__summary">${cardSummary(item)}</div>
        <div class="zenlo-digest__card-actions">
          <button class="zenlo__btn js-digest-open">Mở</button>
          <button class="zenlo__btn js-digest-detail">Tóm tắt chi tiết</button>
          <button class="zenlo__btn js-digest-read" title="Đánh dấu đã đọc trong Zalo">Đã đọc</button>
        </div>
      </div>
    `).join('')

    const pending = items.filter((item) => item.status !== 'done')
    const selected = pending.filter((item) => item.selected)
    const total = selected.reduce((sum, item) => sum + item.count, 0)
    const chars = selected.reduce((sum, item) => sum + item.lines.join('\n').length + Z.SUMMARY_PROMPT.length, 0)
    overlay.querySelector('.zenlo-digest__summary-line').textContent = pending.length
      ? `Đã chọn ${selected.length}/${pending.length} hội thoại · ${total} tin chưa đọc · ước tính ~${Z.estimateTokens(chars).toLocaleString('vi-VN')} token · ${Z.getAILabel()}`
      : ''
    overlay.querySelector('.js-digest-run').disabled = !selected.length || locked
    overlay.querySelector('.js-digest-read-all').disabled = !items.length || locked
    overlay.querySelector('.zenlo-digest__select').hidden = !items.length
    overlay.querySelectorAll('.zenlo-digest__select button').forEach((button) => {
      button.disabled = locked
    })
    renderLength()
  }

  // Streaming text arrives many times a second from several conversations: render once per frame
  let renderScheduled = false
  function scheduleRender () {
    if (renderScheduled) return
    renderScheduled = true
    requestAnimationFrame(() => {
      renderScheduled = false
      renderItems()
    })
  }

  function renderLength () {
    const current = Z.getLength('digest')
    overlay.querySelectorAll('[data-length]').forEach((button) => {
      button.classList.toggle('zenlo__segment-btn--active', button.dataset.length === current)
      button.disabled = !!running
    })
  }

  function setSelected (item, selected) {
    item.selected = selected
    rememberTick(item.convId, selected)
  }

  function setAllSelected (selected) {
    for (const item of items) {
      if (item.status !== 'done') setSelected(item, selected)
    }
    renderItems()
  }

  // Marks conversations read in Zalo and removes them from the digest
  function markRead (convIds) {
    try {
      Z.markReadInZalo(convIds)
    } catch (error) {
      setStatus(`Lỗi: ${error.message || error}`, true)
      return false
    }
    const ids = new Set(convIds)
    forgetSummaries(convIds)
    items = items.filter((item) => !ids.has(item.convId))
    renderItems()
    return true
  }

  async function refresh () {
    if (running) return
    items = []
    renderItems()
    setStatus('Đang tìm hội thoại chưa đọc…')
    try {
      const result = await collectUnread((done, total) => setStatus(`Đang đọc tin chưa đọc… ${done}/${total} hội thoại`))
      if (!result) return
      items = result.items
      const old = result.tooOld ? `${result.tooOld} hội thoại có tin chưa đọc cũ hơn ${Z.getLookback() / Z.DAY} ngày nên không đưa vào (đổi trong Cài đặt Zenlo).` : ''
      setStatus(items.length ? old : old || 'Không có hội thoại nào chưa đọc.')
    } catch (error) {
      setStatus(`Lỗi: ${error.message || error}`, true)
    }
    renderItems()
  }

  // Summarizes one conversation with the summary panel's prompt
  async function summarizeItem (item, length, calls) {
    item.status = 'running'
    item.summary = ''
    item.error = ''
    item.model = ''
    scheduleRender()

    try {
      const chunks = Z.splitIntoChunks(item.lines)
      let input = `<transcript>\n${item.lines.join('\n')}\n</transcript>`
      if (chunks.length > 1) {
        const notes = []
        for (let i = 0; i < chunks.length; i++) {
          const call = Z.runAI({
            systemPrompt: Z.SUMMARY_PROMPT,
            instruction: Z.buildPartInstruction({ convName: item.name, part: i + 1, parts: chunks.length, note: Z.getNote(item.convId) }),
            input: `<transcript>\n${chunks[i].join('\n')}\n</transcript>`
          })
          calls.add(call)
          notes.push(`### Phần ${i + 1}\n` + await call.promise)
          calls.delete(call)
        }
        input = `<notes>\n${notes.join('\n\n')}\n</notes>`
      }

      const call = Z.runAI({
        systemPrompt: Z.SUMMARY_PROMPT,
        instruction: Z.buildSummaryInstruction({
          note: Z.getNote(item.convId),
          convName: item.name,
          isGroup: item.isGroup,
          from: item.start,
          to: item.lastTime,
          count: item.count,
          length,
          kind: 'unread',
          notes: chunks.length > 1
        }),
        input
      }, (text) => {
        item.summary += text
        scheduleRender()
      }, (modelStatus) => {
        item.model = Z.describeModelStatus(modelStatus)
        scheduleRender()
      })
      calls.add(call)
      item.summary = await call.promise
      calls.delete(call)
      item.status = 'done'
      item.selected = false
      rememberSummary(item)
    } catch (error) {
      item.status = 'error'
      item.error = error.message || String(error)
    }
    scheduleRender()
  }

  async function runDigest () {
    const chosen = items.filter((item) => item.status !== 'done' && item.selected)
    if (running || !chosen.length) return

    const length = Z.getLength('digest')
    const { provider } = Z.getAISettings()
    const calls = new Set()
    let cancelled = false
    running = {
      cancel: () => {
        cancelled = true
        calls.forEach((call) => call.cancel())
      }
    }
    const stopButton = overlay.querySelector('.js-digest-stop')
    stopButton.hidden = false
    showTreat(false)
    overlay.querySelector('.js-digest-copy').hidden = true
    setStatus(`Đang tạo bản tin bằng ${Z.getAILabel()}…`)
    renderItems()

    // A few conversations at a time, in priority order
    const queue = chosen.slice()
    const worker = async () => {
      while (queue.length) {
        if (cancelled) return
        await summarizeItem(queue.shift(), length, calls)
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL[provider] || 2, queue.length) }, worker))

    for (const item of chosen) {
      if (item.status === 'running' || (cancelled && item.status === 'error')) {
        item.status = 'pending'
        item.summary = ''
      }
    }
    const failed = chosen.filter((item) => item.status === 'error').length
    running = null
    stopButton.hidden = true
    if (cancelled) setStatus('Đã dừng.')
    else if (failed) setStatus(`${failed} hội thoại bị lỗi, xem trên từng thẻ. Bấm "Tạo bản tin" để thử lại.`, true)
    else setStatus(`Bản tin lúc ${formatTime(Date.now(), true)}.`)
    renderItems()
    const done = items.some((item) => item.status === 'done' && item.summary)
    overlay.querySelector('.js-digest-copy').hidden = !done
    if (!cancelled && done) showTreat(true)
  }

  // The thank-you line under a finished digest; × hides it until the next one
  function showTreat (shown) {
    overlay.querySelector('.zenlo__treat').hidden = !shown
  }

  // Every summarized conversation as plain text, with where it came from
  function copyDigest () {
    const text = items
      .filter((item) => item.status === 'done' && item.summary)
      .map((item) => `## ${item.name}\n${String(item.summary).trim()}`)
      .join('\n\n')
    if (!text) return
    navigator.clipboard.writeText(Z.withCredit(text)).then(() => setStatus('Đã sao chép bản tin.'))
  }

  function buildOverlay () {
    const el = document.createElement('div')
    el.className = 'zenlo zenlo-digest'
    el.innerHTML = `
      <div class="zenlo__hint">Các hội thoại Zalo đang tính là chưa đọc</div>

      <div class="zenlo__actions">
        <button class="zenlo__btn zenlo__btn--primary js-digest-run">Tạo bản tin</button>
        <button class="zenlo__btn js-digest-stop" hidden>Dừng</button>
        <button class="zenlo__btn js-digest-copy" hidden>Sao chép</button>
        <button class="zenlo__btn js-digest-refresh">Làm mới</button>
        <button class="zenlo__btn js-digest-read-all" title="Đánh dấu đã đọc trong Zalo mọi hội thoại trong danh sách">Đã đọc hết</button>
      </div>

      <div class="zenlo__length">
        <span>Độ dài</span>
        <span class="zenlo__segment">
          ${LENGTHS.map((l) => `<button type="button" class="zenlo__segment-btn" data-length="${l.value}">${l.label}</button>`).join('')}
        </span>
      </div>

      <div class="zenlo__status zenlo-digest__summary-line"></div>
      <div class="zenlo__status zenlo-digest__status"></div>

      <div class="zenlo-digest__select" hidden>
        <button class="zenlo-digest__link js-digest-select-all">Chọn hết</button>
        <button class="zenlo-digest__link js-digest-select-none">Bỏ chọn hết</button>
        <button class="zenlo-digest__link js-digest-auto-order" title="Xoá thứ tự bạn đã kéo, quay về sắp xếp tự động">Sắp xếp tự động</button>
      </div>
      <div class="zenlo-digest__list"></div>
      <div class="zenlo__treat" hidden>
        <span>${Z.TREAT_HTML}</span>
        <button type="button" class="zenlo__treat-close js-treat-close" title="Ẩn">&times;</button>
      </div>
    `

    el.querySelector('.js-digest-run').addEventListener('click', runDigest)
    el.querySelector('.js-digest-copy').addEventListener('click', copyDigest)
    el.querySelector('.js-treat-link').addEventListener('click', () => Z.openLink(Z.LINKS.treat))
    el.querySelector('.js-treat-close').addEventListener('click', () => showTreat(false))
    el.querySelector('.js-digest-stop').addEventListener('click', () => {
      if (running) running.cancel()
    })
    el.querySelector('.js-digest-refresh').addEventListener('click', refresh)
    el.querySelector('.js-digest-read-all').addEventListener('click', () => {
      if (!items.length) return
      if (markRead(items.map((item) => item.convId))) setStatus('Đã đánh dấu đã đọc trong Zalo.')
    })
    el.querySelectorAll('[data-length]').forEach((button) => {
      button.addEventListener('click', () => {
        Z.setLength('digest', button.dataset.length)
        renderLength()
      })
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
      const item = items[Number(card.dataset.index)]

      const cite = event.target.closest('.zenlo-cite')
      if (cite) {
        Z.jumpToMessage(item.convId, cite.dataset.times.split(',').map(Number)).catch((error) => {
          setStatus(`Lỗi: ${error.message || error}`, true)
        })
      } else if (event.target.closest('.js-digest-read')) {
        markRead([item.convId])
      } else if (event.target.closest('.js-digest-open')) {
        Z.openConversation(item.convId)
      } else if (event.target.closest('.js-digest-detail')) {
        Z.openConversation(item.convId)
        // Wait for Zalo to show the conversation, then open the summary panel from the unread start
        Z.waitForConversation(item.convId).then(() => window.ZenloSummary && window.ZenloSummary.open({ from: item.start }))
      }
    })

    Z.drawer.pane('digest').appendChild(el)
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
      if (!handle || running) return
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

  // Each time the drawer shows this tab: build it once, then scan for unread conversations
  Z.drawer.onShow('digest', () => {
    if (!overlay) overlay = buildOverlay()
    if (!running) refresh()
  })
})()
