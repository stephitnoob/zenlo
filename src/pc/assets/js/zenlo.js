/*
  Zenlo – trình quản lí hội thoại Zalo

  Summary panel (renderer): reads every message of the open conversation within a time range
  and asks Claude Code to summarize it. Uses window.ZenloCore.
*/

(function () {
  const Z = window.ZenloCore
  const { MINUTE, LENGTHS, formatTime, escapeHTML } = Z

  const DEFAULT_FROM_MINUTES = 180
  const TIME_FORMAT_HINT = 'dd/mm/yyyy hh:mm'

  // Quick ranges, all ending now
  const PRESETS = [
    { label: '30 phút', minutes: 30 },
    { label: '1 giờ', minutes: 60 },
    { label: '3 giờ', minutes: 180 },
    { label: '6 giờ', minutes: 360 },
    { label: '12 giờ', minutes: 720 },
    { label: '24 giờ', minutes: 1440 },
    { label: 'Từ tin chưa đọc', unread: true },
    { label: 'Từ lần trước', since: true }
  ]

  const ICON_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M4 12h7M4 18h10"/><path d="M18 3l1.2 2.8L22 7l-2.8 1.2L18 11l-1.2-2.8L14 7l2.8-1.2z"/></svg>'

  // dd/mm/yyyy hh:mm (24h)
  function toInputValue (ms) {
    return formatTime(ms, true)
  }

  // Parses "dd/mm/yyyy hh:mm"; returns NaN when the text or the date is invalid
  function parseInputValue (text) {
    const match = String(text).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/)
    if (!match) return NaN
    const [day, month, year, hour, minute] = match.slice(1).map(Number)
    const d = new Date(year, month - 1, day, hour, minute)
    const valid = d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day &&
      d.getHours() === hour && d.getMinutes() === minute
    return valid ? d.getTime() : NaN
  }

  let panel = null
  let activeJob = null

  // Messages of the chosen range, read ahead so the panel can show the size and cost before
  // "Tóm tắt" is pressed; the summary then reuses them. Only a local read, no tokens.
  let rangeCache = null
  let estimateId = 0
  let estimateTimer = null

  function loadRange (convId, fromMs, toMs, onProgress) {
    const key = `${convId}|${fromMs}|${toMs}`
    if (!rangeCache || rangeCache.key !== key) {
      const promise = Z.loadMessagesInRange(convId, fromMs, toMs, onProgress)
        .then(async ({ messages, localHistoryStart }) => ({ messages, localHistoryStart, ...await Z.prepareTranscript(messages) }))
      rangeCache = { key, promise }
      promise.catch(() => {
        if (rangeCache && rangeCache.key === key) rangeCache = null
      })
    }
    return rangeCache.promise
  }

  function setEstimate (text) {
    panel.querySelector('.zenlo__estimate').textContent = text
  }

  // Shows "N tin · ~X token" for the current range, a moment after the user stops typing
  function scheduleEstimate (delay = 400) {
    clearTimeout(estimateTimer)
    estimateTimer = setTimeout(updateEstimate, delay)
  }

  async function updateEstimate () {
    const myId = ++estimateId
    const convId = panel.dataset.convId
    const fromMs = parseInputValue(panel.querySelector('.js-summary-from').value)
    const toMs = parseInputValue(panel.querySelector('.js-summary-to').value)
    if (!convId || Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs >= toMs) return setEstimate('')

    setEstimate('Đang đếm tin nhắn…')
    try {
      const { lines, count } = await loadRange(convId, fromMs, toMs, (found) => {
        if (myId === estimateId) setEstimate(`Đang đếm tin nhắn… ${found} tin`)
      })
      if (myId !== estimateId) return
      if (!count) return setEstimate('Không có tin nhắn nào trong khoảng này.')
      const chars = lines.join('\n').length + Z.SUMMARY_PROMPT.length
      const parts = Z.splitIntoChunks(lines).length
      setEstimate(`${count} tin · ước tính ~${Z.estimateTokens(chars).toLocaleString('vi-VN')} token đầu vào` +
        (parts > 1 ? ` · chia ${parts} phần` : '') + ` · ${Z.getAILabel()}`)
    } catch (error) {
      if (myId === estimateId) setEstimate('')
    }
  }

  function setStatus (text, isError = false) {
    const el = panel.querySelector('.zenlo__main-status')
    el.textContent = text
    el.classList.toggle('zenlo__status--error', isError)
  }

  function setRunning (running) {
    panel.querySelector('.js-summary-run').disabled = running
    panel.querySelector('.js-summary-stop').hidden = !running
  }

  // range: { from, to } of the summarized messages, to date citations written without a day
  function showResult (text, streaming, range = null) {
    const el = panel.querySelector('.zenlo__result')
    el.hidden = !text
    el.classList.toggle('zenlo__result--streaming', streaming)
    el.innerHTML = streaming ? `<pre>${escapeHTML(text)}</pre>` : Z.renderMarkdown(text, { range })
    panel.querySelector('.js-summary-copy').hidden = streaming || !text
    panel.dataset.result = text
  }

  // "Từ" for the unread preset: where Zalo's unread messages started when the user opened this
  // conversation (Zalo marks it read right away). null when nothing was unread then.
  async function getUnreadFrom (convId) {
    const state = Z.getUnreadWhenOpened(convId)
    if (!state) return null
    return Z.getUnreadStart(convId, state, state.at || Date.now())
  }

  function renderLength () {
    const current = Z.getLength('summary')
    panel.querySelectorAll('[data-length]').forEach((button) => {
      button.classList.toggle('zenlo__segment-btn--active', button.dataset.length === current)
    })
  }

  function buildPanel () {
    const el = document.createElement('div')
    el.className = 'zenlo'
    el.hidden = true
    el.innerHTML = `
      <div class="zenlo__header">
        <div>
          <div class="zenlo__title"><span class="zenlo__brand">Zenlo</span> · Tóm tắt hội thoại</div>
          <div class="zenlo__conv"></div>
        </div>
        <button class="zenlo__close js-summary-close" title="Đóng">&times;</button>
      </div>

      <div class="zenlo__presets">
        ${PRESETS.map((p, i) => `<button class="zenlo__chip" data-preset="${i}">${p.label}</button>`).join('')}
      </div>

      <div class="zenlo__grid">
        <label>Từ<input type="text" class="js-summary-from" placeholder="${TIME_FORMAT_HINT}" spellcheck="false"></label>
        <label>Đến
          <span class="zenlo__field">
            <input type="text" class="js-summary-to" placeholder="${TIME_FORMAT_HINT}" spellcheck="false">
            <button type="button" class="zenlo__now js-summary-now" title="Đặt &quot;Đến&quot; là thời điểm hiện tại">Hiện tại</button>
          </span>
        </label>
      </div>

      <div class="zenlo__length">
        <span>Độ dài</span>
        <span class="zenlo__segment">
          ${LENGTHS.map((l) => `<button type="button" class="zenlo__segment-btn" data-length="${l.value}">${l.label}</button>`).join('')}
        </span>
      </div>

      <div class="zenlo__actions">
        <button class="zenlo__btn zenlo__btn--primary js-summary-run">Tóm tắt</button>
        <button class="zenlo__btn js-summary-stop" hidden>Dừng</button>
        <button class="zenlo__btn js-summary-copy" hidden>Sao chép</button>
      </div>

      <div class="zenlo__status zenlo__estimate"></div>
      <div class="zenlo__status zenlo__main-status"></div>
      <div class="zenlo__result" hidden></div>
    `

    el.querySelector('.js-summary-close').addEventListener('click', () => {
      el.hidden = true
    })

    const fromEl = el.querySelector('.js-summary-from')
    const toEl = el.querySelector('.js-summary-to')

    el.querySelectorAll('[data-preset]').forEach((button) => {
      button.addEventListener('click', async () => {
        const preset = PRESETS[Number(button.dataset.preset)]
        const now = Date.now()
        let from = now - preset.minutes * MINUTE

        if (preset.since) {
          const last = Z.loadLastSummary(el.dataset.convId)
          if (!last) return setStatus('Hội thoại này chưa có lần tóm tắt nào.', true)
          from = Math.max(last.to, now - Z.getLookback())
        }

        if (preset.unread) {
          try {
            from = await getUnreadFrom(el.dataset.convId)
          } catch (error) {
            return setStatus(`Lỗi: ${error.message || error}`, true)
          }
          if (from === null) return setStatus('Lúc bạn mở hội thoại này, Zalo không ghi nhận tin chưa đọc nào.', true)
        }

        fromEl.value = toInputValue(from)
        toEl.value = toInputValue(now)
        setStatus('')
        scheduleEstimate(0)
      })
    })

    el.querySelector('.js-summary-now').addEventListener('click', () => {
      toEl.value = toInputValue(Date.now())
      scheduleEstimate(0)
    })
    fromEl.addEventListener('input', () => scheduleEstimate())
    toEl.addEventListener('input', () => scheduleEstimate())

    // A citation in the summary opens the message it came from
    el.querySelector('.zenlo__result').addEventListener('click', (event) => {
      const cite = event.target.closest('.zenlo-cite')
      if (!cite) return
      Z.jumpToMessage(el.dataset.convId, cite.dataset.times.split(',').map(Number))
        .catch((error) => setStatus(`Lỗi: ${error.message || error}`, true))
    })

    el.querySelectorAll('[data-length]').forEach((button) => {
      button.addEventListener('click', () => {
        Z.setLength('summary', button.dataset.length)
        renderLength()
      })
    })

    el.querySelector('.js-summary-run').addEventListener('click', handleRun)
    el.querySelector('.js-summary-stop').addEventListener('click', () => {
      if (activeJob) activeJob.cancel()
    })
    el.querySelector('.js-summary-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(el.dataset.result || '').then(() => setStatus('Đã sao chép bản tóm tắt.'))
    })

    document.body.appendChild(el)
    return el
  }

  // options.from: preset "Từ" (used by the digest's "Tóm tắt chi tiết")
  function openPanel (options = {}) {
    const conv = Z.getCurrentConversation()
    if (!conv) return

    if (!panel) panel = buildPanel()
    const sameConv = panel.dataset.convId === conv.id
    panel.dataset.convId = conv.id
    panel.dataset.convName = conv.name
    panel.querySelector('.zenlo__conv').textContent = conv.name
    panel.hidden = false
    renderLength()

    if (activeJob) return
    scheduleEstimate(0)

    // "Đến" always starts at now; "Từ" is kept while the panel stays on the same conversation
    const now = Date.now()
    const fromEl = panel.querySelector('.js-summary-from')
    panel.querySelector('.js-summary-to').value = toInputValue(now)
    if (options.from) fromEl.value = toInputValue(options.from)
    if (sameConv) return
    if (!options.from) {
      fromEl.value = toInputValue(now - DEFAULT_FROM_MINUTES * MINUTE)
      // Had unread messages when opened: start "Từ" at the first of them
      getUnreadFrom(conv.id).then((from) => {
        if (from !== null && panel.dataset.convId === conv.id && !activeJob) {
          fromEl.value = toInputValue(from)
          scheduleEstimate(0)
        }
      }).catch(() => {})
    }

    const last = Z.loadLastSummary(conv.id)
    if (last) {
      showResult(last.text, false, { from: last.from, to: last.to })
      setStatus(`Bản tóm tắt gần nhất (${last.count} tin nhắn, ${formatTime(last.from, true)} – ${formatTime(last.to, true)}).`)
    } else {
      showResult('', false)
      setStatus('')
    }
  }

  async function handleRun () {
    if (activeJob) return

    const convId = panel.dataset.convId
    const convName = panel.dataset.convName
    const fromMs = parseInputValue(panel.querySelector('.js-summary-from').value)
    const toMs = parseInputValue(panel.querySelector('.js-summary-to').value)
    const length = Z.getLength('summary')

    if (Number.isNaN(fromMs)) return setStatus(`"Từ" chưa đúng định dạng ${TIME_FORMAT_HINT}, ví dụ ${toInputValue(Date.now())}.`, true)
    if (Number.isNaN(toMs)) return setStatus(`"Đến" chưa đúng định dạng ${TIME_FORMAT_HINT}, ví dụ ${toInputValue(Date.now())}.`, true)
    if (fromMs >= toMs) return setStatus('Thời gian "Từ" phải trước "Đến".', true)

    let cancelled = false
    let currentCall = null
    activeJob = {
      cancel: () => {
        cancelled = true
        if (currentCall) currentCall.cancel()
      }
    }
    setRunning(true)
    showResult('', false)

    try {
      setStatus('Đang đọc tin nhắn…')
      const { messages, localHistoryStart, lines, count: messageCount } = await loadRange(convId, fromMs, toMs, (count, oldest) => {
        setStatus(`Đang đọc tin nhắn… ${count} tin (đã lùi tới ${formatTime(oldest, true)})`)
      })
      if (cancelled) throw new Error('Đã dừng.')
      if (!messageCount) {
        setStatus('Không có tin nhắn nào trong khoảng thời gian này.')
        return
      }

      const rangeText = `${formatTime(fromMs, true)} – ${formatTime(toMs, true)}`
      const historyNote = localHistoryStart
        ? ` Lưu ý: trên máy chỉ có tin nhắn từ ${formatTime(localHistoryStart, true)}.`
        : ''
      Z.log('messages', messages.length, 'lines', lines.length)

      const chunks = Z.splitIntoChunks(lines)
      let input = `<transcript>\n${lines.join('\n')}\n</transcript>`

      if (chunks.length > 1) {
        const notes = []
        for (let i = 0; i < chunks.length; i++) {
          if (cancelled) throw new Error('Đã dừng.')
          setStatus(`Đang tóm tắt phần ${i + 1}/${chunks.length} (${messageCount} tin nhắn).${historyNote}`)
          currentCall = Z.runAI({
            systemPrompt: Z.SUMMARY_PROMPT,
            instruction: Z.buildPartInstruction({ convName, part: i + 1, parts: chunks.length }),
            input: `<transcript>\n${chunks[i].join('\n')}\n</transcript>`
          })
          notes.push(`### Phần ${i + 1}\n` + await currentCall.promise)
        }
        input = `<notes>\n${notes.join('\n\n')}\n</notes>`
      }

      if (cancelled) throw new Error('Đã dừng.')
      setStatus(`Đang tóm tắt ${messageCount} tin nhắn (${rangeText}) bằng ${Z.getAILabel()}…${historyNote}`)

      let streamed = ''
      currentCall = Z.runAI({
        systemPrompt: Z.SUMMARY_PROMPT,
        instruction: Z.buildSummaryInstruction({ convName, from: fromMs, to: toMs, count: messageCount, length, notes: chunks.length > 1 }),
        input
      }, (text) => {
        streamed += text
        showResult(streamed, true)
      })
      const result = await currentCall.promise

      showResult(result, false, { from: fromMs, to: toMs })
      setStatus(`Đã tóm tắt ${messageCount} tin nhắn (${rangeText}).${historyNote}`)
      Z.saveLastSummary(convId, { from: fromMs, to: toMs, text: result, count: messageCount, at: Date.now() })
    } catch (error) {
      setStatus(cancelled ? 'Đã dừng.' : `Lỗi: ${error.message || error}`, !cancelled)
    } finally {
      activeJob = null
      setRunning(false)
    }
  }

  function injectHeaderButton () {
    const headerBtns = document.getElementById('headerBtns')
    if (!headerBtns || headerBtns.querySelector('.zenlo-btn')) return

    const button = document.createElement('div')
    button.className = 'z--btn--v2 btn-tertiary-neutral medium --rounded zenlo-btn'
    button.title = 'Zenlo · Tóm tắt hội thoại'
    button.innerHTML = ICON_SVG
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      if (panel && !panel.hidden && panel.dataset.convId === (Z.getCurrentConversation() || {}).id) {
        panel.hidden = true
      } else {
        openPanel()
      }
    })
    headerBtns.prepend(button)
  }

  Z.onDomChange(() => {
    injectHeaderButton()
    // Keep the panel in sync when the user switches conversations
    if (panel && !panel.hidden && !activeJob) {
      const conv = Z.getCurrentConversation()
      if (conv && conv.id !== panel.dataset.convId) openPanel()
    }
  })

  // Lets other Zenlo features open this panel
  window.ZenloSummary = { open: openPanel }
})()
