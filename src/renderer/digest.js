/*
  Zenlo – trình quản lí hội thoại Zalo

  Digest ("Bản tin" tab of the Zenlo drawer, renderer): lists every conversation Zalo counts
  as unread and summarizes the ticked ones: short, only what concerns the user, several
  conversations per AI request (ZenloCore.DIGEST_PROMPT).
  Messages are read from the local store, so making a digest sends no "seen" receipt; only the
  "Đã đọc" buttons mark conversations read in Zalo.
*/

(function () {
  const Z = window.ZenloCore
  const { formatTime, escapeHTML, WAIT_HINT } = Z

  // Conversations summarized at the same time (ZenloCore.PARALLEL)
  const { PARALLEL } = Z

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
    let failed = 0

    for (let i = 0; i < unread.length; i++) {
      if (myScan !== scanId) return null
      const [convId, state] = unread[i]
      onProgress(i + 1, unread.length)

      // One conversation Zalo cannot read is left out, not the whole list
      let start, messages, lines, count, minutes, numbered
      try {
        start = await Z.getUnreadStart(convId, state, now)
        ;({ messages } = await Z.loadMessagesInRange(convId, start, now))
        ;({ lines, count, minutes, numbered } = await Z.prepareTranscript(messages))
      } catch (error) {
        Z.log('digest: cannot read', convId, error)
        failed++
        continue
      }
      if (!count) {
        tooOld++
        continue
      }

      const fromOthers = messages.filter((m) => m.fromUid !== '0' && Z.describeContent(m))
      const lastTime = Number(messages[messages.length - 1].sendDttm)
      const mentioned = state.mentions > 0 || Z.mentionsMe(messages)
      const item = {
        convId,
        name: Z.getConvName(convId),
        isGroup: convId.startsWith('g'),
        mentions: mentioned ? Math.max(state.mentions, 1) : 0,
        start,
        count: state.count || fromOthers.length,
        lastTime,
        lines,
        minutes,
        numbered,
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
    if (myScan !== scanId) return null
    return { items: sortItems(found), tooOld, failed }
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

  // "Chọn hết" / "Bỏ chọn hết" hold until Zalo restarts, not for good: a conversation unticked in
  // bulk must not stay unticked once it has something important, nor an automated one ticked
  const bulkTicks = new Map()

  // Unticked by default: what the user unticked, and conversations whose unread messages are all
  // automated notices (account notices, cards), unless the user ticked them by hand
  function isSelectedByDefault (convId, fromOthers) {
    if (bulkTicks.has(convId)) return bulkTicks.get(convId)
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

  // Saves the order after a card was dropped at index `at` (ZenloCore.mergeDigestOrder)
  function rememberVisibleOrder (at) {
    saveOrder(Z.mergeDigestOrder(loadOrder(), items.map((item) => item.convId), at))
  }

  // ---------- UI ----------

  function setStatus (text, isError = false) {
    const el = overlay.querySelector('.zenlo-digest__status')
    el.textContent = text
    el.classList.toggle('zenlo__status--error', isError)
  }

  // Gemini requests that have written nothing yet: { start, model, thinking, call }. While one waits, its
  // cards count the seconds, and after WAIT_HINT "Chuyển model khác" moves it to the next model.
  const waits = new Set()

  function waitText (item) {
    const wait = item.wait
    if (!wait || !wait.start) return `Đang tóm tắt${item.model ? ` bằng ${item.model}` : ''}…`
    const seconds = Math.round((Date.now() - wait.start) / 1000)
    if (wait.thinking) return `${wait.model} đang suy nghĩ… ${seconds} giây`
    return `Đang chờ ${wait.model} trả lời… ${seconds} giây${seconds * 1000 >= WAIT_HINT ? ' (Gemini đang đông)' : ''}`
  }

  // A thinking model is working: moving on would only throw that away
  const longWaits = () => [...waits].filter((wait) => !wait.thinking && Date.now() - wait.start >= WAIT_HINT)

  function cardSummary (item) {
    if (item.status === 'error') return `<div class="zenlo__status zenlo__status--error">Lỗi: ${escapeHTML(item.error)}</div>`
    if (item.status === 'running' && !item.summary) return `<div class="zenlo__status zenlo-loader-row">${Z.letterLoader('zenlo-loader--small')}${escapeHTML(waitText(item))}</div>`
    if (item.status === 'running') return `<pre>${escapeHTML(Z.stripCitations(item.summary))}</pre>`
    if (!item.summary) return ''
    const model = item.model ? `<div class="zenlo__status zenlo-digest__model">bằng ${escapeHTML(item.model)}</div>` : ''
    return Z.renderMarkdown(item.summary, { range: { from: item.start, to: item.lastTime }, convId: item.convId }) + model
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
    const batches = packBatches(selected)
    const chars = selected.reduce((sum, item) => sum + itemChars(item), 0) + batches.length * Z.DIGEST_PROMPT.length
    // A conversation too long for one request costs one request per part, plus the digest itself
    const requests = batches.reduce((sum, batch) => {
      const parts = batch.length === 1 ? Z.splitIntoChunks(batch[0].lines).length : 1
      return sum + (parts > 1 ? parts + 1 : 1)
    }, 0)
    overlay.querySelector('.zenlo-digest__summary-line').textContent = pending.length
      ? `Đã chọn ${selected.length}/${pending.length} hội thoại · ${total} tin chưa đọc · ước tính ~${Z.estimateTokens(chars).toLocaleString('vi-VN')} token đầu vào` +
        (requests ? `, ${requests} lần request` : '') + ` · ${Z.getAILabel()}`
      : ''
    overlay.querySelector('.js-digest-run').disabled = !selected.length || locked
    overlay.querySelector('.js-digest-read-all').disabled = !items.length || locked
    overlay.querySelector('.zenlo-digest__select').hidden = !items.length
    overlay.querySelectorAll('.zenlo-digest__select button').forEach((button) => {
      button.disabled = locked
    })
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

  function setSelected (item, selected) {
    item.selected = selected
    bulkTicks.delete(item.convId)
    rememberTick(item.convId, selected)
  }

  function setAllSelected (selected) {
    for (const item of items) {
      if (item.status === 'done') continue
      item.selected = selected
      bulkTicks.set(item.convId, selected)
    }
    renderItems()
  }

  // A message from someone else newer than the card shows: Zalo would mark it read too, unseen
  async function hasNewerMessages (item) {
    try {
      const latest = await Z.getLatestMessages(item.convId, 20)
      return latest.some((m) => Number(m.sendDttm) > item.lastTime && String(m.fromUid) !== '0' && m.msgType !== -4 && Z.describeContent(m))
    } catch (error) {
      return false
    }
  }

  // Marks conversations read in Zalo and removes them from the digest, except those with a newer
  // message (unless force). Returns { marked, newer } (newer: the items left), or null on an error.
  async function markRead (chosen, { force = false } = {}) {
    const newer = force ? [] : (await Promise.all(chosen.map(async (item) => ((await hasNewerMessages(item)) ? item : null)))).filter(Boolean)
    const marking = chosen.filter((item) => !newer.includes(item))
    if (marking.length) {
      const ids = new Set(marking.map((item) => item.convId))
      try {
        Z.markReadInZalo([...ids])
      } catch (error) {
        setStatus(`Lỗi: ${error.message || error}`, true)
        return null
      }
      forgetSummaries([...ids])
      for (const id of ids) readDuringScan.add(id)
      items = items.filter((item) => !ids.has(item.convId))
      renderItems()
    }
    return { marked: marking.length, newer }
  }

  // Which conversations were unread at the last scan (see the automatic refresh at the end); null: unknown
  let lastShape = null
  // Marked read while a scan was reading: that scan saw them unread, so they are left out of its result
  const readDuringScan = new Set()

  // The list on screen stays until the new one is ready, so a refresh (also the automatic one when
  // a conversation becomes unread) does not empty it while reading
  async function refresh () {
    if (running) return
    lastShape = unreadShape()
    readDuringScan.clear()
    setStatus('Đang tìm hội thoại chưa đọc…')
    try {
      // The list stays usable while this reads: a digest started meanwhile owns the status line
      const result = await collectUnread((done, total) => {
        if (!running) setStatus(`Đang đọc tin chưa đọc… ${done}/${total} hội thoại`)
      })
      // A newer scan started, or a digest started while this one was reading
      if (!result || running) return
      items = result.items.filter((item) => !readDuringScan.has(item.convId))
      const old = result.tooOld ? `${result.tooOld} hội thoại có tin chưa đọc cũ hơn ${Z.getLookback() / Z.DAY} ngày nên không đưa vào (đổi trong Cài đặt Zenlo).` : ''
      const unreadable = result.failed ? `${result.failed} hội thoại không đọc được nên không đưa vào.` : ''
      const note = [old, unreadable].filter(Boolean).join(' ')
      setStatus(items.length ? note : note || 'Không có hội thoại nào chưa đọc.')
    } catch (error) {
      setStatus(`Lỗi: ${error.message || error}`, true)
    }
    renderItems()
  }

  // Conversations per request: as many as fit, in priority order. One request instead of one per
  // conversation saves the user's quota (a free Gemini key allows few requests a day). The size
  // stays well under what a weak model reads reliably; a conversation too long for one request
  // (over CHUNK_CHARS) goes alone, as part notes.
  const BATCH_CHARS = 60000
  const BATCH_MAX = 12

  const itemChars = (item) => item.lines.reduce((sum, line) => sum + line.length + 1, 0)

  function packBatches (list) {
    const batches = []
    let current = []
    let size = 0
    for (const item of list) {
      const chars = itemChars(item)
      if (Z.splitIntoChunks(item.lines).length > 1) {
        batches.push([item])
        continue
      }
      if (current.length && (size + chars > BATCH_CHARS || current.length >= BATCH_MAX)) {
        batches.push(current)
        current = []
        size = 0
      }
      current.push(item)
      size += chars
    }
    if (current.length) batches.push(current)
    return batches
  }

  // Notes for each part of a conversation too long for one request (the summary panel's prompt)
  async function partNotes (item, chunks, calls) {
    const notes = []
    for (let i = 0; i < chunks.length; i++) {
      const call = Z.runAI({
        systemPrompt: Z.SUMMARY_PROMPT,
        instruction: Z.buildPartInstruction({ convName: item.name, part: i + 1, parts: chunks.length }),
        note: Z.getNote(item.convId),
        input: `<transcript>\n${chunks[i].join('\n')}\n</transcript>`
      })
      calls.add(call)
      // Written from untrusted messages: must not close the <notes> tag of the digest request
      notes.push(`### Phần ${i + 1}\n` + Z.neutralizeTags(await call.promise))
      calls.delete(call)
    }
    return notes.join('\n\n')
  }

  // Summarizes the conversations of one batch in a single request. The answer has one "### n"
  // section per conversation; each card shows its own section as the answer streams in.
  async function summarizeBatch (batch, calls) {
    for (const item of batch) {
      item.status = 'running'
      item.summary = ''
      item.error = ''
      item.model = ''
    }
    const wait = { start: 0, model: '', thinking: false, call: null }
    for (const item of batch) item.wait = wait
    scheduleRender()

    const show = (text) => {
      const sections = Z.splitDigest(text)
      batch.forEach((item, i) => {
        if (sections[i + 1] !== undefined) item.summary = Z.cleanAnswer(sections[i + 1], null, item.lines.join('\n'), item.numbered)
      })
      scheduleRender()
    }

    try {
      const entries = []
      for (const item of batch) {
        const chunks = Z.splitIntoChunks(item.lines)
        const entry = { name: item.name, isGroup: item.isGroup, from: item.start, to: item.lastTime, count: item.count }
        if (chunks.length > 1) entry.notes = await partNotes(item, chunks, calls)
        else entry.lines = item.lines
        entries.push(entry)
      }

      let streamed = ''
      const call = Z.runAI({
        systemPrompt: Z.DIGEST_PROMPT,
        instruction: Z.buildDigestInstruction({ count: batch.length, notes: batch.map((item) => Z.getNote(item.convId)) }),
        input: Z.buildDigestInput(entries)
      }, (text) => {
        waits.delete(wait)
        wait.start = 0
        streamed += text
        show(streamed)
      }, (modelStatus) => {
        const model = Z.describeModelStatus(modelStatus)
        for (const item of batch) item.model = model
        if (modelStatus.thinking) {
          wait.thinking = true
        } else if (!modelStatus.done) {
          // Another model (or key) starts over: drop what a failed one had written
          streamed = ''
          for (const item of batch) item.summary = ''
          wait.start = Date.now()
          wait.model = modelStatus.model
          wait.thinking = false
          waits.add(wait)
        }
        scheduleRender()
      })
      wait.call = call
      calls.add(call)
      const answer = await call.promise
      calls.delete(call)

      const sections = Z.splitDigest(answer)
      // A lone conversation answered without its "### 1" line: the whole answer is its summary
      if (batch.length === 1 && !Object.keys(sections).length && answer.trim()) sections[1] = answer
      batch.forEach((item, i) => {
        const text = sections[i + 1] && Z.cleanAnswer(sections[i + 1], item.minutes, item.lines.join('\n'), item.numbered)
        if (text) {
          item.summary = text
          item.status = 'done'
          item.selected = false
          rememberSummary(item)
        } else {
          item.status = 'error'
          item.summary = ''
          item.error = 'AI bỏ sót hội thoại này. Bấm "Tạo bản tin" để thử lại.'
        }
      })
    } catch (error) {
      for (const item of batch) {
        item.status = 'error'
        item.error = error.message || String(error)
      }
    }
    waits.delete(wait)
    scheduleRender()
  }

  async function runDigest () {
    const chosen = items.filter((item) => item.status !== 'done' && item.selected)
    if (running || !chosen.length) return

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
    const skipButton = overlay.querySelector('.js-digest-skip')
    // The waiting cards count the seconds; the skip button shows once a request waits long
    const ticker = setInterval(() => {
      skipButton.hidden = !longWaits().length
      if (waits.size) scheduleRender()
    }, 1000)
    overlay.querySelector('.js-digest-copy').hidden = true
    setStatus(`Đang tạo bản tin bằng ${Z.getAILabel()}…`)
    renderItems()

    // Batches of conversations, in priority order, a few requests at a time
    const queue = packBatches(chosen)
    const worker = async () => {
      while (queue.length) {
        if (cancelled) return
        await summarizeBatch(queue.shift(), calls)
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
    clearInterval(ticker)
    waits.clear()
    running = null
    stopButton.hidden = true
    skipButton.hidden = true
    if (cancelled) setStatus('Đã dừng.')
    else if (failed) setStatus(`${failed} hội thoại bị lỗi, xem trên từng thẻ. Bấm "Tạo bản tin" để thử lại.`, true)
    else setStatus(`Bản tin lúc ${formatTime(Date.now(), true)}.`)
    renderItems()
    const done = items.some((item) => item.status === 'done' && item.summary)
    overlay.querySelector('.js-digest-copy').hidden = !done
  }

  // Every summarized conversation as plain text, with where it came from; withSources: each
  // conversation with "[1]" marks and its own list of sources
  async function copyDigest (withSources = false) {
    const done = items.filter((item) => item.status === 'done' && item.summary)
    if (!done.length) return
    if (withSources) setStatus('Đang lấy tin gốc cho phần nguồn…')
    try {
      const parts = await Promise.all(done.map(async (item) => {
        const summary = withSources
          ? await Z.withSources(item.summary, item.convId, { from: item.start, to: item.lastTime })
          : String(item.summary).trim()
        return `## ${item.name}\n${summary}`
      }))
      await navigator.clipboard.writeText(Z.withCredit(parts.join('\n\n')))
      setStatus(withSources ? 'Đã sao chép bản tin kèm nguồn.' : 'Đã sao chép bản tin.')
    } catch (error) {
      setStatus('Không sao chép được, thử lại.', true)
    }
  }

  function buildOverlay () {
    const el = document.createElement('div')
    el.className = 'zenlo zenlo-digest'
    el.innerHTML = `
      <div class="zenlo__hint">Các hội thoại Zalo đang tính là chưa đọc</div>

      <div class="zenlo__actions">
        <button class="zenlo__btn zenlo__btn--primary js-digest-run">Tạo bản tin</button>
        <button class="zenlo__btn js-digest-stop" hidden>Dừng</button>
        <button class="zenlo__btn js-digest-skip" hidden title="Bỏ model đang chờ, hỏi bản Gemini thấp hơn">Chuyển model khác</button>
        ${Z.copyButtonHTML('js-digest-copy')}
        <button class="zenlo__btn js-digest-refresh">Làm mới</button>
        <button class="zenlo__btn js-digest-read-all" title="Đánh dấu đã đọc trong Zalo mọi hội thoại trong danh sách">Đã đọc hết</button>
      </div>

      <div class="zenlo__status zenlo-digest__summary-line"></div>
      <div class="zenlo__status zenlo-digest__status"></div>

      <div class="zenlo-digest__select" hidden>
        <button class="zenlo-digest__link js-digest-select-all">Chọn hết</button>
        <button class="zenlo-digest__link js-digest-select-none">Bỏ chọn hết</button>
        <button class="zenlo-digest__link js-digest-auto-order" title="Xoá thứ tự bạn đã kéo, quay về sắp xếp tự động">Sắp xếp tự động</button>
      </div>
      <div class="zenlo-digest__list"></div>
    `

    el.querySelector('.js-digest-run').addEventListener('click', runDigest)
    Z.bindCopyButton(el.querySelector('.js-digest-copy'), { plain: () => copyDigest(false), sources: () => copyDigest(true) })
    el.querySelector('.js-digest-stop').addEventListener('click', () => {
      if (running) running.cancel()
    })
    el.querySelector('.js-digest-skip').addEventListener('click', (event) => {
      event.currentTarget.hidden = true
      for (const wait of longWaits()) if (wait.call) wait.call.skip()
    })
    el.querySelector('.js-digest-refresh').addEventListener('click', refresh)
    el.querySelector('.js-digest-read-all').addEventListener('click', async () => {
      if (!items.length) return
      const result = await markRead(items)
      if (!result) return
      if (!result.newer.length) return setStatus('Đã đánh dấu đã đọc trong Zalo.')
      setStatus(`${result.marked ? `Đã đánh dấu đã đọc ${result.marked} hội thoại. ` : ''}${result.newer.length} hội thoại có tin mới sau khi danh sách được tải nên chưa đánh dấu; bấm Làm mới để xem.`)
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
        Z.jumpToMessage(item.convId, cite.dataset.times.split(',').map(Number), cite.dataset.msg).catch((error) => {
          setStatus(`Lỗi: ${error.message || error}`, true)
        })
      } else if (event.target.closest('.js-digest-read')) {
        // A second press marks it read anyway
        markRead([item], { force: !!item.readAnyway }).then((result) => {
          if (!result || !result.newer.length) return
          item.readAnyway = true
          setStatus(`"${item.name}" có tin mới sau khi danh sách được tải nên chưa đánh dấu. Bấm Làm mới để xem, hoặc bấm Đã đọc lần nữa để vẫn đánh dấu.`)
        })
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
      rememberVisibleOrder(target)
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

  // While the digest is open, a newly unread conversation or a new mention scans the list again
  // (not every new message: a busy group would make the list flicker), at most every 20 seconds
  const unreadShape = () => {
    try {
      return [...Z.readZaloUnread()].map(([convId, state]) => `${convId}:${state.mentions > 0 ? 1 : 0}`).sort().join(',')
    } catch (error) {
      // Unknown, not "nothing unread": a failed read must not look like a change
      return null
    }
  }
  let lastAutoRefresh = 0
  setInterval(() => {
    if (!overlay || !Z.drawer.isOpen('digest')) {
      lastShape = null
      return
    }
    // While a digest runs the list stays as it is; what became unread meanwhile is picked up after
    if (running) return
    const shape = unreadShape()
    if (shape === null) return
    // null: no shape yet ('' is a real one: nothing unread)
    if (lastShape === null) lastShape = shape
    if (shape === lastShape || Date.now() - lastAutoRefresh < 20 * 1000) return
    lastShape = shape
    lastAutoRefresh = Date.now()
    refresh()
  }, 3000)
})()
