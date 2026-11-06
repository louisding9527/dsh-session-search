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
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
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
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
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
      store.set({ open: true })
    }

    /** 点击结果：优先跳转会话，跳不动就地展开。 */
    function pickResult(item) {
      const nav = navigator
      if (nav !== null && typeof nav.openSession === 'function') {
        try {
          nav.openSession(item.sessionId)
          close()
          return
        } catch (error) {
          console.warn(`[session-search] openSession failed: ${String(error?.message ?? error)}`)
        }
      }
      expandSession(item)
    }

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

    function ResultItem({ item, tokens, active, onPick }) {
      return h(
        'button',
        { type: 'button', className: 'ssx-item', 'data-active': active ? 'true' : 'false', onClick: () => onPick(item) },
        h(
          'div',
          { className: 'ssx-title' },
          h('span', null, item.title ?? '(无标题)'),
          item.titleHits > 0 ? h('span', { className: 'ssx-badge' }, '标题命中') : null,
        ),
        h('div', { className: 'ssx-sub' }, `${formatTime(item.updatedAt)}　命中 ${item.hits} 次${item.cwd ? `　${item.cwd}` : ''}`),
        item.snippets.slice(0, 3).map((snippet, index) =>
          h('div', { className: 'ssx-snippet', key: `${item.sessionId}-${index}` }, highlight(snippet.text, tokens)),
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
            h('span', null, '点击结果跳转到该会话'),
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
