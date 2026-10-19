/*
  Zenlo – trình quản lí hội thoại Zalo

  Reply suggestions (renderer): a button in the composer toolbar that drafts 3 short replies
  from the recent messages, the gist the user typed, and the user's own writing style.
  A picked reply only fills the input box; Zenlo never sends anything.
*/

(function () {
  const Z = window.ZenloCore
  const { escapeHTML } = Z

  const CONTEXT_MESSAGES = 30
  const STYLE_SCAN_MESSAGES = 300
  const STYLE_SAMPLES = 8

  const SYSTEM_PROMPT = [
    'Bạn soạn sẵn tin nhắn trả lời để người dùng Zenlo ("Tôi" trong bản chép) chọn và gửi trong Zalo. Bạn viết thay "Tôi", ở ngôi của "Tôi".',
    'Viết như chính "Tôi" nhắn: giữ đúng cách xưng hô "Tôi" đang dùng với người đó (anh/em, con/mẹ, t/m, mình/bạn…), giống độ dài, cách viết tắt, viết hoa hay viết thường, dấu câu và emoji trong các tin của "Tôi" ở bản chép và <style>.',
    'Không thêm lời chào hay câu thừa. Không bịa thông tin, không thêm ý, lời hứa hay đề nghị nào ngoài ý đã cho.'
  ].join('\n')

  const ICON_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M15.5 7.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></svg>'

  let popover = null
  let activeCall = null

  // ---------- Composer ----------

  // Zalo's rich input component (found through React internals of #richInput)
  function getComposer () {
    const input = document.getElementById('richInput')
    if (!input) return null
    const key = Object.keys(input).find((k) => k.startsWith('__reactInternalInstance'))
    let fiber = key && input[key]
    for (let depth = 0; fiber && depth < 8; depth++) {
      const current = fiber.ref && fiber.ref.current
      if (current && typeof current.getText === 'function' && typeof current._setInitialText === 'function') return current
      fiber = fiber.return
    }
    return null
  }

  function getComposerText () {
    const composer = getComposer()
    return composer ? String(composer.getText() || '').trim() : ''
  }

  function setComposerText (text) {
    const composer = getComposer()
    if (!composer) throw new Error('Không tìm thấy ô soạn tin của Zalo.')
    if (typeof composer._callClearMessage === 'function') composer._callClearMessage()
    composer._setInitialText(text)
    if (typeof composer._callFocus === 'function') composer._callFocus()
  }

  // ---------- Prompt ----------

  async function buildRequest (conv, gist) {
    const recent = await Z.getLatestMessages(conv.id, STYLE_SCAN_MESSAGES)
    const context = recent.slice(-CONTEXT_MESSAGES)
    const { lines } = await Z.prepareTranscript(context)

    // The user's own recent text messages, as examples of how they write
    const samples = recent
      .filter((m) => m.fromUid === '0' && typeof m.message === 'string' && m.message.trim())
      .slice(-STYLE_SAMPLES)
      .map((m) => '- ' + m.message.replace(/\s*\n\s*/g, ' / '))

    const input = [
      `<transcript name="${conv.name.replace(/"/g, "'")}">`,
      ...lines,
      '</transcript>',
      samples.length ? `<style>\n${samples.join('\n')}\n</style>` : ''
    ].filter(Boolean).join('\n')

    const instruction = [
      'Soạn 3 phương án tin nhắn để "Tôi" gửi tiếp theo trong cuộc trò chuyện.',
      gist
        ? `Ý "Tôi" muốn nói: "${gist}". Cả 3 phương án giữ đúng ý này, chỉ khác cách nói: ngắn gọn, đầy đủ hơn, mềm mỏng hơn.`
        : 'Trả lời tin nhắn gần nhất mà "Tôi" cần phản hồi; nếu hợp lý thì 3 phương án theo 3 hướng khác nhau (ví dụ đồng ý, hỏi thêm, từ chối khéo).',
      'Chỉ in đúng 3 dòng, mỗi dòng bắt đầu bằng "1. ", "2. ", "3. ", không giải thích gì thêm.'
    ].join(' ')

    return { instruction, input }
  }

  function parseOptions (text) {
    return text.split('\n')
      .map((line) => line.match(/^\s*[1-3][.)]\s+(.+)$/))
      .filter(Boolean)
      .map((match) => match[1].trim())
      .slice(0, 3)
  }

  // ---------- UI ----------

  function renderPopover ({ status = '', isError = false, options = [] }) {
    popover.querySelector('.zenlo-reply__status').textContent = status
    popover.querySelector('.zenlo-reply__status').classList.toggle('zenlo__status--error', isError)
    popover.querySelector('.zenlo-reply__options').innerHTML = options
      .map((option, i) => `<button class="zenlo-reply__option" data-index="${i}">${escapeHTML(option)}</button>`)
      .join('')
    popover.dataset.options = JSON.stringify(options)
  }

  function positionPopover (anchor) {
    const rect = anchor.getBoundingClientRect()
    popover.style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - 436))}px`
    popover.style.bottom = `${window.innerHeight - rect.top + 8}px`
  }

  async function suggest () {
    if (activeCall) return
    const conv = Z.getCurrentConversation()
    if (!conv) return

    const gist = getComposerText()
    const { model, effort } = Z.getModelSettings()
    renderPopover({ status: gist ? `Đang viết theo ý "${gist}"…` : 'Đang soạn gợi ý…' })

    try {
      const { instruction, input } = await buildRequest(conv, gist)
      activeCall = Z.runClaude({ systemPrompt: SYSTEM_PROMPT, model, effort, instruction, input })
      const options = parseOptions(await activeCall.promise)
      if (!options.length) throw new Error('Không đọc được gợi ý, hãy thử lại.')
      renderPopover({ status: 'Chọn một câu để điền vào ô soạn tin:', options })
    } catch (error) {
      renderPopover({ status: `Lỗi: ${error.message || error}`, isError: true })
    } finally {
      activeCall = null
    }
  }

  function buildPopover () {
    const el = document.createElement('div')
    el.className = 'zenlo zenlo-reply'
    el.hidden = true
    el.innerHTML = `
      <div class="zenlo__header">
        <div class="zenlo__title"><span class="zenlo__brand">Zenlo</span> · Gợi ý trả lời</div>
        <button class="zenlo__close js-reply-close" title="Đóng">&times;</button>
      </div>
      <div class="zenlo__status zenlo-reply__status"></div>
      <div class="zenlo-reply__options"></div>
      <div class="zenlo__actions">
        <button class="zenlo__btn js-reply-again">Gợi ý lại</button>
      </div>
      <div class="zenlo__conv">Mẹo: gõ ý chính vào ô soạn tin trước khi bấm, Zenlo sẽ viết theo ý đó.</div>
    `

    el.querySelector('.js-reply-close').addEventListener('click', () => {
      if (activeCall) activeCall.cancel()
      el.hidden = true
    })
    el.querySelector('.js-reply-again').addEventListener('click', suggest)
    el.querySelector('.zenlo-reply__options').addEventListener('click', (event) => {
      const button = event.target.closest('.zenlo-reply__option')
      if (!button) return
      const options = JSON.parse(el.dataset.options || '[]')
      try {
        setComposerText(options[Number(button.dataset.index)])
        el.hidden = true
      } catch (error) {
        renderPopover({ status: `Lỗi: ${error.message || error}`, isError: true, options })
      }
    })

    document.body.appendChild(el)
    return el
  }

  function injectToolbarButton () {
    const toolbar = document.querySelector('#chat-box-bar-id ul.chat-box-toolbar')
    if (!toolbar || toolbar.querySelector('.zenlo-reply-btn')) return

    const item = document.createElement('li')
    item.className = 'chat-box-toolbar-item zenlo-reply-btn'
    item.innerHTML = `<div class="z--btn--v2 btn-tertiary-neutral medium chat-box-toolbar-button --rounded icon-only" title="Zenlo · Gợi ý trả lời">${ICON_SVG}</div>`
    item.addEventListener('click', (event) => {
      event.stopPropagation()
      if (!popover) popover = buildPopover()
      if (!popover.hidden) {
        popover.hidden = true
        return
      }
      popover.hidden = false
      positionPopover(item)
      suggest()
    })
    toolbar.appendChild(item)
  }

  Z.onDomChange(injectToolbarButton)
})()
