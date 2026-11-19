/**
 * 会话文本缓存：把可检索的 messages 文本落成 sidecar 文件，
 * 后续查询只读文本、不再解压 zstd / JSON.parse。
 *
 * 目录：<dshHome>/cache/dsh-session-search/
 *   <sessionId>.body.tsv   seq \t turn \t time \t role \t text
 *   <sessionId>.meta.json  源文件校验、已覆盖偏移与头部信息
 *
 * 源文件是追加写的；meta.sourceOffset 记录上一次解压到的完整 zstd 帧边界，
 * 增量更新只读新增字节。任何校验不一致都退回整份重建。
 */
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './sessions.js'
import { decodeFrames, extractTexts, makeSnippet, matchesAll, scanZstdFrames, tokenize } from './core.js'

export const DIGEST_VERSION = 2
const MAX_CACHE_BYTES = 200 * 1024 * 1024
const MIN_CACHE_BYTES = 20 * 1024 * 1024
const HARD_MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024
const CONFIG_NAME = '.config.json'
const PRUNE_INTERVAL_MS = 60 * 60 * 1000
const LOCK_STALE_MS = 15 * 1000

/** 缓存根目录；DSH_SESSION_SEARCH_CACHE 可覆盖（测试/特殊部署）。 */
export function cacheRoot() {
  const override = process.env.DSH_SESSION_SEARCH_CACHE?.trim()
  return override || join(dshHome(), 'cache', 'dsh-session-search')
}

function paths(sessionId) {
  const dir = cacheRoot()
  return {
    dir,
    meta: join(dir, `${sessionId}.meta.json`),
    body: join(dir, `${sessionId}.body.tsv`),
    lock: join(dir, `${sessionId}.lock`),
  }
}

/** 把事件文本压成单行，保证 body 一行一条、只按 tab 分列。 */
function cleanText(text) {
  return String(text).replace(/[\t\r\n]+/g, ' ')
}

function makeRow(seq, turn, time, role, text) {
  return `${seq ?? 0}\t${turn ?? 0}\t${time ?? 0}\t${role}\t${text}`
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** 缓存配置文件路径（与 body/meta 分开，重建时不清）。 */
export function configPath() {
  return join(cacheRoot(), CONFIG_NAME)
}

/** 当前缓存上限（字节）；配置缺失或非法时用默认值。 */
export function getCacheLimit() {
  const config = readJson(configPath())
  const value = Number(config?.maxBytes)
  if (!Number.isFinite(value)) return MAX_CACHE_BYTES
  return Math.max(MIN_CACHE_BYTES, Math.min(HARD_MAX_CACHE_BYTES, Math.floor(value)))
}

/** 写入缓存上限；返回实际生效值。 */
export function setCacheLimit(bytes) {
  const value = Math.max(MIN_CACHE_BYTES, Math.min(HARD_MAX_CACHE_BYTES, Math.floor(Number(bytes) || MAX_CACHE_BYTES)))
  mkdirSync(cacheRoot(), { recursive: true })
  const target = configPath()
  const tmp = `${target}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ maxBytes: value }))
  renameSync(tmp, target)
  return value
}

/** 对外暴露一份缓存的路径，供子进程统计/清理。 */
export function cachePaths(sessionId) {
  return paths(sessionId)
}

function readMetaFile(sessionId) {
  const { meta } = paths(sessionId)
  return readJson(meta)
}

/**
 * 读 meta，并确认它覆盖了当前源文件、body 长度也一致。
 * @returns {object | undefined} 只返回可安全扫描的 meta
 */
export function readFreshMeta(file) {
  const meta = readMetaFile(file.sessionId)
  if (!meta || meta.v !== DIGEST_VERSION) return undefined
  const { body } = paths(file.sessionId)
  let bodyStat
  let sourceStat
  try {
    bodyStat = statSync(body)
    sourceStat = statSync(file.path)
  } catch {
    return undefined
  }
  if (bodyStat.size !== meta.bodyBytes) return undefined
  if (sourceStat.size !== meta.sourceSize || sourceStat.mtimeMs !== meta.sourceMtimeMs) return undefined
  return meta
}

/**
 * 解析一段明文事件，追加缓存行并更新头部信息。
 * @param {Buffer} buffer 压缩字节，必须是完整帧
 * @param {object} state 跨帧累计状态
 * @param {string[]} rows 追加的行
 */
function collectFrames(buffer, state, rows) {
  const { frames } = scanZstdFrames(buffer)
  if (frames.length === 0) return 0
  for (const chunk of decodeFrames(buffer, frames)) {
    for (const line of chunk.split('\n')) {
      if (!line) continue
      // 先按事件类型字符串预筛，避免为工具结果等大对象做 JSON.parse。
      // 命中的行仍会经过 type 判断，误报只多一次解析。
      if (
        !line.includes('"user/message"') &&
        !line.includes('"assistant/message"') &&
        !line.includes('"session/title"') &&
        !line.includes('"compaction/summary"') &&
        !line.includes('"turn/start"') &&
        !line.includes('"type":"session"')
      ) {
        continue
      }
      let event
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof event.seq === 'number' && event.seq > state.seq) state.seq = event.seq
      if (event.type === 'session') {
        if (!state.cwd && typeof event.cwd === 'string') state.cwd = event.cwd
        if (!state.createdAt && typeof event.createdAt === 'number') state.createdAt = event.createdAt
        if (typeof event.origin === 'string') state.origin = event.origin
        continue
      }
      if (event.type === 'turn/start') {
        if (typeof event.data?.turn === 'number') state.turn = event.data.turn
        continue
      }
      const time = typeof event.time === 'number' ? event.time : undefined
      if (time !== undefined && time > state.updatedAt) state.updatedAt = time
      if (event.type === 'session/title' && typeof event.data?.title === 'string') {
        const text = cleanText(event.data.title)
        if (text) rows.push(makeRow(event.seq, state.turn, time, 'title', text))
        state.title = event.data.title
        continue
      }
      for (const part of extractTexts(event, 'messages')) {
        const text = cleanText(part.text)
        if (text) rows.push(makeRow(event.seq, state.turn, time, part.role, text))
      }
    }
  }
  return frames[frames.length - 1].end
}

/** 完整重建一份缓存；返回新的 meta。 */
export function buildDigest(file) {
  const { meta: metaPath, body: bodyPath, dir } = paths(file.sessionId)
  mkdirSync(dir, { recursive: true })
  const before = statSync(file.path)
  const buffer = readFileSync(file.path)
  const state = { seq: 0, turn: 0, title: undefined, cwd: undefined, createdAt: undefined, updatedAt: before.mtimeMs, origin: undefined }
  const rows = []
  const covered = collectFrames(buffer, state, rows)
  const body = rows.length > 0 ? `${rows.join('\n')}\n` : ''
  const meta = {
    v: DIGEST_VERSION,
    sessionId: file.sessionId,
    sourceMtimeMs: before.mtimeMs,
    sourceSize: covered,
    sourceOffset: covered,
    bodyBytes: Buffer.byteLength(body),
    seq: state.seq,
    turn: state.turn,
    title: state.title,
    cwd: state.cwd,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    origin: state.origin,
  }
  const bodyTmp = `${bodyPath}.${process.pid}.tmp`
  const metaTmp = `${metaPath}.${process.pid}.tmp`
  writeFileSync(bodyTmp, body)
  renameSync(bodyTmp, bodyPath)
  writeFileSync(metaTmp, JSON.stringify(meta))
  renameSync(metaTmp, metaPath)
  return meta
}

/**
 * 保证缓存覆盖当前文件：缺失/过期则增量或整份重建。
 * @returns {object | undefined} 可扫描的 meta；拿不到锁时返回 undefined
 */
export function ensureDigest(file) {
  const { meta: metaPath, body: bodyPath, lock } = paths(file.sessionId)
  let locked = false
  try {
    mkdirSync(paths(file.sessionId).dir, { recursive: true })
    writeFileSync(lock, String(process.pid), { flag: 'wx' })
    locked = true
  } catch {
    // 已有写入者；旧锁直接清掉重试一次。
    try {
      const age = Date.now() - statSync(lock).mtimeMs
      if (age > LOCK_STALE_MS) {
        unlinkSync(lock)
        writeFileSync(lock, String(process.pid), { flag: 'wx' })
        locked = true
      }
    } catch {
      /* 另一个进程刚清掉锁或目录不可写 */
    }
  }
  if (!locked) return readFreshMeta(file)
  try {
    const fresh = readFreshMeta(file)
    if (fresh) return fresh
    const meta = readMetaFile(file.sessionId)
    const source = statSync(file.path)
    let bodySize = -1
    try {
      bodySize = statSync(bodyPath).size
    } catch {
      /* 没有 body，走重建 */
    }
    if (!meta || meta.v !== DIGEST_VERSION || bodySize !== meta.bodyBytes || source.size < meta.sourceOffset || source.size === 0) {
      return buildDigest(file)
    }
    // 增量：从上次的帧边界继续读。没有新字节时只刷新源文件校验信息。
    const next = { ...meta }
    const rows = []
    let covered = meta.sourceOffset
    if (source.size > meta.sourceOffset) {
      const length = source.size - meta.sourceOffset
      const tail = Buffer.allocUnsafe(length)
      const fd = openSync(file.path, 'r')
      try {
        readSync(fd, tail, 0, length, meta.sourceOffset)
      } finally {
        closeSync(fd)
      }
      const state = {
        seq: next.seq ?? 0,
        turn: next.turn ?? 0,
        title: next.title,
        cwd: next.cwd,
        createdAt: next.createdAt,
        updatedAt: next.updatedAt ?? source.mtimeMs,
        origin: next.origin,
      }
      const used = collectFrames(tail, state, rows)
      covered = meta.sourceOffset + used
      if (used > 0) {
        next.seq = state.seq
        next.turn = state.turn
        next.title = state.title
        next.cwd = state.cwd
        next.createdAt = state.createdAt
        next.updatedAt = state.updatedAt
        next.origin = state.origin
      }
    }
    if (rows.length > 0) {
      const chunk = `${rows.join('\n')}\n`
      appendFileSync(bodyPath, chunk)
      next.bodyBytes = meta.bodyBytes + Buffer.byteLength(chunk)
    }
    next.sourceOffset = covered
    next.sourceSize = covered
    next.sourceMtimeMs = source.mtimeMs
    const metaTmp = `${metaPath}.${process.pid}.tmp`
    writeFileSync(metaTmp, JSON.stringify(next))
    renameSync(metaTmp, metaPath)
    return next
  } catch {
    return undefined
  } finally {
    try {
      unlinkSync(lock)
    } catch {
      /* 已被清理 */
    }
  }
}

/**
 * 扫描缓存文本。
 * @param {object} file
 * @param {string} query
 * @param {object} options
 * @param {{ ensure?: boolean }} [control] ensure=false 时只读已存在的缓存，不重建
 * @returns {null | object | undefined} null=未命中；undefined=缓存不可用
 */
export function searchDigest(file, query, options = {}, control = {}) {
  const tokens = tokenize(query)
  if (tokens.length === 0) return null
  let meta = control.ensure === false ? readFreshMeta(file) : ensureDigest(file)
  if (!meta) meta = readFreshMeta(file)
  if (!meta) return undefined
  if (!options.includeSubagents && meta.origin === 'subagent') return null
  if (options.cwd && meta.cwd && meta.cwd.toLowerCase() !== options.cwd.toLowerCase()) return null
  let body
  try {
    body = readFileSync(paths(file.sessionId).body, 'utf8')
  } catch {
    return undefined
  }
  const perSession = options.perSession ?? 2
  const snippetWindow = options.snippetWindow ?? 160
  let hits = 0
  let titleMatched = false
  const snippets = []
  for (const line of body.split('\n')) {
    const first = line.indexOf('\t')
    if (first < 0) continue
    const second = line.indexOf('\t', first + 1)
    if (second < 0) continue
    const third = line.indexOf('\t', second + 1)
    if (third < 0) continue
    const fourth = line.indexOf('\t', third + 1)
    if (fourth < 0) continue
    const role = line.slice(third + 1, fourth)
    const text = line.slice(fourth + 1)
    const turn = Number(line.slice(first + 1, second))
    const time = Number(line.slice(second + 1, third))
    if (role === 'title') {
      // 标题不受 since/until 过滤，保持与 searchSessionFile 一致。
      if (titleMatched || !matchesAll(text, tokens)) continue
      titleMatched = true
      hits += 1
      if (snippets.length < perSession) {
        snippets.push({ seq: Number(line.slice(0, first)), turn, time, role: 'title', text })
      }
      continue
    }
    if (options.sinceMs !== undefined && time > 0 && time < options.sinceMs) continue
    if (options.untilMs !== undefined && time > 0 && time >= options.untilMs) continue
    if (!matchesAll(text, tokens)) continue
    hits += 1
    if (snippets.length < perSession) {
      const snippet = makeSnippet(text, tokens, snippetWindow)
      if (snippet) {
        snippets.push({
          seq: Number(line.slice(0, first)),
          turn,
          time,
          role,
          text: snippet,
        })
      }
    }
  }
  if (hits === 0) return null
  return {
    sessionId: file.sessionId,
    path: file.path,
    cwd: meta.cwd,
    title: meta.title,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt ?? file.mtimeMs,
    hits,
    titleHits: titleMatched ? 1 : 0,
    snippets,
  }
}

/**
 * 清理超限缓存：按 meta.updatedAt 从旧到新删除。节流一小时一次。
 */
export function pruneCache(maxBytes = getCacheLimit()) {
  const dir = cacheRoot()
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  const marker = join(dir, '.last-prune')
  try {
    if (Date.now() - statSync(marker).mtimeMs < PRUNE_INTERVAL_MS) return
  } catch {
    /* 首次清理 */
  }
  const entries = []
  let total = 0
  for (const name of names) {
    if (!name.endsWith('.meta.json')) continue
    const metaPath = join(dir, name)
    const meta = readJson(metaPath)
    if (!meta) continue
    const bodyPath = join(dir, `${meta.sessionId}.body.tsv`)
    let size = 0
    try {
      size += statSync(bodyPath).size
    } catch {
      /* body 缺失 */
    }
    try {
      size += statSync(metaPath).size
    } catch {
      /* ignore */
    }
    total += size
    entries.push({ meta, metaPath, bodyPath, size, weight: meta.updatedAt ?? 0 })
  }
  entries.sort((left, right) => left.weight - right.weight)
  for (const entry of entries) {
    if (total <= maxBytes) break
    try {
      unlinkSync(entry.bodyPath)
    } catch {
      /* already gone */
    }
    try {
      unlinkSync(entry.metaPath)
    } catch {
      /* already gone */
    }
    total -= entry.size
  }
  try {
    writeFileSync(marker, String(Date.now()))
  } catch {
    /* ignore */
  }
}

/** 缓存是否可用（目录可创建）。 */
export function cacheReady() {
  try {
    mkdirSync(cacheRoot(), { recursive: true })
    return true
  } catch {
    return false
  }
}
