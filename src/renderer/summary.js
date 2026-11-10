/*
  Zenlo – trình quản lí hội thoại Zalo

  Summary ("Tóm tắt" tab of the Zenlo drawer, renderer): reads every message of the open
  conversation within a time range and asks the AI to summarize it. Uses window.ZenloCore.
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
  const NOTE_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4"/><path d="M8 12h8M8 16h5"/></svg>'

  // dd/mm/yyyy hh:mm (24h)
  function toInputValue (ms) {
    return formatTime(ms, true)
  }

  // "Đến" is the last moment of its minute, so "Đến 14:30" keeps a message sent at 14:30:20
  const parseInputValue = (text, end = false) => Z.parseTime(text, end)

  const { WAIT_HINT } = Z

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
    const toMs = parseInputValue(panel.querySelector('.js-summary-to').value, true)
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
      // A long conversation costs one request per part, plus one to merge them
      const requests = parts > 1 ? parts + 1 : 1
      setEstimate(`${count} tin · ước tính ~${Z.estimateTokens(chars).toLocaleString('vi-VN')} token đầu vào, ${requests} lần request` +
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

  // The letter animation, from the first AI request until the answer starts to arrive
  function setLoading (loading) {
    const el = panel.querySelector('.zenlo__loading')
    if (loading && !el.firstChild) el.innerHTML = Z.letterLoader()
    if (!loading) el.innerHTML = ''
    el.hidden = !loading
  }

  // range: { from, to } of the summarized messages, to date citations written without a day
  function showResult (text, streaming, range = null) {
    if (text) setLoading(false)
    const el = panel.querySelector('.zenlo__result')
    el.hidden = !text
    el.classList.toggle('zenlo__result--streaming', streaming)
    el.innerHTML = streaming ? `<pre>${escapeHTML(Z.plainCitations(text))}</pre>` : Z.renderMarkdown(text, { range })
    panel.querySelector('.js-summary-copy').hidden = streaming || !text
    panel.dataset.result = text
  }

  // "Ghi chú cho AI: …" under the conversation's name, or an invitation to write one
  function renderNoteLine () {
    const note = Z.getNote(panel.dataset.convId)
    const line = panel.querySelector('.zenlo__note-line')
    line.textContent = ''
    const text = document.createElement('span')
    text.textContent = note ? `Ghi chú cho AI: ${note}` : 'Chưa có ghi chú cho AI.'
    const edit = document.createElement('button')
    edit.type = 'button'
    edit.className = 'zenlo__inline-link js-note-edit'
    edit.textContent = note ? 'Sửa' : 'Thêm ghi chú'
    line.append(text, ' ', edit)
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
    el.className = 'zenlo zenlo-summary'
    el.innerHTML = `
      <div class="zenlo__empty js-summary-empty">Chọn một hội thoại ở danh sách bên trái để tóm tắt.</div>
      <div class="zenlo__conv-title"></div>
      <div class="zenlo__note-line"></div>

      <div class="zenlo__presets">
        ${PRESETS.map((p, i) => `<button class="zenlo__chip" data-preset="${i}">${p.label}</button>`).join('')}
      </div>

      <div class="zenlo__grid">
        <label>Từ<input type="text" class="js-summary-from" placeholder="${TIME_FORMAT_HINT}" spellcheck="false"></label>
        <label>
          <span class="zenlo__label-row">Đến<button type="button" class="zenlo__inline-link js-summary-now" title="Đặt &quot;Đến&quot; là thời điểm hiện tại">Hiện tại</button></span>
          <input type="text" class="js-summary-to" placeholder="${TIME_FORMAT_HINT}" spellcheck="false">
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
        <button class="zenlo__btn js-summary-skip" hidden title="Bỏ model đang chờ, hỏi bản Gemini thấp hơn">Chuyển model khác</button>
        <button class="zenlo__btn js-summary-copy" hidden>Sao chép</button>
      </div>

      <div class="zenlo__status zenlo__estimate"></div>
      <div class="zenlo__status zenlo__main-status"></div>
      <div class="zenlo__loading" hidden></div>
      <div class="zenlo__result" hidden></div>
    `

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
      Z.jumpToMessage(el.dataset.convId, cite.dataset.times.split(',').map(Number), cite.dataset.msg)
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
    el.querySelector('.js-summary-skip').addEventListener('click', (event) => {
      event.currentTarget.hidden = true
      if (activeJob) activeJob.skip()
    })
    el.querySelector('.js-summary-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(Z.withCredit(el.dataset.result))
        .then(() => setStatus('Đã sao chép bản tóm tắt.'), () => setStatus('Không sao chép được, thử lại.', true))
    })
    el.querySelector('.zenlo__note-line').addEventListener('click', (event) => {
      const edit = event.target.closest('.js-note-edit')
      if (edit) openNote(el.dataset.convId, el.dataset.convName, edit)
    })

    Z.drawer.pane('summary').appendChild(el)
    return el
  }

  // Opens the drawer on this tab. options.from: preset "Từ" (the digest's "Tóm tắt chi tiết")
  let pendingFrom = null
  // The conversation the tab shows ('' while it asks to pick one)
  let shownConvId = ''
  function openPanel (options = {}) {
    pendingFrom = options.from || null
    Z.drawer.open('summary')
  }

  // Fills the tab for the open conversation, or asks to pick one in Zalo's list
  function syncPanel () {
    const options = { from: pendingFrom }
    pendingFrom = null
    if (!panel) panel = buildPanel()
    const conv = Z.getCurrentConversation()
    panel.classList.toggle('zenlo--empty', !conv && !activeJob)
    if (activeJob) return
    shownConvId = conv ? conv.id : ''
    if (!conv) return

    const sameConv = panel.dataset.convId === conv.id
    panel.dataset.convId = conv.id
    panel.dataset.convName = conv.name
    panel.querySelector('.zenlo__conv-title').textContent = conv.name
    renderNoteLine()
    renderLength()

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
    const toMs = parseInputValue(panel.querySelector('.js-summary-to').value, true)
    const length = Z.getLength('summary')

    if (Number.isNaN(fromMs)) return setStatus(`"Từ" chưa đúng định dạng ${TIME_FORMAT_HINT}, ví dụ ${toInputValue(Date.now())}.`, true)
    if (Number.isNaN(toMs)) return setStatus(`"Đến" chưa đúng định dạng ${TIME_FORMAT_HINT}, ví dụ ${toInputValue(Date.now())}.`, true)
    if (fromMs >= toMs) return setStatus('Thời gian "Từ" phải trước "Đến".', true)

    let cancelled = false
    let currentCall = null
    let waitTimer = null
    activeJob = {
      cancel: () => {
        cancelled = true
        if (currentCall) currentCall.cancel()
      },
      skip: () => {
        if (currentCall && currentCall.skip) currentCall.skip()
      }
    }
    setRunning(true)
    showResult('', false)
    const note = Z.getNote(convId)

    try {
      setStatus('Đang đọc tin nhắn…')
      const { messages, localHistoryStart, lines, minutes, numbered, count: messageCount } = await loadRange(convId, fromMs, toMs, (count, oldest) => {
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
      const source = lines.join('\n')
      let input = `<transcript>\n${source}\n</transcript>`
      setLoading(true)

      if (chunks.length > 1) {
        // The parts at the same time, a few at once as in the digest
        const notes = []
        const calls = new Set()
        currentCall = { cancel: () => calls.forEach((call) => call.cancel()) }
        let next = 0
        let finished = 0
        setStatus(`Đang tóm tắt ${chunks.length} phần (${messageCount} tin nhắn).${historyNote}`)
        const worker = async () => {
          while (next < chunks.length) {
            if (cancelled) throw new Error('Đã dừng.')
            const i = next++
            const call = Z.runAI({
              systemPrompt: Z.SUMMARY_PROMPT,
              instruction: Z.buildPartInstruction({ convName, part: i + 1, parts: chunks.length }),
              note,
              input: `<transcript>\n${chunks[i].join('\n')}\n</transcript>`
            })
            calls.add(call)
            // Written from untrusted messages: must not close the <notes> tag of the final request
            notes[i] = `### Phần ${i + 1}\n` + Z.neutralizeTags(await call.promise)
            calls.delete(call)
            finished++
            if (!cancelled) setStatus(`Đang tóm tắt ${chunks.length} phần: xong ${finished}/${chunks.length} (${messageCount} tin nhắn).${historyNote}`)
          }
        }
        await Promise.all(Array.from({ length: Math.min(Z.PARALLEL[Z.getAISettings().provider] || 2, chunks.length) }, worker))
          .catch((error) => {
            // One part failed: the others are not needed any more
            calls.forEach((call) => call.cancel())
            throw error
          })
        input = `<notes>\n${notes.join('\n\n')}\n</notes>`
      }

      if (cancelled) throw new Error('Đã dừng.')
      setStatus(`Đang tóm tắt ${messageCount} tin nhắn (${rangeText}) bằng ${Z.getAILabel()}…${historyNote}`)

      let streamed = ''
      let usedModel = ''
      const started = Date.now()
      // Gemini: while a model has written nothing, how long it has been, so a slow Gemini does not
      // look stuck; after WAIT_HINT the user may move on to the next model
      let waitStart = 0
      let waitModel = ''
      let thinking = false
      const showWait = () => {
        const skip = panel.querySelector('.js-summary-skip')
        if (!waitStart) {
          skip.hidden = true
          return
        }
        const seconds = Math.round((Date.now() - waitStart) / 1000)
        setStatus(thinking
          ? `${waitModel} đang suy nghĩ… ${seconds} giây${historyNote}`
          : `Đang chờ ${waitModel} trả lời… ${seconds} giây${seconds * 1000 >= WAIT_HINT ? ' (Gemini đang đông)' : ''}${historyNote}`)
        // A thinking model is working: moving on would only throw that away
        skip.hidden = thinking || seconds * 1000 < WAIT_HINT
      }
      currentCall = Z.runAI({
        systemPrompt: Z.SUMMARY_PROMPT,
        instruction: Z.buildSummaryInstruction({ convName, from: fromMs, to: toMs, count: messageCount, notes: chunks.length > 1 }),
        length,
        note,
        input
      }, (text) => {
        if (waitStart) {
          waitStart = 0
          showWait()
          setStatus(`Đang tóm tắt ${messageCount} tin nhắn bằng ${usedModel}…${historyNote}`)
        }
        streamed += text
        showResult(Z.cleanAnswer(streamed, null, source, numbered), true)
      }, (modelStatus) => {
        // Gemini: which model is answering, and which ones were skipped
        usedModel = Z.describeModelStatus(modelStatus)
        if (modelStatus.done) return
        if (modelStatus.thinking) {
          thinking = true
          return showWait()
        }
        // Another model (or key) starts over: drop what a failed one had written
        streamed = ''
        showResult('', true)
        setLoading(true)
        waitStart = Date.now()
        waitModel = modelStatus.model
        thinking = false
        clearInterval(waitTimer)
        waitTimer = setInterval(showWait, 1000)
        showWait()
      })
      const result = Z.cleanAnswer(await currentCall.promise, minutes, source, numbered)

      showResult(result, false, { from: fromMs, to: toMs })
      const seconds = Math.round((Date.now() - started) / 1000)
      setStatus(`Đã tóm tắt ${messageCount} tin nhắn (${rangeText})${usedModel ? ` bằng ${usedModel}` : ''}, ${seconds} giây.${historyNote}`)
      Z.saveLastSummary(convId, { from: fromMs, to: toMs, text: result, count: messageCount, at: Date.now() })
    } catch (error) {
      setStatus(cancelled ? 'Đã dừng.' : `Lỗi: ${error.message || error}`, !cancelled)
    } finally {
      clearInterval(waitTimer)
      panel.querySelector('.js-summary-skip').hidden = true
      activeJob = null
      setLoading(false)
      setRunning(false)
    }
  }

  // ---------- The note for the AI ----------

  // A small box under the "Ghi chú" button: one note per conversation, sent to the AI with every
  // summary of it (Tóm tắt and Bản tin)
  let notePop = null

  function closeNote () {
    if (notePop) notePop.remove()
    notePop = null
  }

  function openNote (convId, convName, anchor) {
    closeNote()
    if (!convId) return
    const pop = document.createElement('div')
    pop.className = 'zenlo zenlo-note'
    pop.innerHTML = `
      <div class="zenlo-note__title">Ghi chú cho AI</div>
      <div class="zenlo-note__conv"></div>
      <textarea class="js-note-text" maxlength="${Z.NOTE_MAX}" rows="4" placeholder="Ví dụ: Hoa là sếp mình. Chỉ cần hạn chót và lịch họp."></textarea>
      <div class="zenlo-note__row">
        <span class="zenlo-note__count js-note-count"></span>
        <button type="button" class="zenlo__btn js-note-clear">Xoá</button>
        <button type="button" class="zenlo__btn zenlo__btn--primary js-note-save">Lưu</button>
      </div>
      <div class="zenlo-note__hint">AI đọc ghi chú này mỗi lần tóm tắt hội thoại, cả trong Bản tin.</div>
    `
    pop.querySelector('.zenlo-note__conv').textContent = convName || ''
    const text = pop.querySelector('.js-note-text')
    const count = pop.querySelector('.js-note-count')
    const showCount = () => { count.textContent = `${text.value.length}/${Z.NOTE_MAX}` }
    text.value = Z.getNote(convId)
    showCount()
    text.addEventListener('input', showCount)

    const save = (value) => {
      Z.setNote(convId, value)
      closeNote()
      updateNoteButton(true)
      if (panel && panel.dataset.convId === convId) renderNoteLine()
    }
    pop.querySelector('.js-note-save').addEventListener('click', () => save(text.value))
    pop.querySelector('.js-note-clear').addEventListener('click', () => save(''))
    pop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeNote()
      }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save(text.value)
    })
    pop.addEventListener('mousedown', (event) => event.stopPropagation())

    document.body.appendChild(pop)
    notePop = pop
    // Under the button, kept inside the window
    const box = anchor.getBoundingClientRect()
    const width = pop.offsetWidth
    pop.style.top = `${Math.round(box.bottom + 6)}px`
    pop.style.left = `${Math.round(Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8)))}px`
    text.focus()
  }

  // A click anywhere else closes the box without saving
  document.addEventListener('mousedown', () => closeNote())

  // The button lights up when the open conversation has a note
  let noteConvId = null
  function updateNoteButton (force = false) {
    const button = document.querySelector('#headerBtns .zenlo-note-btn')
    if (!button) return
    const conv = Z.getCurrentConversation()
    const id = conv ? conv.id : ''
    if (!force && id === noteConvId) return
    noteConvId = id
    const note = Z.getNote(id)
    button.classList.toggle('zenlo-note-btn--on', !!note)
    button.title = note ? `Zenlo · Ghi chú cho AI: ${note}` : 'Zenlo · Ghi chú cho AI'
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
      Z.drawer.toggle('summary')
    })

    const noteButton = document.createElement('div')
    noteButton.className = 'z--btn--v2 btn-tertiary-neutral medium --rounded zenlo-btn zenlo-note-btn'
    noteButton.title = 'Zenlo · Ghi chú cho AI'
    noteButton.innerHTML = NOTE_SVG
    noteButton.addEventListener('click', (event) => {
      event.stopPropagation()
      if (notePop) return closeNote()
      const conv = Z.getCurrentConversation()
      if (conv) openNote(conv.id, conv.name, noteButton)
    })
    noteButton.addEventListener('mousedown', (event) => event.stopPropagation())

    headerBtns.prepend(button, noteButton)
    noteConvId = null
  }

  Z.drawer.onShow('summary', syncPanel)

  Z.onDomChange(() => {
    injectHeaderButton()
    updateNoteButton()
    // Keep the tab in sync when the user picks another conversation in Zalo's list
    if (Z.drawer.isOpen('summary') && !activeJob) {
      const conv = Z.getCurrentConversation()
      if ((conv ? conv.id : '') !== shownConvId) syncPanel()
    }
  })

  // Lets other Zenlo features open this panel
  window.ZenloSummary = { open: openPanel }
})()
