/**
 * 客户端插件：侧边栏入口 + 搜索弹窗 + 快捷键。
 *
 * 打包形态与其它 dsh web 插件一致：交给宿主的模块加载器，react 从宿主模块表里取。
 * 弹窗挂在 shell.overlay，入口挂在 sidebar.panellist；数据走宿主侧的同源路由
 * /session-search/query 与 /session-search/read。
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
    const css = `
.ssx-backdrop{position:fixed;inset:0;z-index:90;background:rgba(12,14,18,.32);display:flex;align-items:flex-start;justify-content:center;padding:10vh 16px 16px}
.ssx-panel{width:min(760px,94vw);max-height:74vh;display:flex;flex-direction:column;overflow:hidden;border-radius:14px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary,#111);border:1px solid var(--dsw-alias-border-tertiary,#e6e6e6);box-shadow:0 18px 48px rgba(0,0,0,.28)}
.ssx-head{display:flex;align-items:center;gap:10px;padding:14px 18px 6px}
.ssx-input{flex:1 1 auto;min-width:0;border:0;outline:0;background:transparent;color:inherit;font-size:15px;line-height:22px;font-family:inherit}
.ssx-input::placeholder{color:var(--dsw-alias-label-tertiary,#9a9a9a)}
.ssx-meta{padding:0 18px 10px;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ssx-list{flex:1 1 auto;overflow:auto;padding:0 8px 8px}
.ssx-item{display:block;width:100%;text-align:left;padding:10px 12px;border:0;border-radius:10px;background:transparent;color:inherit;font-family:inherit;cursor:pointer}
.ssx-item:hover,.ssx-item[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.ssx-title{font-size:13px;font-weight:600;line-height:20px;display:flex;gap:8px;align-items:baseline}
.ssx-badge{font-size:10px;font-weight:500;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-state-warn-secondary,#ffe9b0);color:var(--dsw-alias-label-secondary,#5c4a00)}
.ssx-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8a8a);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ssx-snippet{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#555);margin-top:6px;white-space:pre-wrap;word-break:break-word}
.ssx-snippet mark{background:var(--dsw-alias-state-warn-secondary,#ffe08a);color:inherit;border-radius:2px;padding:0 1px}
.ssx-empty{padding:28px 18px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ssx-foot{display:flex;gap:14px;align-items:center;padding:8px 16px;border-top:1px solid var(--dsw-alias-border-tertiary,#eee);font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ssx-kbd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;padding:1px 5px;border-radius:4px;border:1px solid var(--dsw-alias-border-tertiary,#ddd)}
.ssx-entry{display:inline-flex;align-items:center;gap:6px}
`
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = NAME
      tag.dataset.pluginCss = CSS_ID
      tag.textContent = css
      document.head.appendChild(tag)
    }

    /** 极简订阅 store：弹窗开关与查询状态都放这里，两个 slot 共享。 */
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
    })

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

    let debounceTimer
    let inflight

    /** 发一次检索；旧请求用 AbortController 取消，避免慢响应覆盖新结果。 */
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

    /** 展开一个会话：拉该会话里命中关键词的轮次。 */
    async function openSession(item) {
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
      store.set({ open: false, expanded: null, expandedTurns: null })
    }

    function open() {
      store.set({ open: true })
    }

    /** 侧边栏入口：放大镜图标 + 文案。 */
    function SidebarEntry() {
      return h(
        'span',
        { className: 'ssx-entry', title: '搜索历史会话' },
        h(
          'svg',
          { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' },
          h('circle', { cx: 11, cy: 11, r: 7 }),
          h('line', { x1: 16.5, y1: 16.5, x2: 21, y2: 21 }),
        ),
      )
    }

    /** 搜索结果条目。 */
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

    /** 搜索弹窗本体。 */
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
              h(ResultItem, {
                key: item.sessionId,
                item,
                tokens,
                active: state.expanded === item.sessionId,
                onPick: openSession,
              }),
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
            h('span', null, '点击结果展开命中轮次'),
          ),
        ),
      )
    }

    const inject = ['slots']

    /** 单个 slot 注册失败只报警，不让整个客户端插件挂掉。 */
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

    /** 尝试注册快捷键；冲突或被平台拒绝时逐个回退，绝不打断插件加载。 */
    function registerShortcut(shortcuts, logger) {
      const candidates = [
        { code: 'KeyF', modifiers: ['control', 'shift'], mac: ['meta', 'shift'] },
        { code: 'KeyK', modifiers: ['control', 'shift'], mac: ['meta', 'shift'] },
        { code: 'KeyF', modifiers: ['control', 'alt'], mac: ['meta', 'alt'] },
      ]
      const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform ?? '')
      for (const candidate of candidates) {
        const modifiers = isMac ? candidate.mac : candidate.modifiers
        try {
          const probe = shortcuts.describeBinding?.({ code: candidate.code, modifiers })
          if (probe !== undefined && (probe.binding === null || probe.issue !== null || (probe.conflicts ?? []).length > 0)) {
            continue
          }
          return shortcuts.register({
            id: 'session-search.open',
            label: () => '搜索历史会话',
            defaults: {
              'web:windows': { code: candidate.code, modifiers: candidate.modifiers },
              'web:macos': { code: candidate.code, modifiers: candidate.mac },
              'desktop:windows': { code: candidate.code, modifiers: candidate.modifiers },
              'desktop:macos': { code: candidate.code, modifiers: candidate.mac },
            },
            regions: ['page', 'editable'],
            modals: [],
            aliases: [],
            resolve: () => ({ status: 'handled', run: open }),
          })
        } catch (error) {
          logger?.warn?.(`[session-search] shortcut ${candidate.code} rejected: ${String(error?.message ?? error)}`)
        }
      }
      logger?.warn?.('[session-search] no free shortcut candidate; sidebar entry still works')
      return undefined
    }

    function apply(ctx) {
      safe(ctx, 'sidebar entry', () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: NAME,
        order: 30,
        label: () => '搜索历史会话',
      }, SidebarEntry)))

      safe(ctx, 'overlay', () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: `${NAME}-overlay`,
        label: () => '搜索历史会话',
      }, SearchOverlay)))

      // shortcuts 是可选服务：没有它时按钮照常可用，只是没有键盘入口。
      ctx.inject(['shortcuts'], (scoped) => {
        safe(scoped, 'shortcut', () => registerShortcut(scoped.shortcuts, ctx.logger))
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
