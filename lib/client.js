/**
 * 客户端插件：侧边栏入口 + 搜索弹窗 + 快捷键。
 *
 * 打包形态与其它 dsh web 插件一致：交给宿主的模块加载器，react 从宿主模块表里取。
 * 弹窗挂在 shell.overlay，入口挂在 sidebar.footer.action；数据走宿主侧的同源路由
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
.ssx-detail{display:flex;align-items:center;gap:10px;padding:12px 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#aaa);font-family:var(--dsw-font-family,inherit)}
.ssx-detailLabel{color:var(--dsw-alias-label-primary,#eee)}
.ssx-detailBtn{border:.5px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-primary,#eee);font-family:inherit;font-size:12px;line-height:18px;padding:3px 10px;border-radius:var(--dsw-radius-sm,8px);cursor:pointer}
.ssx-detailBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}
.ssx-entry{display:inline-flex;align-items:center;gap:6px}
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

    /** 宿主注入的导航服务（uiWorkspace），用来跳到某个会话。 */
    let navigator = null
    /** 快捷键服务与布局服务，用来展示/跳转当前绑定。 */
    let shortcutsService = null
    let layoutService = null

    /** 没有快捷键服务或尚未注册时的展示值。 */
    const FALLBACK_KEYS = ['Ctrl', 'Shift', 'K']

    /**
     * 读当前绑定的键帽。
     * @returns {string[]}
     */
    function readShortcutKeys() {
      try {
        const rows = shortcutsService?.catalog?.getSnapshot?.() ?? []
        const row = rows.find((entry) => entry.id === 'session-search.open')
        if (row !== undefined && Array.isArray(row.keys) && row.keys.length > 0) return row.keys
      } catch {
        /* 目录读不到就用兜底 */
      }
      return FALLBACK_KEYS
    }

    /** 订阅快捷键目录，绑定被用户改动后界面跟着变。 */
    function useShortcutKeys() {
      const [keys, setKeys] = react.useState(readShortcutKeys)
      react.useEffect(() => {
        const catalog = shortcutsService?.catalog
        if (catalog === undefined) {
          setKeys(readShortcutKeys())
          return undefined
        }
        setKeys(readShortcutKeys())
        return catalog.subscribe(() => setKeys(readShortcutKeys()))
      }, [])
      return keys
    }

    /** 把键帽数组渲染成一排小方块。 */
    function Keycaps({ keys }) {
      return h(
        'span',
        { className: 'ssx-keys' },
        keys.map((key, index) => h('span', { className: 'ssx-kbd', key: `${key}-${index}` }, key)),
      )
    }

    /** 跳到设置页的快捷键区；布局服务不可用时把路径打出来。 */
    function gotoShortcutSettings() {
      try {
        layoutService?.selectPanel?.('settings')
        return
      } catch (error) {
        console.warn(`[session-search] selectPanel(settings) failed: ${String(error?.message ?? error)}`)
      }
      if (typeof window !== 'undefined') {
        window.alert('打开「设置 → 快捷键」，找到「搜索历史会话」即可改键。')
      }
    }

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

    /** 展开一个会话：拉该会话里命中关键词的轮次（导航不可用时的降级路径）。 */
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
      store.set({ open: false, expanded: null, expandedTurns: null })
    }

    /**
     * 点击结果：优先跳转到那个会话，跳不动才就地展开命中轮次。
     * @param {{ sessionId: string }} item
     */
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

    function open() {
      store.set({ open: true })
    }

    /** 侧边栏底部入口：放大镜图标 + 文案，点击直接开弹窗。 */
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
      const shortcutKeys = useShortcutKeys()
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
                onPick: pickResult,
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
            h('span', null, '点击结果跳转到该会话'),
            h(
              'span',
              { className: 'ssx-footKeys' },
              '当前快捷键 ',
              h(Keycaps, { keys: shortcutKeys }),
            ),
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

    /**
     * 尝试注册快捷键；冲突或被平台拒绝时逐个回退，绝不打断插件加载。
     *
     * 首选故意不是 Ctrl+Shift+F：Windows 上微软拼音默认拿它切简繁，浏览器根本收不到，
     * 而 describeBinding 只看 DSH 自己的目录，发现不了输入法占用。Ctrl+Shift+K 在
     * 输入法和 Chromium 里都没有默认含义，留下 Ctrl+Alt+F 作为最后兜底。
     */
    function registerShortcut(shortcuts, logger) {
      const candidates = [
        { code: 'KeyK', modifiers: ['control', 'shift'], mac: ['meta', 'shift'] },
        { code: 'KeyL', modifiers: ['control', 'shift'], mac: ['meta', 'shift'] },
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
          console.warn(`[session-search] shortcut ${candidate.code} rejected: ${String(error?.message ?? error)}`)
        }
      }
      console.warn('[session-search] no free shortcut candidate; sidebar entry still works')
      return undefined
    }

    /**
     * 兜底热键：不依赖 shortcuts 服务，直接监听 window。
     * 走 capture 阶段；若 DSH 自己的快捷键已经处理过（defaultPrevented），这里不再重复。
     */
    function installFallbackHotkey(logger) {
      if (typeof window === 'undefined') return
      window.addEventListener('keydown', (event) => {
        if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return
        if (event.code !== 'KeyK') return
        if (event.defaultPrevented) return
        if (store.get().open) return
        event.preventDefault()
        open()
      }, true)
    }

    /** 插件详情页（设置 → 插件 → dsh-session-search）里的快捷键行。 */
    function PluginDetailActions() {
      const keys = useShortcutKeys()
      return h(
        'div',
        { className: 'ssx-detail' },
        h('span', { className: 'ssx-detailLabel' }, '搜索历史会话快捷键'),
        h(Keycaps, { keys }),
        h('button', { type: 'button', className: 'ssx-detailBtn', onClick: gotoShortcutSettings }, '修改'),
      )
    }

    function apply(ctx) {
      safe(ctx, 'sidebar entry', () => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: NAME,
        order: 20,
        label: () => '搜索历史会话',
      }, SidebarButton)))

      safe(ctx, 'overlay', () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: `${NAME}-overlay`,
        label: () => '搜索历史会话',
      }, SearchOverlay)))

      safe(ctx, 'plugin detail actions', () => ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
        name: 'plugins.detail.actions',
        id: `${NAME}/shortcut-row`,
        label: () => '搜索历史会话快捷键',
      }, PluginDetailActions)))

      // shortcuts 是可选服务：没有它时按钮照常可用，只是没有键盘入口。
      installFallbackHotkey(ctx.logger)
      ctx.inject(['shortcuts'], (scoped) => {
        shortcutsService = scoped.shortcuts
        safe(scoped, 'shortcut', () => registerShortcut(scoped.shortcuts, ctx.logger))
      })

      // 布局服务用来从插件详情页跳到设置页。
      ctx.inject(['layout'], (scoped) => {
        layoutService = scoped.layout
      })

      // 导航服务同样是可选的：拿不到就退化成弹窗内展开。
      ctx.inject(['uiWorkspace'], (scoped) => {
        navigator = scoped.uiWorkspace
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
