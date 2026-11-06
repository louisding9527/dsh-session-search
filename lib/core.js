/**
 * DSH 会话日志读取与关键字检索核心。
 *
 * 会话文件格式（DSH 自己的 JSONL 持久化）：
 *   ~/.dsh/sessions/<encodeCwd(cwd)>/<sessionId>/session.v4.jsonl.zstd
 * 每一行是一条事件 JSON，且**每帧独立压缩**（一个 zstd 帧一条或一批事件）。
 * Node 的 zstdDecompressSync 只解第一帧，所以必须先用 scanZstdFrames 定位帧边界。
 */
import { zstdDecompressSync } from 'node:zlib'

export const ZSTD_MAGIC = 0xfd2fb528

/**
 * 定位压缩缓冲区里所有完整 zstd 帧的字节区间，不解压块内容。
 * @param {Buffer} buffer
 * @param {number} [maxFrames]
 * @returns {{ frames: { start: number, end: number }[], tornStart?: number }}
 */
export function scanZstdFrames(buffer, maxFrames = Infinity) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${offset}`)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
    if (frames.length === maxFrames) return { frames }
  }
  return { frames }
}

/**
 * 依次解压每个帧，产出明文（多行 JSONL 片段）。
 * @param {Buffer} buffer
 * @param {{ start: number, end: number }[]} frames
 */
export function* decodeFrames(buffer, frames) {
  for (const frame of frames) {
    yield zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8')
  }
}

/**
 * 把 cwd 编码成 DSH 的会话目录名：去掉冒号、反斜杠变连字符，两侧加 `--`。
 * 例：D:\work\new_sys\dev\dev → --D-work-new_sys-dev-dev--
 * @param {string} cwd
 */
export function encodeCwd(cwd) {
  const normalized = cwd.replace(/[\\/]+$/, '')
  return `--${normalized.replace(/:/g, '').replace(/[\\/]/g, '-')}--`
}

/** 事件里可检索的文本类型。 */
const MESSAGE_TYPES = new Set([
  'user/message',
  'assistant/message',
  'system/message',
  'tool/call',
  'tool/result',
  'session/title',
  'compaction/summary',
])

/**
 * 从一条事件里取出可检索的文本片段。
 *
 * messages 模式只保留「真实对话」：用户输入（source.kind 为 user 或缺失）、
 * 助手正文、会话标题、压缩摘要。系统提示注入、插件注入的记忆快照、
 * 思考过程、工具调用与结果都归到 all 模式，避免检索被上下文注入刷屏。
 *
 * @param {any} event
 * @param {'messages'|'all'} include
 * @returns {{ role: string, text: string }[]}
 */
export function extractTexts(event, include) {
  const type = event?.type
  if (!MESSAGE_TYPES.has(type)) return []
  const data = event.data ?? {}
  const full = include === 'all'
  // 工具与系统提示只在 all 模式可搜
  if (type === 'tool/call' || type === 'tool/result' || type === 'system/message') {
    if (!full) return []
  }
  switch (type) {
    case 'session/title':
      return typeof data.title === 'string' ? [{ role: 'title', text: data.title }] : []
    case 'tool/call':
      return [{ role: `tool:${data.name ?? '?'}`, text: String(data.arguments ?? '') }]
    case 'compaction/summary':
      return collectContent(data.summary, 'summary', full)
    case 'user/message': {
      const kind = data.source?.kind
      if (!full && kind !== undefined && kind !== 'user') return []
      return collectContent(data.content, 'user', full)
    }
    case 'assistant/message':
      return collectContent(data.message?.content, 'assistant', full)
    case 'system/message':
      return collectContent(data.message?.content, 'system', full)
    case 'tool/result':
      return collectContent(data.message?.content, 'tool-result', full)
    default:
      return []
  }
}

/**
 * 把 content 数组拍平成文本片段，保留 role 的细分（text / reasoning）。
 * @param {any} content
 * @param {string} role
 * @param {boolean} includeThinking - 是否保留 reasoning 片段
 */
function collectContent(content, role, includeThinking) {
  if (!Array.isArray(content)) return []
  const out = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if (part.type === 'text' && typeof part.text === 'string') out.push({ role, text: part.text })
    else if (includeThinking && part.type === 'reasoning' && typeof part.text === 'string') {
      out.push({ role: `${role}:thinking`, text: part.text })
    }
  }
  return out
}

/**
 * 把查询串切成词：空白分隔，全部出现才算命中（AND），大小写不敏感。
 * @param {string} query
 */
export function tokenize(query) {
  return String(query ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase())
}

/**
 * 在文本里找第一个命中位置，返回带上下文的片段。
 * @param {string} text
 * @param {string[]} tokens
 * @param {number} window
 */
export function makeSnippet(text, tokens, window = 160) {
  const lower = text.toLowerCase()
  for (const token of tokens) {
    const at = lower.indexOf(token)
    if (at < 0) continue
    const start = Math.max(0, at - Math.floor(window / 3))
    const end = Math.min(text.length, at + token.length + window)
    const slice = text.slice(start, end).replace(/\s+/g, ' ').trim()
    return `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`
  }
  return undefined
}

/**
 * 全词命中判断。
 * @param {string} text
 * @param {string[]} tokens
 */
export function matchesAll(text, tokens) {
  const lower = text.toLowerCase()
  return tokens.every((t) => lower.includes(t))
}
