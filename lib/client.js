/**
 * 客户端插件：侧边栏入口 + 搜索弹窗 + 可自定义快捷键。
 *
 * 打包形态与其它 dsh web 插件一致：交给宿主的模块加载器，react 从宿主模块表里取。
 * 弹窗挂在 shell.overlay，入口挂在 sidebar.footer.action，插件详情页加一行快捷键设置
 * （plugins.detail.actions）。数据走宿主侧的同源路由 /session-search/query 与 /read。
 *
 * 快捷键是自持的：DSH 的 shortcuts 服务可用时会额外注册一条（从而出现在 DSH 的快捷键
 * 设置页里），但按键最终由本地配置 + window 监听兜底，不依赖它注册成功。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-search',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const react = require('react')
    const h = react.createElement

    const NAME = 'session-search'
    const PACKAGE_NAME = 'dsh-session-search'
    const CSS_ID = 'dsh-session-search/styles.css'
    const HOTKEY_STORE = 'dsh.session-search.hotkey.v1'
    const DEFAULT_HOTKEY = { code: 'KeyK', ctrl: true, shift: true, alt: false, meta: false }

    const css = `
.ssx-backdrop{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.32);display:flex;align-items:flex-start;justify-content:center;padding:10vh 16px 16px}
.ssx-panel{width:min(760px,94vw);max-height:74vh;display:flex;flex-direction:column;overflow:hidden;border-radius:var(--dsw-radius-xl,20px);background:var(--dsw-alias-bg-overlay,#2a2a2c);color:var(--dsw-alias-label-primary,#eee);border:.5px solid var(--dsw-alias-border-l2,#3a3a3c);box-shadow:var(--dsw-elevation-panel,0 12px 32px rgba(0,0,0,.35));font-family:var(--dsw-font-family,inherit)}
.ssx-head{display:flex;align-items:center;gap:10px;padding:14px 18px 6px}
.ssx-input{flex:1 1 auto;min-width:0;border:0;outline:0;background:transparent;color:inherit;font-family:inherit;font-size:15px;line-height:22px}
.ssx-input::placeholder{color:var(--dsw-alias-label-tertiary,#9a9a9a)}
.ssx-meta{padding:0 18px 10px;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ssx-list{flex:1 1 auto;overflow:auto;padding:0 8px 8px}
.ssx-item{display:block;width:100%;text-align:left;padding:10px 12px;border:0;border-radius:10px;background:transparent;color:inherit;font-family:inherit;cursor:pointer}
.ssx-item:hover,.ssx-item[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}
.ssx-title{font-size:13px;font-weight:600;line-height:20px;display:flex;gap:8px;align-items:baseline}
.ssx-badge{font-size:10px;font-weight:500;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 22%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe)}
.ssx-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8a8a);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ssx-snippet{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#aaa);margin-top:6px;white-space:pre-wrap;word-break:break-word}
.ssx-snippet mark{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 28%,transparent);color:inherit;border-radius:3px;padding:0 1px}
.ssx-snippet[data-jump="true"]{cursor:pointer;border-radius:6px;padding:4px 6px;margin-left:-6px}
.ssx-snippet[data-jump="true"]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}
::highlight(dsh-session-search-hit){background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 42%,transparent);color:inherit;border-radius:3px}
.ssx-flash{position:fixed;z-index:94;pointer-events:none;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 30%,transparent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 55%,transparent);transition:opacity .35s}
.ssx-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:95;max-width:min(560px,86vw);padding:9px 14px;border-radius:10px;background:var(--dsw-alias-bg-overlay,#2a2a2c);color:var(--dsw-alias-label-primary,#eee);border:.5px solid var(--dsw-alias-border-l2,#3a3a3c);box-shadow:var(--dsw-elevation-panel,0 8px 24px rgba(0,0,0,.35));font-size:12px;line-height:18px;transition:opacity .35s}
/* 插件详情的 README 表述区加一个边框，只作用于本插件的页面。 */
[data-plugin-detail="dsh-session-search"] [data-detail-document]{margin-top:2px;padding:12px 16px;border:.5px solid var(--dsw-alias-border-l2,#3a3a3c);border-radius:var(--dsw-radius-xl,16px);background:color-mix(in srgb,var(--dsw-alias-bg-overlay,#2a2a2c) 55%,transparent)}
.ssx-cache{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:.5px solid var(--dsw-alias-border-l2,#3a3a3c);border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-overlay,#2a2a2c);color:var(--dsw-alias-label-primary,#eee);font-family:var(--dsw-font-family,inherit)}
.ssx-cacheHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ssx-cacheTitle{font-size:13px;font-weight:600;line-height:20px}
.ssx-cacheState{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#aaa)}
.ssx-cacheMeta{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ssx-cacheRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ssx-cacheBtn{border:.5px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-primary,#eee);font-family:inherit;font-size:12px;line-height:18px;padding:3px 10px;border-radius:var(--dsw-radius-sm,8px);cursor:pointer}
.ssx-cacheBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}
.ssx-cacheBtn[data-danger="true"]{border-color:var(--dsw-alias-state-warning-primary,#f0a020);color:var(--dsw-alias-state-warning-primary,#f0a020)}
.ssx-cacheBtn:disabled{opacity:.5;cursor:default}
.ssx-cacheInput{width:72px;border:.5px solid var(--dsw-alias-border-l2,#444);border-radius:6px;background:transparent;color:inherit;font-family:inherit;font-size:12px;line-height:18px;padding:2px 6px}
.ssx-cacheHint{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ssx-cacheError{font-size:11px;line-height:17px;color:var(--dsw-alias-state-error-primary,#f87171)}
.ssx-cacheOk{font-size:11px;line-height:17px;color:var(--dsw-alias-state-success-primary,#4ade80)}
.ssx-empty{padding:28px 18px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ssx-foot{display:flex;gap:14px;align-items:center;padding:8px 16px;border-top:.5px solid var(--dsw-alias-border-l1,#333);font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ssx-kbd{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:10px;padding:1px 5px;border-radius:var(--dsw-radius-xs,4px);border:.5px solid var(--dsw-alias-border-l2,#444)}
.ssx-keys{display:inline-flex;gap:4px;margin-left:6px;vertical-align:middle}
.ssx-footKeys{margin-left:auto;display:inline-flex;align-items:center;gap:4px}
.ssx-detail{display:flex;align-items:center;gap:10px;padding:12px 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#aaa);font-family:var(--dsw-font-family,inherit);flex-wrap:wrap}
.ssx-detailLabel{color:var(--dsw-alias-label-primary,#eee)}
.ssx-detailBtn{border:.5px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-primary,#eee);font-family:inherit;font-size:12px;line-height:18px;padding:3px 10px;border-radius:var(--dsw-radius-sm,8px);cursor:pointer}
.ssx-detailBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}
.ssx-detailBtn[data-recording="true"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}
.ssx-warn{font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary,#f87171);width:100%}
.ssx-side{display:flex;align-items:center;gap:8px;width:100%;border:0;border-radius:var(--dsw-radius-md,12px);background:transparent;color:var(--dsw-alias-label-primary,#eee);font-family:var(--dsw-font-family,inherit);font-size:13px;line-height:20px;padding:6px 8px;cursor:pointer;text-align:left}
.ssx-side:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}
.ssx-side[data-compact="true"]{width:36px;height:36px;padding:0;justify-content:center;gap:0}
.ssx-sideIco{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.ssx-sideLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = NAME
      tag.dataset.pluginCss = CSS_ID
      tag.textContent = css
      document.head.appendChild(tag)
    }

    /** 极简订阅 store：弹窗开关与查询状态都放这里，多个 slot 共享。 */
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(patch) {
          state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    const store = createStore({
      open: false,
      query: '',
      status: 'idle',
      results: [],
      scanned: null,
      error: null,
      expanded: null,
      expandedTurns: null,
      expandedLoading: false,
      hotkey: DEFAULT_HOTKEY,
      recording: false,
      recordWarning: null,
    })

    //#region 快捷键配置

    /** DSH 已知的内置组合，用来提示冲突（键名按 code 记）。 */
    const BUILTIN_COMBOS = [
      { code: 'KeyN', ctrl: true, shift: false, alt: false, label: '新会话' },
      { code: 'KeyK', ctrl: true, shift: false, alt: false, label: '搜索会话' },
      { code: 'KeyF', ctrl: true, shift: false, alt: true, label: '分叉会话' },
      { code: 'KeyA', ctrl: true, shift: true, alt: false, label: '归档会话' },
      { code: 'KeyG', ctrl: true, shift: false, alt: true, label: '重命名会话' },
    ]

    function normalizeHotkey(value) {
      if (value === null || typeof value !== 'object') return { ...DEFAULT_HOTKEY }
      if (typeof value.code !== 'string' || value.code.length === 0) return { ...DEFAULT_HOTKEY }
      return {
        code: value.code,
        ctrl: value.ctrl === true,
        shift: value.shift === true,
        alt: value.alt === true,
        meta: value.meta === true,
      }
    }

    function loadHotkey() {
      try {
        const raw = window.localStorage.getItem(HOTKEY_STORE)
        if (raw === null) return { ...DEFAULT_HOTKEY }
        return normalizeHotkey(JSON.parse(raw))
      } catch {
        return { ...DEFAULT_HOTKEY }
      }
    }

    function persistHotkey(hotkey) {
      try {
        window.localStorage.setItem(HOTKEY_STORE, JSON.stringify(hotkey))
      } catch {
        /* 隐私模式写不进去就只在内存里生效 */
      }
    }

    /** 组合 → 展示用键帽。 */
    function hotkeyToKeys(hotkey) {
      const keys = []
      if (hotkey.ctrl) keys.push('Ctrl')
      if (hotkey.meta) keys.push('Cmd')
      if (hotkey.alt) keys.push('Alt')
      if (hotkey.shift) keys.push('Shift')
      keys.push(String(hotkey.code).replace(/^(Key|Digit)/, ''))
      return keys
    }

    /** 与内置组合比对，返回冲突的内置动作名。 */
    function conflictWithBuiltin(hotkey) {
      const hit = BUILTIN_COMBOS.find(
        (item) =>
          item.code === hotkey.code &&
          item.ctrl === hotkey.ctrl &&
          item.shift === hotkey.shift &&
          item.alt === hotkey.alt,
      )
      return hit?.label
    }

    /** 从一次 keydown 事件读组合；纯修饰键返回 null。 */
    function comboFromEvent(event) {
      const code = event.code
      if (typeof code !== 'string' || /^(Control|Shift|Alt|Meta)(Left|Right)?$/.test(code)) return null
      return {
        code,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey,
      }
    }

    function matchesHotkey(event, hotkey) {
      return (
        event.code === hotkey.code &&
        event.ctrlKey === hotkey.ctrl &&
        event.shiftKey === hotkey.shift &&
        event.altKey === hotkey.alt &&
        event.metaKey === hotkey.meta
      )
    }

    //#endregion

    function useStore() {
      const [, bump] = react.useReducer((x) => x + 1, 0)
      react.useEffect(() => store.subscribe(bump), [])
      return store.get()
    }

    /** 把命中词包成 <mark>，其余保持纯文本。 */
    function highlight(text, tokens) {
      if (!text) return text
      if (!tokens || tokens.length === 0) return text
      const escaped = tokens
        .filter(Boolean)
        .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .sort((a, b) => b.length - a.length)
      if (escaped.length === 0) return text
      const re = new RegExp(`(${escaped.join('|')})`, 'gi')
      const out = []
      let last = 0
      let index = 0
      for (const match of text.matchAll(re)) {
        const at = match.index ?? 0
        if (at > last) out.push(text.slice(last, at))
        out.push(h('mark', { key: `m${index++}` }, match[0]))
        last = at + match[0].length
      }
      if (last < text.length) out.push(text.slice(last))
      return out.length > 0 ? out : text
    }

    function tokensOf(query) {
      return String(query ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
    }

    function formatTime(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return ''
      return new Date(value).toLocaleString('zh-CN', { hour12: false })
    }

    /** 宿主注入的导航服务（uiWorkspace），用来跳到某个会话。 */
    let navigator = null

    let debounceTimer
    let inflight

    /**
     * 把响应状态翻译成能照着做的错误文案。
     * 404 说明宿主侧那两条路由没注册上（插件宿主半边没生效），
     * 只说「HTTP 404」没人能判断该干什么。
     */
    function toError(res) {
      if (res.status === 404) {
        return new Error('宿主路由未注册，插件未生效：请在 设置 → 插件 里重启本插件，或重启 DSH。')
      }
      return new Error(`HTTP ${res.status}`)
    }

    async function runQuery(query) {
      const trimmed = String(query ?? '').trim()
      if (trimmed.length === 0) {
        store.set({ status: 'idle', results: [], scanned: null, error: null, expanded: null, expandedTurns: null })
        return
      }
      store.set({ status: 'loading', error: null })
      if (inflight) inflight.abort()
      const controller = new AbortController()
      inflight = controller
      try {
        const params = new URLSearchParams({ q: trimmed, limit: '25', per_session: '3', scope: 'all' })
        const res = await fetch(`/session-search/query?${params}`, { signal: controller.signal })
        if (!res.ok) throw toError(res)
        const body = await res.json()
        if (controller.signal.aborted) return
        store.set({ status: 'done', results: body.results ?? [], scanned: body.scanned ?? null, error: null })
      } catch (error) {
        if (controller.signal.aborted) return
        store.set({ status: 'error', error: String(error?.message ?? error), results: [] })
      } finally {
        if (inflight === controller) inflight = undefined
      }
    }

    function scheduleQuery(query) {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => runQuery(query), 260)
    }

    /** 展开一个会话（导航不可用时的降级路径）。 */
    async function expandSession(item) {
      store.set({ expanded: item.sessionId, expandedLoading: true, expandedTurns: null })
      try {
        const params = new URLSearchParams({ session: item.sessionId, q: store.get().query, max_chars: '12000' })
        const res = await fetch(`/session-search/read?${params}`)
        if (!res.ok) throw toError(res)
        const body = await res.json()
        store.set({ expandedLoading: false, expandedTurns: body.turns ?? [] })
      } catch (error) {
        store.set({ expandedLoading: false, expandedTurns: [], error: String(error?.message ?? error) })
      }
    }

    function close() {
      clearTimeout(debounceTimer)
      if (inflight) inflight.abort()
      store.set({ open: false, expanded: null, expandedTurns: null, recording: false, recordWarning: null })
    }

    function open() {
      cancelLocate()
      store.set({ open: true })
    }

    /** 点击结果：优先跳转会话并定位命中，跳不动就地展开。 */
    function pickResult(item, snippetIndex = 0) {
      const snippet = item.snippets?.[snippetIndex] ?? item.snippets?.[0]
      const tokens = tokensOf(store.get().query)
      const nav = navigator
      if (nav !== null && typeof nav.openSession === 'function') {
        try {
          cancelLocate()
          const beforeFlow = document.querySelector('[data-chat-flow]')
          nav.openSession(item.sessionId)
          close()
          startLocate({ tokens, snippet, sessionId: item.sessionId, beforeFlow })
          return
        } catch (error) {
          console.warn(`[session-search] openSession failed: ${String(error?.message ?? error)}`)
        }
      }
      expandSession(item)
    }

    //#region 命中定位
    //
    // DSH 的 openSession 只接受会话目标，没有消息锚点；打开后聊天默认跟到末尾。
    // 这里在聊天挂载后按“轮次轨道 → 文本”定位，轨道不可用时自动上滚翻页。

    const HIGHLIGHT_NAME = 'dsh-session-search-hit'
    let locateToken = 0
    let locateTimers = []

    function sleep(ms) {
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        timer.unref?.()
        locateTimers.push(timer)
      })
    }

    function nextFrame() {
      return new Promise((resolve) => {
        if (typeof requestAnimationFrame !== 'function') {
          resolve()
          return
        }
        requestAnimationFrame(() => resolve())
      })
    }

    function clearLocateArtifacts() {
      for (const timer of locateTimers) clearTimeout(timer)
      locateTimers = []
      if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete(HIGHLIGHT_NAME)
      for (const element of document.querySelectorAll('.ssx-flash,.ssx-toast')) element.remove()
    }

    function cancelLocate() {
      locateToken += 1
      clearLocateArtifacts()
    }

    function normalizeText(value) {
      return String(value ?? '').replace(/^…|…$/g, '').replace(/\s+/g, ' ').trim()
    }

    function showToast(text) {
      const toast = document.createElement('div')
      toast.className = 'ssx-toast'
      toast.textContent = text
      document.body.appendChild(toast)
      setTimeout(() => toast.remove(), 4000).unref?.()
    }

    function scrollContainerOf(element) {
      let node = element
      while (node && node !== document.body && node !== document.documentElement) {
        const style = window.getComputedStyle(node)
        if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) return node
        node = node.parentElement
      }
      return document.scrollingElement ?? document.documentElement
    }

    /** 在已渲染的聊天里找包含全部关键词的节点，优先片段相似度最高的一处。 */
    function findHitElement(flow, target) {
      const tokens = target.tokens ?? []
      if (!flow || tokens.length === 0) return undefined
      const needle = normalizeText(target.snippet?.text ?? '').toLowerCase()
      let best
      for (const element of flow.querySelectorAll('[data-chat-node-key]')) {
        if (element.getClientRects().length === 0) continue
        const text = normalizeText(element.textContent ?? '').toLowerCase()
        if (text.length === 0 || !tokens.every((token) => text.includes(token))) continue
        let score = 0
        if (needle.length >= 20) {
          const step = Math.max(20, Math.floor(needle.length / 4))
          for (let index = 0; index + 20 <= needle.length; index += step) {
            if (text.includes(needle.slice(index, index + 20))) score += 1
          }
        }
        if (best === undefined || score > best.score || (score === best.score && text.length < best.length)) {
          best = { element, score, length: text.length }
        }
      }
      return best?.element
    }

    /** 在节点内定位关键词所在的文本节点，供 Scroll + Highlight 使用。 */
    function hitRange(element, tokens) {
      if (!element) return undefined
      const ordered = [...tokens].sort((left, right) => right.length - left.length)
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        const value = node.nodeValue ?? ''
        const parent = node.parentElement
        if (parent && parent.getClientRects().length === 0) {
          node = walker.nextNode()
          continue
        }
        const lower = value.toLowerCase()
        for (const token of ordered) {
          const start = lower.indexOf(token)
          if (start < 0) continue
          const range = document.createRange()
          range.setStart(node, start)
          range.setEnd(node, start + token.length)
          return range
        }
        node = walker.nextNode()
      }
      return undefined
    }

    function revealHit(element, tokens) {
      const scroller = scrollContainerOf(element)
      const range = hitRange(element, tokens)
      const rect = range ? range.getBoundingClientRect() : element.getBoundingClientRect()
      if (scroller === document.scrollingElement || scroller === document.documentElement) {
        window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight / 2 + rect.height / 2, behavior: 'auto' })
      } else {
        const box = scroller.getBoundingClientRect()
        scroller.scrollTop += rect.top - box.top - (box.height - rect.height) / 2
      }
      if (range && typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function') {
        CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range))
        const timer = setTimeout(() => {
          if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete(HIGHLIGHT_NAME)
        }, 3500)
        timer.unref?.()
        locateTimers.push(timer)
      } else if (range) {
        const flash = document.createElement('div')
        flash.className = 'ssx-flash'
        const box = range.getBoundingClientRect()
        flash.style.left = `${box.left - 2}px`
        flash.style.top = `${box.top - 2}px`
        flash.style.width = `${Math.max(8, box.width + 4)}px`
        flash.style.height = `${Math.max(8, box.height + 4)}px`
        document.body.appendChild(flash)
        const timer = setTimeout(() => {
          flash.style.opacity = '0'
          setTimeout(() => flash.remove(), 400).unref?.()
        }, 2200)
        timer.unref?.()
        locateTimers.push(timer)
      }
    }

    /** DSH 轮次轨道：未加载的轮次点击后会先按 seq 翻页再落位。 */
    function findRail() {
      let best
      for (const nav of document.querySelectorAll('nav')) {
        const marks = [...nav.querySelectorAll('button[data-index]')]
        if (marks.length < 2) continue
        const scroller = marks[0].parentElement?.parentElement
        if (!scroller || scroller.getClientRects().length === 0) continue
        if (best === undefined || marks.length > best.marks.length) best = { nav, marks, scroller }
      }
      return best
    }

    function markForTurn(rail, turn) {
      const pattern = new RegExp(`(^|\\D)${turn}(\\D|$)`)
      return rail.marks.find((mark) => pattern.test(mark.getAttribute('aria-label') ?? ''))
    }

    async function jumpByTurn(turn, target, token, deadline) {
      if (!Number.isInteger(turn) || turn <= 0) return false
      const rail = findRail()
      if (!rail) return false
      let mark = markForTurn(rail, turn)
      if (!mark) {
        // 轨道是虚拟列表：先把内部滚动条移到目标刻度附近再找。
        for (let attempt = 0; attempt < 3 && !mark && Date.now() < deadline; attempt += 1) {
          const top = Math.max(0, (turn - 1) * 10 - rail.scroller.clientHeight / 2)
          rail.scroller.scrollTop = top
          await nextFrame()
          await nextFrame()
          mark = markForTurn(rail, turn)
        }
      }
      if (!mark) return false
      mark.click()
      while (Date.now() < deadline) {
        if (token !== locateToken) return false
        if (findHitElement(document.querySelector('[data-chat-flow]'), target)) return true
        await sleep(120)
      }
      return false
    }

    async function waitForFlow(token, beforeFlow) {
      const startedAt = Date.now()
      while (Date.now() - startedAt < 3000) {
        if (token !== locateToken) return undefined
        const flow = document.querySelector('[data-chat-flow]')
        // 聊天视图可能被 React 复用：等它换实例，或给旧实例 500ms 让位。
        if (flow && (flow !== beforeFlow || Date.now() - startedAt > 500)) return flow
        await sleep(50)
      }
      return undefined
    }

    async function startLocate(target) {
      if (target.snippet?.role === 'title') return
      const token = locateToken
      const deadline = Date.now() + 5000
      const flow = await waitForFlow(token, target.beforeFlow)
      if (token !== locateToken) return
      if (!flow) {
        showToast('已打开会话，但聊天视图未就绪，请稍后再试')
        return
      }
      await sleep(150)
      let element = findHitElement(flow, target)
      if (element) {
        revealHit(element, target.tokens)
        return
      }

      // 命中在旧轮次：先让轨道翻页到该轮，再在落位后的窗口里找文本。
      const turn = Number(target.snippet?.turn ?? 0)
      if (await jumpByTurn(turn, target, token, deadline)) {
        element = findHitElement(document.querySelector('[data-chat-flow]'), target)
        if (element) {
          revealHit(element, target.tokens)
          return
        }
      }
      if (token !== locateToken) return

      // 轨道不可用：反复回到顶部触发历史加载，最多到 5 秒截止。
      const scroller = scrollContainerOf(flow)
      while (Date.now() < deadline) {
        if (token !== locateToken) return
        element = findHitElement(document.querySelector('[data-chat-flow]'), target)
        if (element) {
          revealHit(element, target.tokens)
          return
        }
        if (scroller === document.scrollingElement || scroller === document.documentElement) window.scrollTo({ top: 0 })
        else scroller.scrollTop = 0
        await sleep(400)
      }
      element = findHitElement(document.querySelector('[data-chat-flow]'), target)
      if (element) {
        revealHit(element, target.tokens)
        return
      }
      if (token === locateToken) showToast('已打开会话，但未定位到命中（可能在更早历史）')
    }
    //#endregion

    /** 侧边栏底部入口。 */
    function SidebarButton({ wide }) {
      return h(
        'button',
        {
          type: 'button',
          className: 'ssx-side',
          'data-compact': wide === false ? 'true' : undefined,
          title: '搜索历史会话',
          onClick: open,
        },
        h(
          'span',
          { className: 'ssx-sideIco' },
          h(
            'svg',
            { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' },
            h('circle', { cx: 11, cy: 11, r: 7 }),
            h('line', { x1: 16.5, y1: 16.5, x2: 21, y2: 21 }),
          ),
        ),
        wide === false ? null : h('span', { className: 'ssx-sideLabel' }, '搜索历史会话'),
      )
    }

    function Keycaps({ keys }) {
      return h('span', { className: 'ssx-keys' }, keys.map((key, index) => h('span', { className: 'ssx-kbd', key: `${key}-${index}` }, key)))
    }

    function formatBytes(value) {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB']
      let size = number
      let unit = 0
      while (size >= 1024 && unit < units.length - 1) {
        size /= 1024
        unit += 1
      }
      return `${size.toFixed(unit === 0 || size >= 10 ? 0 : 1)} ${units[unit]}`
    }

    /** 404 说明宿主半边还是旧代码：只刷新页面不会重新加载 host 插件。 */
    function describeCacheError(error) {
      const text = String(error?.message ?? error)
      if (text.includes('404')) return '宿主端未加载缓存接口：请完全退出 DSH 再打开（仅刷新页面不够）'
      return text
    }

    /**
     * 插件详情页的缓存管理：查看覆盖/体积、增量更新、整份重建、调整上限。
     * 数据走宿主 /session-search/cache* 路由，面板可见时每 3 秒刷新。
     */
    function CachePanel({ subject }) {
      const mine = subject?.kind === 'bundle' && subject.pkg?.name === PACKAGE_NAME
      const [stats, setStats] = react.useState(null)
      const [busy, setBusy] = react.useState('')
      const [error, setError] = react.useState(null)
      const [message, setMessage] = react.useState(null)
      const [limitMb, setLimitMb] = react.useState('')
      const [confirming, setConfirming] = react.useState(false)

      react.useEffect(() => {
        if (!mine) return undefined
        let alive = true
        const load = async () => {
          try {
            const res = await fetch('/session-search/cache')
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const body = await res.json()
            if (!alive) return
            setStats(body)
            setError(null)
            setLimitMb((current) => (current === '' ? String(Math.round((body.limitBytes ?? 0) / 1048576)) : current))
          } catch (loadError) {
            if (alive) setError(describeCacheError(loadError))
          }
        }
        load()
        const timer = setInterval(load, 5000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [mine])

      if (!mine) return null

      const refresh = async () => {
        const res = await fetch('/session-search/cache')
        if (res.ok) setStats(await res.json())
      }

      const run = async (label, path) => {
        setBusy(label)
        setError(null)
        setMessage(null)
        try {
          const res = await fetch(path, { method: 'POST' })
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`))
          if (label === 'rebuild') setMessage(`已清掉 ${body.removed ?? 0} 份缓存，后台预热中`)
          else if (label === 'incremental') setMessage(`已排入 ${body.queued ?? 0} 个会话`)
          else setMessage('缓存上限已保存')
          await refresh()
        } catch (runError) {
          setError(describeCacheError(runError))
        } finally {
          setBusy('')
        }
      }

      const rebuild = () => {
        if (!confirming) {
          setConfirming(true)
          setMessage('再点一次确认重建；重建期间查询会退回整文件扫描')
          const timer = setTimeout(() => setConfirming(false), 5000)
          timer.unref?.()
          return
        }
        setConfirming(false)
        run('rebuild', '/session-search/cache/rebuild')
      }

      const saveLimit = () => {
        const mb = Number(limitMb)
        if (!Number.isFinite(mb) || mb < 20) {
          setError('上限至少 20 MB')
          return
        }
        run('limit', `/session-search/cache/limit?mb=${encodeURIComponent(String(Math.round(mb)))}`)
      }

      const pending = stats ? (stats.stale ?? 0) + (stats.missing ?? 0) : 0
      return h(
        'section',
        { className: 'ssx-cache', 'aria-label': '搜索缓存' },
        h(
          'div',
          { className: 'ssx-cacheHead' },
          h('span', { className: 'ssx-cacheTitle' }, '搜索缓存'),
          stats
            ? h('span', { className: 'ssx-cacheState' }, `已缓存 ${stats.ready}/${stats.total} 个会话`)
            : h('span', { className: 'ssx-cacheState' }, '读取中…'),
          stats ? h('span', { className: 'ssx-cacheMeta' }, `${formatBytes(stats.bytes)} / ${formatBytes(stats.limitBytes)}`) : null,
        ),
        stats
          ? h(
              'div',
              { className: 'ssx-cacheMeta' },
              `待补 ${pending} 个 · 后台队列 ${stats.queued ?? 0}${stats.maintenanceBusy ? ' · 构建中' : ''}${stats.rebuilding ? ' · 重建中' : ''}`,
            )
          : null,
        h(
          'div',
          { className: 'ssx-cacheRow' },
          h(
            'button',
            { type: 'button', className: 'ssx-cacheBtn', disabled: busy !== '', onClick: () => run('incremental', '/session-search/cache/incremental') },
            busy === 'incremental' ? '排队中…' : '增量更新',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'ssx-cacheBtn',
              'data-danger': confirming ? 'true' : 'false',
              disabled: busy !== '',
              onClick: rebuild,
            },
            busy === 'rebuild' ? '重建中…' : confirming ? '确认重建？' : '重建缓存',
          ),
          h('span', { className: 'ssx-cacheHint' }, '重建会清空缓存再后台预热，期间搜索仍可用'),
        ),
        h(
          'div',
          { className: 'ssx-cacheRow' },
          h('span', { className: 'ssx-cacheHint' }, '缓存上限'),
          h('input', {
            className: 'ssx-cacheInput',
            type: 'number',
            min: 20,
            step: 10,
            value: limitMb,
            'aria-label': '缓存上限（MB）',
            onChange: (event) => setLimitMb(event.target.value),
          }),
          h('span', { className: 'ssx-cacheHint' }, 'MB'),
          h('button', { type: 'button', className: 'ssx-cacheBtn', disabled: busy !== '', onClick: saveLimit }, busy === 'limit' ? '保存中…' : '保存'),
          h('span', { className: 'ssx-cacheHint' }, '超过上限时按最旧缓存清理'),
        ),
        message ? h('div', { className: 'ssx-cacheOk' }, message) : null,
        error ? h('div', { className: 'ssx-cacheError' }, `缓存操作失败：${error}`) : null,
      )
    }

    function ResultItem({ item, tokens, active, onPick }) {
      return h(
        'button',
        { type: 'button', className: 'ssx-item', 'data-active': active ? 'true' : 'false', onClick: () => onPick(item, 0) },
        h(
          'div',
          { className: 'ssx-title' },
          h('span', null, item.title ?? '(无标题)'),
          item.titleHits > 0 ? h('span', { className: 'ssx-badge' }, '标题命中') : null,
        ),
        h('div', { className: 'ssx-sub' }, `${formatTime(item.updatedAt)}　命中 ${item.hits} 次${item.cwd ? `　${item.cwd}` : ''}`),
        item.snippets.slice(0, 3).map((snippet, index) =>
          h(
            'div',
            {
              className: 'ssx-snippet',
              key: `${item.sessionId}-${index}`,
              'data-jump': 'true',
              title: '点击跳到这句',
              onClick: (event) => {
                event.stopPropagation()
                onPick(item, index)
              },
            },
            highlight(snippet.text, tokens),
          ),
        ),
      )
    }

    function SearchOverlay() {
      const state = useStore()
      const inputRef = react.useRef(null)

      react.useEffect(() => {
        if (!state.open) return undefined
        const timer = setTimeout(() => inputRef.current?.focus(), 30)
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            close()
          }
        }
        window.addEventListener('keydown', onKey, true)
        return () => {
          clearTimeout(timer)
          window.removeEventListener('keydown', onKey, true)
        }
      }, [state.open])

      if (!state.open) return null

      const tokens = tokensOf(state.query)
      const scanned = state.scanned

      return h(
        'div',
        { className: 'ssx-backdrop', onMouseDown: (event) => event.target === event.currentTarget && close() },
        h(
          'div',
          { className: 'ssx-panel', role: 'dialog', 'aria-label': '搜索历史会话' },
          h(
            'div',
            { className: 'ssx-head' },
            h('input', {
              ref: inputRef,
              className: 'ssx-input',
              placeholder: '搜索标题或会话正文，多个关键词用空格分隔',
              value: state.query,
              onChange: (event) => {
                const value = event.target.value
                store.set({ query: value })
                scheduleQuery(value)
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  clearTimeout(debounceTimer)
                  runQuery(event.currentTarget.value)
                }
                if (event.key === 'Escape') close()
              },
            }),
          ),
          scanned ? h('div', { className: 'ssx-meta' }, `扫描 ${scanned.sessions} 个会话，命中 ${scanned.matched} 个，用时 ${scanned.milliseconds}ms`) : null,
          h(
            'div',
            { className: 'ssx-list' },
            state.status === 'loading' ? h('div', { className: 'ssx-empty' }, '正在搜索…') : null,
            state.status === 'error' ? h('div', { className: 'ssx-empty' }, `搜索失败：${state.error}`) : null,
            state.status === 'idle' ? h('div', { className: 'ssx-empty' }, '输入关键词开始搜索') : null,
            state.status === 'done' && state.results.length === 0 ? h('div', { className: 'ssx-empty' }, '没有命中，换个词试试') : null,
            state.results.map((item) =>
              h(ResultItem, { key: item.sessionId, item, tokens, active: state.expanded === item.sessionId, onPick: pickResult }),
            ),
            state.expanded
              ? h(
                  'div',
                  { className: 'ssx-snippet', style: { padding: '4px 12px 12px' } },
                  state.expandedLoading
                    ? '正在读取会话…'
                    : state.expandedTurns && state.expandedTurns.length > 0
                      ? state.expandedTurns.map((turn, index) =>
                          h('div', { key: `t${index}`, style: { marginBottom: 8 } }, highlight(turn.text, tokens)),
                        )
                      : '这个会话里没有可显示的文本',
                )
              : null,
          ),
          h(
            'div',
            { className: 'ssx-foot' },
            h('span', null, h('span', { className: 'ssx-kbd' }, 'Esc'), ' 关闭'),
            h('span', null, h('span', { className: 'ssx-kbd' }, 'Enter'), ' 立即搜索'),
            h('span', null, '点击片段跳到命中位置'),
            h('span', { className: 'ssx-footKeys' }, '当前快捷键 ', h(Keycaps, { keys: hotkeyToKeys(state.hotkey) })),
          ),
        ),
      )
    }

    /**
     * 插件详情页里的快捷键行：显示当前键，点「修改」进入录制。
     * 录制时监听 window keydown，取到合法组合就保存并退出。
     */
    function PluginDetailActions() {
      const state = useStore()
      const recording = state.recording

      react.useEffect(() => {
        if (!recording) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            store.set({ recording: false, recordWarning: null })
            return
          }
          const combo = comboFromEvent(event)
          if (combo === null) return
          event.preventDefault()
          event.stopPropagation()
          const builtin = conflictWithBuiltin(combo)
          persistHotkey(combo)
          store.set({ hotkey: combo, recording: false, recordWarning: builtin ? `与内置「${builtin}」冲突，可能有一方不生效` : null })
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [recording])

      return h(
        'div',
        { className: 'ssx-detail' },
        h('span', { className: 'ssx-detailLabel' }, '搜索历史会话快捷键'),
        h(Keycaps, { keys: hotkeyToKeys(state.hotkey) }),
        h(
          'button',
          {
            type: 'button',
            className: 'ssx-detailBtn',
            'data-recording': recording ? 'true' : 'false',
            onClick: () => store.set({ recording: !recording, recordWarning: null }),
          },
          recording ? '按下新组合…（Esc 取消）' : '修改',
        ),
        state.recordWarning ? h('span', { className: 'ssx-warn' }, state.recordWarning) : null,
      )
    }

    const inject = ['slots']

    function safe(ctx, label, fn) {
      return ctx.effect(() => {
        try {
          return fn()
        } catch (error) {
          ctx.logger?.warn?.(`[session-search] ${label} failed: ${String(error?.message ?? error)}`)
          return undefined
        }
      }, `session-search: ${label}`)
    }

    /** window 级热键：不依赖 DSH 的 shortcuts 服务。 */
    function installHotkey(logger) {
      if (typeof window === 'undefined') return
      window.addEventListener(
        'keydown',
        (event) => {
          if (event.defaultPrevented) return
          if (store.get().open || store.get().recording) return
          if (!matchesHotkey(event, store.get().hotkey)) return
          event.preventDefault()
          open()
        },
        true,
      )
      logger?.warn?.('[session-search] hotkey listener installed')
    }

    /**
     * 顺带注册进 DSH 的快捷键目录（能在 DSH 设置页看到、可改）。
     * 注册失败不影响上面的 window 监听——那条路是主路。
     */
    function registerShortcut(shortcuts, logger) {
      const hotkey = store.get().hotkey
      const binding = { code: hotkey.code, modifiers: ['control', 'shift'] }
      try {
        const dispose = shortcuts.register({
          id: 'session-search.open',
          label: () => '搜索历史会话',
          defaults: {
            'web:windows': binding,
            'web:macos': { code: hotkey.code, modifiers: ['meta', 'shift'] },
            'desktop:windows': binding,
            'desktop:macos': { code: hotkey.code, modifiers: ['meta', 'shift'] },
          },
          regions: ['page', 'editable'],
          modals: [],
          resolve: () => ({ status: 'handled', run: open }),
        })
        logger?.warn?.('[session-search] registered in DSH shortcut catalog')
        return dispose
      } catch (error) {
        logger?.warn?.(`[session-search] catalog registration skipped: ${String(error?.message ?? error)}`)
        return undefined
      }
    }

    function apply(ctx) {
      store.set({ hotkey: loadHotkey() })

      safe(ctx, 'sidebar entry', () =>
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register({ name: 'sidebar.footer.action', id: NAME, order: 20, label: () => '搜索历史会话' }, SidebarButton),
        ),
      )

      safe(ctx, 'overlay', () =>
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: `${NAME}-overlay`, label: () => '搜索历史会话' }, SearchOverlay),
        ),
      )

      safe(ctx, 'plugin detail actions', () =>
        ctx.slots.inject('plugins.detail.actions', () =>
          ctx.slots.register({
            name: 'plugins.detail.actions',
            id: `${NAME}/shortcut-row`,
            label: () => '搜索历史会话快捷键',
          }, PluginDetailActions),
        ),
      )

      safe(ctx, 'plugin detail cache', () =>
        ctx.slots.inject('plugins.detail.section', () =>
          ctx.slots.register({
            name: 'plugins.detail.section',
            id: `${NAME}/cache`,
            order: 10,
            label: () => '搜索缓存',
          }, CachePanel),
        ),
      )

      installHotkey(ctx.logger)
      ctx.inject(['shortcuts'], (scoped) => {
        safe(scoped, 'shortcut catalog', () => registerShortcut(scoped.shortcuts, ctx.logger))
      })
      ctx.inject(['uiWorkspace'], (scoped) => {
        navigator = scoped.uiWorkspace
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
