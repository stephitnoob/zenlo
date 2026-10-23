/*
  Zenlo – trình quản lí hội thoại Zalo

  Settings ("Cài đặt Zenlo", renderer): a tab in Zalo's left bar to choose the AI (Claude Code on
  a Claude Pro/Max plan, or Gemini with the user's own API key), default summary lengths, how far
  back unread messages are read, and to clear saved summaries.
*/

(function () {
  const Z = window.ZenloCore
  const { STORAGE_KEYS, MODELS, EFFORTS, GEMINI_MODELS, GEMINI_EFFORTS, LOOKBACK_DAYS, LENGTHS, escapeHTML } = Z

  // Sliders, so it is not confused with Zalo's own settings gear at the bottom of the bar
  const ICON_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>'
  const EYE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>'

  const options = (list, selected) => list
    .map((item) => {
      const value = typeof item === 'string' ? item : item.value
      const label = typeof item === 'string' ? item : item.label
      return `<option value="${escapeHTML(value)}"${value === selected ? ' selected' : ''}>${escapeHTML(label)}</option>`
    })
    .join('')

  let overlay = null

  function setTestStatus (text, isError = false) {
    const el = overlay.querySelector('.js-settings-test-status')
    el.textContent = text
    el.classList.toggle('zenlo__status--error', isError)
  }

  // Shows only the chosen provider's options
  function renderProvider () {
    const provider = Z.getAISettings().provider
    overlay.querySelectorAll('[name="zenlo-provider"]').forEach((radio) => {
      radio.checked = radio.value === provider
    })
    overlay.querySelector('.js-settings-claude').hidden = provider !== 'claude'
    overlay.querySelector('.js-settings-gemini').hidden = provider !== 'gemini'
  }

  // What the main process knows: whether Claude Code is installed, the saved Gemini key
  async function loadMainSettings () {
    const status = overlay.querySelector('.js-settings-claude-status')
    const keyInput = overlay.querySelector('.js-settings-gemini-key')
    if (!window.$zenlo || !window.$zenlo.getSettings) {
      status.textContent = 'Chưa có cầu nối của Zenlo. Hãy cài lại Zenlo rồi mở lại Zalo.'
      return
    }
    try {
      const settings = await window.$zenlo.getSettings()
      status.textContent = settings.claudePath
        ? '✓ Đã tìm thấy Claude Code trên máy.'
        : '✗ Chưa tìm thấy Claude Code. Hãy cài Claude Code và đăng nhập bằng tài khoản Claude.'
      status.classList.toggle('zenlo__status--error', !settings.claudePath)
      keyInput.value = settings.geminiKey || ''
      overlay.querySelector('.js-settings-gemini-key-status').textContent = settings.geminiKey ? 'Đã lưu key (mã hoá bằng Windows trên máy này).' : ''
    } catch (error) {
      status.textContent = `Lỗi: ${error.message || error}`
    }
  }

  async function saveGeminiKey () {
    const keyInput = overlay.querySelector('.js-settings-gemini-key')
    const status = overlay.querySelector('.js-settings-gemini-key-status')
    try {
      await window.$zenlo.setGeminiKey(keyInput.value.trim())
      status.textContent = keyInput.value.trim() ? 'Đã lưu key (mã hoá bằng Windows trên máy này).' : 'Đã xoá key.'
      status.classList.remove('zenlo__status--error')
    } catch (error) {
      status.textContent = `Lỗi: ${error.message || error}`
      status.classList.add('zenlo__status--error')
    }
  }

  // A one-word request, to check that the chosen AI answers
  async function testConnection () {
    const button = overlay.querySelector('.js-settings-test')
    button.disabled = true
    setTestStatus(`Đang thử ${Z.getAILabel()}…`)
    try {
      const call = Z.runAI({ systemPrompt: 'Chỉ trả lời đúng một chữ: ok', instruction: 'Trả lời "ok".', input: '' })
      const answer = String(await call.promise).trim()
      setTestStatus(answer ? `✓ Kết nối được: ${Z.getAILabel()} đã trả lời.` : 'AI không trả lời gì.', !answer)
    } catch (error) {
      setTestStatus(`Lỗi: ${error.message || error}`, true)
    } finally {
      button.disabled = false
    }
  }

  function buildOverlay () {
    const get = (key, list, fallback) => Z.getSetting(key, list.map((i) => (typeof i === 'string' ? i : i.value)), fallback)

    const el = document.createElement('div')
    el.className = 'zenlo zenlo-settings'
    el.hidden = true
    el.innerHTML = `
      <div class="zenlo__header">
        <div class="zenlo__title"><span class="zenlo__brand">Zenlo</span> · Cài đặt</div>
        <button class="zenlo__close js-settings-close" title="Đóng">&times;</button>
      </div>

      <section class="zenlo-settings__section">
        <div class="zenlo-settings__heading">AI dùng để tóm tắt</div>
        <div class="zenlo-settings__choice">
          <label><input type="radio" name="zenlo-provider" value="claude"> Claude</label>
          <label><input type="radio" name="zenlo-provider" value="gemini"> Gemini</label>
        </div>

        <div class="js-settings-claude">
          <div class="zenlo__grid">
            <label>Model<select class="js-settings-claude-model">${options(MODELS, get(STORAGE_KEYS.model, MODELS, 'sonnet'))}</select></label>
            <label>Effort<select class="js-settings-claude-effort">${options(EFFORTS, get(STORAGE_KEYS.effort, EFFORTS, 'medium'))}</select></label>
          </div>
          <div class="zenlo-settings__note">Cần gói <b>Claude Pro</b> hoặc <b>Claude Max</b>, và Claude Code đã đăng nhập trên máy này. Zenlo dùng lượt của gói, không dùng API key.</div>
          <div class="zenlo__status js-settings-claude-status"></div>
        </div>

        <div class="js-settings-gemini">
          <label class="zenlo-settings__label">API key Gemini
            <span class="zenlo__field">
              <input type="password" class="js-settings-gemini-key" placeholder="Dán API key vào đây" spellcheck="false" autocomplete="off">
              <button type="button" class="zenlo__now zenlo-settings__eye js-settings-eye" title="Hiện / ẩn key">${EYE_SVG}</button>
            </span>
          </label>
          <div class="zenlo__status js-settings-gemini-key-status"></div>
          <div class="zenlo__grid">
            <label>Model<select class="js-settings-gemini-model">${options(GEMINI_MODELS, get(STORAGE_KEYS.geminiModel, GEMINI_MODELS, GEMINI_MODELS[0].value))}</select></label>
            <label>Effort<select class="js-settings-gemini-effort">${options(GEMINI_EFFORTS, get(STORAGE_KEYS.geminiEffort, GEMINI_EFFORTS, 'high'))}</select></label>
          </div>
          <div class="zenlo-settings__note zenlo-settings__note--warn">
            <b>Lưu ý dữ liệu:</b> với key miễn phí, Google có thể dùng nội dung gửi lên để huấn luyện và cải thiện sản phẩm, gồm cả tin nhắn của những người khác trong hội thoại. Key trả phí thì không bị dùng như vậy.
            Lấy key tại aistudio.google.com/apikey. Khi model đang quá tải, Zenlo tự chuyển sang model còn lại.
          </div>
        </div>

        <div class="zenlo__actions">
          <button class="zenlo__btn js-settings-test">Kiểm tra kết nối</button>
        </div>
        <div class="zenlo__status js-settings-test-status"></div>
      </section>

      <section class="zenlo-settings__section">
        <div class="zenlo-settings__heading">Tóm tắt và Bản tin</div>
        <div class="zenlo__grid">
          <label>Độ dài Tóm tắt<select class="js-settings-length" data-feature="summary">${options(LENGTHS, Z.getLength('summary'))}</select></label>
          <label>Độ dài Bản tin<select class="js-settings-length" data-feature="digest">${options(LENGTHS, Z.getLength('digest'))}</select></label>
          <label>Tìm tin chưa đọc lùi tối đa<select class="js-settings-lookback">${LOOKBACK_DAYS.map((d) => `<option value="${d}"${String(Z.getLookback() / Z.DAY) === d ? ' selected' : ''}>${d} ngày</option>`).join('')}</select></label>
        </div>
      </section>

      <section class="zenlo-settings__section">
        <div class="zenlo-settings__heading">Dữ liệu</div>
        <div class="zenlo__actions">
          <button class="zenlo__btn js-settings-clear">Xoá bản tóm tắt đã lưu</button>
        </div>
        <div class="zenlo-settings__note">Thứ tự ưu tiên và các ô tick trong Bản tin được giữ lại.</div>
        <div class="zenlo__status js-settings-clear-status"></div>
      </section>

      <div class="zenlo-settings__footer">Zenlo · © stephit</div>
    `

    el.querySelector('.js-settings-close').addEventListener('click', () => {
      el.hidden = true
    })

    el.querySelectorAll('[name="zenlo-provider"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        Z.setSetting(STORAGE_KEYS.provider, radio.value)
        renderProvider()
        setTestStatus('')
      })
    })
    const bindSelect = (selector, key) => {
      el.querySelector(selector).addEventListener('change', (event) => {
        Z.setSetting(key, event.target.value)
        setTestStatus('')
      })
    }
    bindSelect('.js-settings-claude-model', STORAGE_KEYS.model)
    bindSelect('.js-settings-claude-effort', STORAGE_KEYS.effort)
    bindSelect('.js-settings-gemini-model', STORAGE_KEYS.geminiModel)
    bindSelect('.js-settings-gemini-effort', STORAGE_KEYS.geminiEffort)
    bindSelect('.js-settings-lookback', STORAGE_KEYS.lookbackDays)
    el.querySelectorAll('.js-settings-length').forEach((select) => {
      select.addEventListener('change', () => Z.setLength(select.dataset.feature, select.value))
    })

    const keyInput = el.querySelector('.js-settings-gemini-key')
    keyInput.addEventListener('change', saveGeminiKey)
    el.querySelector('.js-settings-eye').addEventListener('click', () => {
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password'
    })

    el.querySelector('.js-settings-test').addEventListener('click', testConnection)
    el.querySelector('.js-settings-clear').addEventListener('click', () => {
      if (!window.confirm('Xoá mọi bản tóm tắt và bản tin đã lưu?')) return
      const removed = Z.clearSavedResults()
      el.querySelector('.js-settings-clear-status').textContent = `Đã xoá ${removed} mục.`
    })

    document.body.appendChild(el)
    return el
  }

  function toggleOverlay () {
    if (!overlay) overlay = buildOverlay()
    overlay.hidden = !overlay.hidden
    if (overlay.hidden) return
    // The lengths may have changed in the panels since this page was built
    overlay.querySelectorAll('.js-settings-length').forEach((select) => {
      select.value = Z.getLength(select.dataset.feature)
    })
    overlay.querySelector('.js-settings-gemini-key').type = 'password'
    renderProvider()
    loadMainSettings()
  }

  // A tab in Zalo's left bar, below "Bản tin"
  function injectNavButton () {
    const bottom = document.querySelector('#main-tab .nav__tabs__bottom')
    if (!bottom || bottom.querySelector('.zenlo-settings-btn')) return

    const tab = document.createElement('div')
    tab.className = 'clickable leftbar-tab flx flx-col flx-al-c flx-center rel zenlo-nav-btn zenlo-settings-btn'
    tab.title = 'Zenlo · Cài đặt'
    tab.innerHTML = `<div class="mmi-icon-wr">${ICON_SVG}</div><div class="lb-tab-title truncate">Zenlo</div>`
    tab.addEventListener('click', (event) => {
      event.stopPropagation()
      toggleOverlay()
    })
    const digestTab = bottom.querySelector('.zenlo-digest-btn')
    if (digestTab) digestTab.after(tab)
    else bottom.prepend(tab)
  }

  Z.onDomChange(injectNavButton)
})()
