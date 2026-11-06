/**
 * DSH 会话目录枚举、单文件检索与对话导出。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  decodeFrames,
  encodeCwd,
  extractTexts,
  makeSnippet,
  matchesAll,
  scanZstdFrames,
  tokenize,
} from './core.js'

/** 会话日志文件名匹配：session.jsonl.zstd（旧）与 session.v4.jsonl.zstd（现行）。 */
const SESSION_FILE = /^session(?:\.[a-z0-9]+)?\.jsonl\.zstd$/i

/**
 * DSH 数据根目录；可用 DSH_HOME 覆盖。
 * @returns {string}
 */
export function dshHome() {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

/**
 * 会话根目录。
 * @returns {string}
 */
export function sessionsRoot() {
  return join(dshHome(), 'sessions')
}

/**
 * 枚举会话日志文件。
 * @param {{ cwd?: string }} [options] - 给定 cwd 时优先只扫对应编码目录
 * @returns {{ path: string, sessionId: string, mtimeMs: number, size: number }[]}
 */
export function listSessionFiles(options = {}) {
  const root = sessionsRoot()
  const wanted = options.cwd ? encodeCwd(options.cwd) : undefined
  let dirs
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return []
  }
  const preferred = wanted ? dirs.find((d) => d.name === wanted) : undefined
  const targets = preferred ? [preferred] : dirs
  const files = []
  for (const dir of targets) {
    let entries
    try {
      entries = readdirSync(join(root, dir.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dirPath = join(root, dir.name, entry.name)
      let names
      try {
        names = readdirSync(dirPath)
      } catch {
        continue
      }
      for (const name of names) {
        if (!SESSION_FILE.test(name)) continue
        const path = join(dirPath, name)
        try {
          const st = statSync(path)
          if (!st.isFile()) continue
          files.push({ path, sessionId: entry.name, mtimeMs: st.mtimeMs, size: st.size })
        } catch {
          /* 文件在枚举期间消失，忽略 */
        }
      }
    }
  }
  return files
}

/**
 * 只读首帧拿会话头（id/cwd/createdAt），不解压全文。
 * @param {string} path
 * @returns {{ id?: string, cwd?: string, createdAt?: number } | undefined}
 */
export function readHeader(path) {
  try {
    const buffer = readFileSync(path, { flag: 'r' }).subarray(0, 8192)
    const { frames } = scanZstdFrames(buffer, 1)
    if (frames.length === 0) return undefined
    const text = decodeFrames(buffer, frames).next().value
    const first = String(text ?? '').split('\n').find(Boolean)
    if (!first) return undefined
    const event = JSON.parse(first)
    return event?.type === 'session' ? event : undefined
  } catch {
    return undefined
  }
}

/**
 * 日期字符串（YYYY-MM-DD，按本地时区）→ 当天 00:00 的毫秒时间戳。
 * @param {string} value
 */
export function startOfDay(value) {
  const [y, m, d] = String(value).split('-').map(Number)
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

/**
 * 日期字符串 → 次日 00:00 的毫秒时间戳（用作开区间上界）。
 * @param {string} value
 */
export function endOfDay(value) {
  const start = startOfDay(value)
  return start === undefined ? undefined : start + 86_400_000
}

/**
 * 检索单个会话文件。
 * @param {{ path: string, sessionId: string, mtimeMs: number, size: number }} file
 * @param {string} query
 * @param {{ cwd?: string, sinceMs?: number, untilMs?: number, include?: 'messages'|'all', perSession?: number, snippetWindow?: number }} options
 * @returns {null | { sessionId: string, path: string, cwd?: string, title?: string, createdAt?: number, updatedAt?: number, hits: number, snippets: { seq?: number, time?: number, role: string, text: string }[] }}
 */
export function searchSessionFile(file, query, options = {}) {
  const tokens = tokenize(query)
  if (tokens.length === 0) return null
  const perSession = options.perSession ?? 2
  const snippetWindow = options.snippetWindow ?? 160
  let buffer
  try {
    buffer = readFileSync(file.path)
  } catch {
    return null
  }
  let frames
  try {
    frames = scanZstdFrames(buffer).frames
  } catch {
    return null
  }
  if (frames.length === 0) return null

  let header
  let title
  let hits = 0
  let updatedAt = file.mtimeMs
  const snippets = []

  for (const chunk of decodeFrames(buffer, frames)) {
    for (const line of chunk.split('\n')) {
      if (!line) continue
      // 快路径：只对超长事件（工具结果等）先做整行预筛，省掉大对象的 JSON.parse。
      // 行级 AND 比字段级宽松，只会多解析、不会漏命中。
      if (line.length > 4096) {
        const lower = line.toLowerCase()
        if (!tokens.every((t) => lower.includes(t))) continue
      }
      let event
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (event.type === 'session') {
        header = event
        // 子代理会话通常是主会话内容的复述，默认不参与检索；读到头就立刻放弃，省掉解压。
        if (!options.includeSubagents && header.origin === 'subagent') return null
        continue
      }
      if (event.type === 'session/title' && typeof event.data?.title === 'string') {
        title = event.data.title
        continue
      }
      const time = typeof event.time === 'number' ? event.time : undefined
      if (time !== undefined && time > updatedAt) updatedAt = time
      if (options.sinceMs !== undefined && time !== undefined && time < options.sinceMs) continue
      if (options.untilMs !== undefined && time !== undefined && time >= options.untilMs) continue
      for (const part of extractTexts(event, options.include ?? 'messages')) {
        if (!matchesAll(part.text, tokens)) continue
        hits += 1
        if (snippets.length < perSession) {
          const snippet = makeSnippet(part.text, tokens, snippetWindow)
          if (snippet) snippets.push({ seq: event.seq, time, role: part.role, text: snippet })
        }
      }
    }
  }

  if (hits === 0) return null
  const cwd = header?.cwd
  if (options.cwd && cwd && cwd.toLowerCase() !== options.cwd.toLowerCase()) return null
  return {
    sessionId: file.sessionId,
    path: file.path,
    cwd,
    title,
    createdAt: header?.createdAt,
    updatedAt,
    hits,
    snippets,
  }
}

/**
 * 导出单个会话的对话文本。
 * @param {string} path
 * @param {{ query?: string, include?: 'messages'|'all', limit?: number }} options
 * @returns {{ header?: any, title?: string, turns: { seq?: number, time?: number, role: string, text: string }[], truncated: boolean }}
 */
export function readSessionFile(path, options = {}) {
  const limit = options.limit ?? 40_000
  const tokens = options.query ? tokenize(options.query) : []
  const include = options.include ?? 'messages'
  const buffer = readFileSync(path)
  const frames = scanZstdFrames(buffer).frames
  let header
  let title
  const turns = []
  let used = 0
  let truncated = false
  for (const chunk of decodeFrames(buffer, frames)) {
    for (const line of chunk.split('\n')) {
      if (!line) continue
      let event
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (event.type === 'session') {
        header = event
        continue
      }
      if (event.type === 'session/title' && typeof event.data?.title === 'string') {
        title = event.data.title
        continue
      }
      for (const part of extractTexts(event, include)) {
        if (tokens.length > 0 && !matchesAll(part.text, tokens)) continue
        const remain = limit - used
        if (remain <= 0) {
          truncated = true
          break
        }
        const text = part.text.length > remain ? part.text.slice(0, remain) : part.text
        used += text.length
        turns.push({ seq: event.seq, time: event.time, role: part.role, text })
        if (text.length < part.text.length) {
          truncated = true
          break
        }
      }
      if (truncated) break
    }
    if (truncated) break
  }
  return { header, title, turns, truncated }
}

/**
 * 从会话目录里定位一个会话文件：支持完整 id、id 前缀与文件名。
 * @param {string} id
 * @param {{ cwd?: string }} [options]
 * @returns {{ path: string, sessionId: string, mtimeMs: number, size: number } | undefined}
 */
export function resolveSession(id, options = {}) {
  const needle = String(id ?? '').trim()
  if (!needle) return undefined
  const files = listSessionFiles(options)
  const exact = files.find((f) => f.sessionId === needle || basename(dirname(f.path)) === needle)
  if (exact) return exact
  const prefixed = files.filter((f) => f.sessionId.startsWith(needle) || basename(dirname(f.path)).startsWith(needle))
  if (prefixed.length === 0) return undefined
  prefixed.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return prefixed[0]
}
