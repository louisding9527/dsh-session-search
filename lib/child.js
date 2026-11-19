/**
 * 解压/检索子进程：从 stdin 读 NDJSON 任务，逐文件处理并按行写回。
 *
 * 为什么用子进程：Electron 内嵌 Node 在 zstd 解压流异常收尾时会命中
 * `CompressionStream<ZstdDecompressContext>::Close` 断言并 abort 整个进程。
 * 放在子进程里，最坏情况只损失一个桶的结果。
 *
 * 每个文件处理完让出一次事件循环，保证 cancel 能在文件边界被读到。
 */
import { readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  cachePaths,
  cacheRoot,
  ensureDigest,
  getCacheLimit,
  pruneCache,
  readFreshMeta,
  searchDigest,
} from './digest.js'
import { listSessionFiles, searchSessionFile } from './sessions.js'

const cancelled = new Set()
let raw = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  raw += chunk
  let index
  while ((index = raw.indexOf('\n')) >= 0) {
    const line = raw.slice(0, index).trim()
    raw = raw.slice(index + 1)
    if (line) handleLine(line)
  }
})
process.stdin.on('end', () => process.exit(0))

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function handleLine(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  switch (message.type) {
    case 'cancel':
      cancelled.add(message.id)
      return
    case 'search':
      runSearch(message)
      return
    case 'catalog':
      runCatalog(message)
      return
    case 'digest':
      runDigest(message)
      return
    case 'stats':
      runStats(message)
      return
    case 'clear':
      runClear(message)
      return
    case 'prune':
      runPrune(message)
      return
    default:
  }
}

/**
 * 单文件检索：默认走缓存；缓存不可用（锁竞争/损坏）时退回整文件解压。
 * @returns {object | null | undefined} undefined 表示缓存不可用，需要兜底
 */
function searchOne(file, query, options) {
  if (options.include === 'all') return searchSessionFile(file, query, options)
  return searchDigest(file, query, options, { ensure: false })
}

function runSearch(message) {
  const files = Array.isArray(message.files) ? message.files : []
  const options = message.options ?? {}
  let index = 0
  const step = () => {
    if (cancelled.has(message.id)) {
      cancelled.delete(message.id)
      write({ type: 'done', id: message.id })
      return
    }
    if (index >= files.length) {
      write({ type: 'done', id: message.id })
      return
    }
    const file = files[index++]
    try {
      const hit = searchOne(file, message.query, options)
      if (hit === undefined) {
        // 缓存还没建好：本次先用整文件扫描，交给宿主后台补缓存。
        write({ type: 'stale', id: message.id, file })
        const fallback = searchSessionFile(file, message.query, options)
        write(fallback ? { type: 'hit', id: message.id, hit: fallback } : { type: 'miss', id: message.id })
      } else if (hit === null) {
        write({ type: 'miss', id: message.id })
      } else {
        write({ type: 'hit', id: message.id, hit })
      }
    } catch (error) {
      write({ type: 'error', id: message.id, path: file.path, message: String(error?.message ?? error) })
    }
    setImmediate(step)
  }
  step()
}

function runCatalog(message) {
  try {
    const files = message.cwd ? listSessionFiles({ cwd: message.cwd }) : listSessionFiles({})
    write({ type: 'catalog', id: message.id, files })
  } catch (error) {
    write({ type: 'error', id: message.id, message: String(error?.message ?? error) })
    write({ type: 'catalog', id: message.id, files: [] })
  }
}

function runDigest(message) {
  try {
    ensureDigest(message.file)
    pruneCache()
  } catch {
    /* 预热失败不影响会话；下一次查询会重试 */
  }
  write({ type: 'digest-done', id: message.id })
}

/** 统计：已覆盖/过期/缺失、总字节数、最旧与最新构建时间。 */
function runStats(message) {
  const files = Array.isArray(message.files) ? message.files : []
  let ready = 0
  let stale = 0
  let missing = 0
  let bytes = 0
  let newest = 0
  let oldest = 0
  for (const file of files) {
    const paths = cachePaths(file.sessionId)
    let metaStat
    try {
      metaStat = statSync(paths.meta)
    } catch {
      missing += 1
      continue
    }
    bytes += metaStat.size
    try {
      bytes += statSync(paths.body).size
    } catch {
      /* body 缺失 */
    }
    let meta
    try {
      meta = JSON.parse(readFileSync(paths.meta, 'utf8'))
    } catch {
      missing += 1
      continue
    }
    if (readFreshMeta(file)) ready += 1
    else stale += 1
    const weight = Number(meta?.updatedAt) || 0
    if (weight > newest) newest = weight
    if (weight > 0 && (oldest === 0 || weight < oldest)) oldest = weight
  }
  write({
    type: 'stats',
    id: message.id,
    stats: { ready, stale, missing, total: files.length, bytes, newest, oldest, limitBytes: getCacheLimit() },
  })
}

/** 清空 body/meta，保留配置与清理标记。 */
function runClear(message) {
  let removed = 0
  try {
    for (const name of readdirSync(cacheRoot())) {
      if (!name.endsWith('.body.tsv') && !name.endsWith('.meta.json')) continue
      try {
        unlinkSync(join(cacheRoot(), name))
        removed += 1
      } catch {
        /* 已被另一个清理者删除 */
      }
    }
  } catch {
    /* 缓存目录不存在 */
  }
  write({ type: 'cache-cleared', id: message.id, removed })
}

function runPrune(message) {
  try {
    pruneCache()
  } catch {
    /* ignore */
  }
  write({ type: 'pruned', id: message.id })
}
