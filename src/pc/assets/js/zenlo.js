/*
  Zenlo – trình quản lí hội thoại Zalo

  Summary panel (renderer): reads every message of the open conversation within a time range
  and asks Claude Code to summarize it. Uses window.ZenloCore.
*/

(function () {
  const Z = window.ZenloCore
  const { MINUTE, MAX_RANGE, STORAGE_KEYS, MODELS, EFFORTS, formatTime, escapeHTML } = Z

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

  const SYSTEM_PROMPT = [
    'Bạn tóm tắt cuộc trò chuyện Zalo cho người dùng Zenlo ("Tôi" trong bản chép). Trong bản tóm tắt, gọi người dùng là "bạn"; gọi người khác theo tên hiển thị.',
    'Mục tiêu: đọc xong là nắm được chuyện gì đã xảy ra và bạn cần làm gì, không phải đọc lại tin nhắn.',
    'Viết tiếng Việt, đúng với nội dung, không suy đoán; chỗ nào không rõ thì ghi "(chưa rõ)".',
    'Đổi mọi mốc thời gian tương đối ("mai", "thứ 6", "tối nay", "tuần sau") thành ngày cụ thể dd/mm, tính từ ngày của tin nhắn chứa nó. Hạn nào đã qua so với bây giờ thì ghi thêm "(đã qua)".',
    'Bỏ qua chào hỏi, tán gẫu, sticker và tin hệ thống, trừ khi chúng mang thông tin quan trọng.',
    'Độ dài tương xứng nội dung: ít tin thì chỉ vài dòng; không lặp một ý ở nhiều mục.',
    'Chỉ dùng tiêu đề "## ", gạch đầu dòng "- " và **in đậm**; không dùng bảng, danh sách đánh số hay dấu `code`.'
  ].join('\n')

  // Sections in order of how much the user needs them; empty ones are dropped
  const SUMMARY_SECTIONS = [
    '"## Cần bạn": ai hỏi, nhờ, nhắc hoặc giao việc cho bạn (ai, việc gì, hạn).',
    '"## Tổng quan": 1–3 câu.',
    '"## Việc cần làm": mỗi dòng "- Ai: việc (hạn)", gồm việc được giao hoặc hứa làm.',
    '"## Quyết định": những gì đã chốt.',
    '"## Ý chính": các ý còn lại, nhóm theo chủ đề.',
    '"## Tài liệu & liên kết": file, link, ảnh đáng chú ý (tên, ai gửi, ngày).',
    '"## Câu hỏi còn bỏ ngỏ": câu hỏi chưa ai trả lời.'
  ].join(' ')

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

  function setStatus (text, isError = false) {
    const el = panel.querySelector('.zenlo__status')
    el.textContent = text
    el.classList.toggle('zenlo__status--error', isError)
  }

  function setRunning (running) {
    panel.querySelector('.js-summary-run').disabled = running
    panel.querySelector('.js-summary-stop').hidden = !running
  }

  function showResult (text, streaming) {
    const el = panel.querySelector('.zenlo__result')
    el.hidden = !text
    el.classList.toggle('zenlo__result--streaming', streaming)
    el.innerHTML = streaming ? `<pre>${escapeHTML(text)}</pre>` : Z.renderMarkdown(text)
    panel.querySelector('.js-summary-copy').hidden = streaming || !text
    panel.dataset.result = text
  }

  // "Từ" for the unread preset: Zenlo's own watermark or the user's last message, at most 24h back
  async function getUnreadFrom (convId) {
    const now = Date.now()
    const { messages } = await Z.loadMessagesInRange(convId, now - MAX_RANGE, now)
    return Z.getUnreadStart(convId, messages, now)
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
        <label>Model<select class="js-summary-model">${MODELS.map((m) => `<option value="${m.value}">${m.label}</option>`).join('')}</select></label>
        <label>Effort<select class="js-summary-effort">${EFFORTS.map((e) => `<option value="${e}">${e}</option>`).join('')}</select></label>
      </div>

      <div class="zenlo__actions">
        <button class="zenlo__btn zenlo__btn--primary js-summary-run">Tóm tắt</button>
        <button class="zenlo__btn js-summary-stop" hidden>Dừng</button>
        <button class="zenlo__btn js-summary-copy" hidden>Sao chép</button>
      </div>

      <div class="zenlo__status"></div>
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
          from = Math.max(last.to, now - MAX_RANGE)
        }

        if (preset.unread) {
          try {
            from = await getUnreadFrom(el.dataset.convId)
          } catch (error) {
            return setStatus(`Lỗi: ${error.message || error}`, true)
          }
        }

        fromEl.value = toInputValue(from)
        toEl.value = toInputValue(now)
        setStatus('')
      })
    })

    el.querySelector('.js-summary-now').addEventListener('click', () => {
      toEl.value = toInputValue(Date.now())
    })

    const modelEl = el.querySelector('.js-summary-model')
    const effortEl = el.querySelector('.js-summary-effort')
    const settings = Z.getModelSettings()
    modelEl.value = settings.model
    effortEl.value = settings.effort
    modelEl.addEventListener('change', () => Z.setSetting(STORAGE_KEYS.model, modelEl.value))
    effortEl.addEventListener('change', () => Z.setSetting(STORAGE_KEYS.effort, effortEl.value))

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

    if (activeJob) return

    // "Đến" always starts at now; "Từ" is kept while the panel stays on the same conversation
    const now = Date.now()
    panel.querySelector('.js-summary-to').value = toInputValue(now)
    if (options.from) panel.querySelector('.js-summary-from').value = toInputValue(options.from)
    if (sameConv) return
    if (!options.from) panel.querySelector('.js-summary-from').value = toInputValue(now - DEFAULT_FROM_MINUTES * MINUTE)

    const last = Z.loadLastSummary(conv.id)
    if (last) {
      showResult(last.text, false)
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
    const model = panel.querySelector('.js-summary-model').value
    const effort = panel.querySelector('.js-summary-effort').value

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
      const { messages, localHistoryStart } = await Z.loadMessagesInRange(convId, fromMs, toMs, (count, oldest) => {
        setStatus(`Đang đọc tin nhắn… ${count} tin (đã lùi tới ${formatTime(oldest, true)})`)
      })
      if (cancelled) throw new Error('Đã dừng.')

      const { lines, count: messageCount } = Z.buildTranscript(messages)
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
          currentCall = Z.runClaude({
            systemPrompt: SYSTEM_PROMPT,
            model,
            effort,
            instruction: `Đây là phần ${i + 1}/${chunks.length} của cuộc trò chuyện "${convName}"; ghi chú này sẽ được gộp với các phần khác. Ghi lại dạng gạch đầu dòng, kèm ngày cụ thể: việc cần bạn làm, việc cần làm (ai, việc, hạn), quyết định, ý chính, tài liệu và liên kết, câu hỏi còn bỏ ngỏ.`,
            input: `<transcript>\n${chunks[i].join('\n')}\n</transcript>`
          })
          notes.push(`### Phần ${i + 1}\n` + await currentCall.promise)
        }
        input = `<notes>\n${notes.join('\n\n')}\n</notes>`
      }

      if (cancelled) throw new Error('Đã dừng.')
      setStatus(`Đang tóm tắt ${messageCount} tin nhắn (${rangeText}) bằng ${model}…${historyNote}`)

      let streamed = ''
      currentCall = Z.runClaude({
        systemPrompt: SYSTEM_PROMPT,
        model,
        effort,
        instruction: [
          `Tóm tắt cuộc trò chuyện Zalo "${convName}" từ ${rangeText} (${messageCount} tin nhắn).`,
          chunks.length > 1 ? 'Dữ liệu là ghi chú đã tóm tắt từng phần, xếp theo thời gian.' : '',
          `Viết theo các mục sau, đúng thứ tự, bỏ hẳn mục nào không có nội dung: ${SUMMARY_SECTIONS}`
        ].filter(Boolean).join(' '),
        input
      }, (text) => {
        streamed += text
        showResult(streamed, true)
      })
      const result = await currentCall.promise

      showResult(result, false)
      setStatus(`Đã tóm tắt ${messageCount} tin nhắn (${rangeText}).${historyNote}`)
      Z.saveLastSummary(convId, { from: fromMs, to: toMs, text: result, count: messageCount, at: Date.now() })

      // The summary covered everything since the read watermark, so the user has now seen it
      if (fromMs <= Math.max(Z.getReadWatermark(convId), Date.now() - MAX_RANGE)) {
        Z.advanceReadWatermark(convId, toMs)
      }
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
