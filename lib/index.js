/**
 * dsh-session-search —— 在 DSH 自己的会话日志里按关键字检索历史对话。
 *
 * 只做一件事：把 ~/.dsh/sessions 下的 *.jsonl.zstd 解开，逐条事件匹配关键字，
 * 返回命中的会话、时间和上下文片段。检索在 worker 线程里跑，不阻塞 host。
 *
 * @module dsh-session-search
 */
import {
  endOfDay,
  listSessionFiles,
  readSessionFile,
  resolveSession,
  searchSessionFile,
  sessionsRoot,
  startOfDay,
} from './sessions.js'
import { searchAcrossFiles } from './pool.js'

export const name = 'session-search'
export const inject = ['tools']

/** 单次检索的文件上限，防止一次扫爆整个历史目录。 */
const MAX_FILES = 4000

const PARAMETERS_SEARCH = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: {
      type: 'string',
      description: '关键字。多个词用空格分隔，全部出现才算命中（AND），大小写不敏感。',
    },
    scope: {
      type: 'string',
      enum: ['auto', 'project', 'all'],
      description:
        'auto（默认）= 能确定当前工作目录就只搜该项目，否则搜全部；project = 只搜当前项目；all = 搜全部历史会话。',
    },
    cwd: { type: 'string', description: '项目路径，覆盖自动推断的当前工作目录。' },
    since: { type: 'string', description: '起始日期，YYYY-MM-DD（含当天）。' },
    until: { type: 'string', description: '结束日期，YYYY-MM-DD（含当天）。' },
    include: {
      type: 'string',
      enum: ['messages', 'all'],
      description:
        'messages（默认）= 只搜用户输入、助手正文、压缩摘要和标题；all = 再加思考过程、工具调用参数、工具结果与系统提示。',
    },
    limit: { type: 'integer', description: '最多返回多少个会话，默认 10，上限 50。' },
    per_session: { type: 'integer', description: '每个会话最多返回几条命中片段，默认 2，上限 5。' },
    include_subagents: {
      type: 'boolean',
      description: '是否把子代理会话也算进来，默认 false：子代理的输入多是父会话的复述，容易刷屏。',
    },
  },
  required: ['query'],
}

const OUTPUT_SEARCH = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string' },
    scanned: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessions: { type: 'integer' },
        matched: { type: 'integer' },
        milliseconds: { type: 'integer' },
      },
      required: ['sessions', 'matched', 'milliseconds'],
    },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string' },
          title: { type: 'string' },
          cwd: { type: 'string' },
          updatedAt: { type: 'string' },
          hits: { type: 'integer' },
          snippets: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                role: { type: 'string' },
                time: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['role', 'text'],
            },
          },
        },
        required: ['sessionId', 'hits', 'snippets'],
      },
    },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' }, message: { type: 'string' } },
        required: ['path', 'message'],
      },
    },
  },
  required: ['query', 'scanned', 'results', 'errors'],
}

const PARAMETERS_READ = {
  type: 'object',
  additionalProperties: false,
  properties: {
    session_id: { type: 'string', description: '会话 id（完整或前缀均可，取自 session_search 的结果）。' },
    cwd: { type: 'string', description: '项目路径，用于更快定位会话目录。' },
    query: { type: 'string', description: '只导出包含这些词的轮次；留空则导出全部。' },
    include: {
      type: 'string',
      enum: ['messages', 'all'],
      description: 'messages（默认）只含对话文本；all 连工具调用与结果一起导出。',
    },
    max_chars: { type: 'integer', description: '导出文本的字符上限，默认 40000。' },
  },
  required: ['session_id'],
}

const OUTPUT_READ = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string' },
    title: { type: 'string' },
    cwd: { type: 'string' },
    createdAt: { type: 'string' },
    truncated: { type: 'boolean' },
    transcript: { type: 'string' },
  },
  required: ['sessionId', 'truncated', 'transcript'],
}

/**
 * 把毫秒时间戳格式化成可读本地时间。
 * @param {number|undefined} value
 */
function formatTime(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

/**
 * 软性推断当前会话的工作目录；推断不出就不做项目过滤。
 * @param {any} exec
 */
function guessCwd(exec) {
  try {
    const candidates = [
      exec?.agent?.session?.header?.cwd,
      exec?.agent?.session?.cwd,
      exec?.agent?.cwd,
      exec?.session?.cwd,
      exec?.cwd,
    ]
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  } catch {
    /* 探测失败即视为未知 */
  }
  return undefined
}

/**
 * 渲染检索结果给人看。
 * @param {any} value
 */
function renderSearch(value) {
  const lines = [
    `关键字「${value.query}」命中 ${value.results.length} 个会话（扫描 ${value.scanned.sessions} 个，${value.scanned.milliseconds}ms）。`,
  ]
  if (value.results.length === 0) lines.push('没有命中。试试 scope=all，或换更短的词。')
  for (const [index, item] of value.results.entries()) {
    lines.push(
      '',
      `${index + 1}. ${item.title ?? '(无标题)'}｜${item.updatedAt ?? '时间未知'}｜命中 ${item.hits} 次`,
      `   id: ${item.sessionId}${item.cwd ? `　cwd: ${item.cwd}` : ''}`,
    )
    for (const snippet of item.snippets) {
      lines.push(`   [${snippet.role}${snippet.time ? ` ${snippet.time}` : ''}] ${snippet.text}`)
    }
  }
  if (value.errors.length > 0) {
    lines.push('', `读取失败 ${value.errors.length} 个文件（首个：${value.errors[0].path}）。`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * 渲染会话导出。
 * @param {any} value
 */
function renderRead(value) {
  const head = `会话 ${value.sessionId}${value.title ? `｜${value.title}` : ''}${value.createdAt ? `｜创建 ${value.createdAt}` : ''}`
  const tail = value.truncated ? '\n\n[已截断：达到 max_chars，可加 query 过滤或提高上限]' : ''
  return [{ type: 'text', text: `${head}\n\n${value.transcript}${tail}` }]
}

/**
 * 注册两个工具。
 * @param {any} ctx
 * @param {{ maxFiles?: number, defaultLimit?: number }} [config]
 */
export async function apply(ctx, config = {}) {
  const maxFiles = Number(config?.maxFiles) > 0 ? Number(config.maxFiles) : MAX_FILES
  const defaultLimit = Number(config?.defaultLimit) > 0 ? Number(config.defaultLimit) : 10

  ctx.tools.register({
    name: 'session_search',
    description:
      '在本地 DSH 历史会话里按关键字检索过往对话，返回命中的会话、时间和上下文片段。' +
      '用于回答「上次怎么解决的」「之前讨论过吗」「哪个会话里提过 X」这类需要翻旧账的问题。' +
      '检索的是 DSH 自己的会话日志（~/.dsh/sessions），不是代码仓库。',
    parameters: PARAMETERS_SEARCH,
    output: { schema: OUTPUT_SEARCH, render: (_args, value) => renderSearch(value) },
    async execute(args, exec) {
      const query = String(args.query ?? '').trim()
      if (!query) throw new Error('query 不能为空')
      const cwd = String(args.cwd ?? '').trim() || guessCwd(exec)
      const scope = args.scope ?? 'auto'
      const useProject = scope === 'project' || (scope === 'auto' && Boolean(cwd))
      const limit = Math.max(1, Math.min(50, args.limit ?? defaultLimit))
      const perSession = Math.max(1, Math.min(5, args.per_session ?? 2))
      const sinceMs = args.since ? startOfDay(args.since) : undefined
      const untilMs = args.until ? endOfDay(args.until) : undefined
      const startedAt = Date.now()

      let files = listSessionFiles(useProject && cwd ? { cwd } : {})
      if (!useProject || files.length === 0) files = listSessionFiles({})
      if (files.length > maxFiles) {
        files = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxFiles)
      }

      const { results, errors } = await searchAcrossFiles(
        files,
        query,
        {
          cwd: useProject ? cwd : undefined,
          sinceMs,
          untilMs,
          include: args.include ?? 'messages',
          perSession,
          includeSubagents: args.include_subagents === true,
        },
        { signal: exec.signal, limit },
      )

      const ranked = results
        .sort((a, b) => b.hits - a.hits || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, limit)
        .map((item) => ({
          sessionId: item.sessionId,
          title: item.title,
          cwd: item.cwd,
          updatedAt: formatTime(item.updatedAt),
          hits: item.hits,
          snippets: item.snippets.map((s) => ({ role: s.role, time: formatTime(s.time), text: s.text })),
        }))

      return {
        query,
        scanned: { sessions: files.length, matched: results.length, milliseconds: Date.now() - startedAt },
        results: ranked,
        errors: errors.slice(0, 5),
      }
    },
    presentCall: (args) => ({ card: 'generic', title: '检索历史会话', kind: 'other', rawInput: args.query }),
  })

  ctx.tools.register({
    name: 'session_read',
    description:
      '导出某个本地 DSH 历史会话的对话文本，可按关键字过滤轮次。' +
      '先用 session_search 拿到 session_id，再用本工具读细节。',
    parameters: PARAMETERS_READ,
    output: { schema: OUTPUT_READ, render: (_args, value) => renderRead(value) },
    async execute(args, exec) {
      const id = String(args.session_id ?? '').trim()
      if (!id) throw new Error('session_id 不能为空')
      const cwd = String(args.cwd ?? '').trim() || guessCwd(exec)
      const file = resolveSession(id, cwd ? { cwd } : {}) ?? resolveSession(id, {})
      if (!file) throw new Error(`找不到会话 ${id}（在 ${sessionsRoot()} 下未匹配）。`)
      const result = readSessionFile(file.path, {
        query: args.query,
        include: args.include ?? 'messages',
        limit: Math.max(1000, Math.min(200_000, args.max_chars ?? 40_000)),
      })
      const transcript = result.turns
        .map((turn) => `[${turn.role}${turn.time ? ` ${formatTime(turn.time)}` : ''}]\n${turn.text}`)
        .join('\n\n')
      return {
        sessionId: file.sessionId,
        title: result.title,
        cwd: result.header?.cwd,
        createdAt: formatTime(result.header?.createdAt),
        truncated: result.truncated,
        transcript,
      }
    },
    presentCall: (args) => ({ card: 'generic', title: '读取历史会话', kind: 'other', rawInput: args.session_id }),
  })
}
