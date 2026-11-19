/**
 * 常驻子进程池：会话文件按新到旧分桶，交给固定数量的子进程检索。
 *
 * 为什么是子进程：Electron 内嵌 Node 在 zstd 解压流异常收尾时会 abort 整个 host；
 * 子进程崩掉只影响当前查询。子进程常驻后省掉每次查询约 150 ms 的启动成本。
 *
 * 协议（NDJSON，一行一条）：
 *   parent → { type:'search'|'catalog'|'digest', id, ... }
 *   child  → { type:'hit'|'miss'|'error', id, ... } / { type:'done'|'catalog'|'digest-done', id }
 *   parent → { type:'cancel', id }
 */
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'

/** 默认并发：留两个核给主线程，最多 6 个。 */
export function defaultConcurrency() {
  return Math.max(1, Math.min(6, availableParallelism() - 2))
}

/** 把文件分成 N 桶：按修改时间从新到旧轮转，让提前收工覆盖相近的时间范围。 */
export function splitEvenly(files, buckets) {
  const slots = Array.from({ length: Math.max(1, buckets) }, () => [])
  const ordered = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const [index, file] of ordered.entries()) slots[index % slots.length].push(file)
  return slots.filter((slot) => slot.length > 0)
}

const IDLE_MS = 60_000
const CATALOG_TTL_MS = 3_000
const CANCEL_GRACE_MS = 200
const CHILD_PATH = fileURLToPath(new URL('./child.js', import.meta.url))

class ChildWorker {
  constructor(pool) {
    this.pool = pool
    this.task = null
    this.idleTimer = null
    this.buffer = ''
    this.alive = true
    this.child = spawn(process.execPath, [CHILD_PATH, '--session-search-child'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk
      let index
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index).trim()
        this.buffer = this.buffer.slice(index + 1)
        if (line) this.onLine(line)
      }
    })
    this.child.stderr.setEncoding('utf8')
    this.stderr = ''
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-800)
    })
    this.child.on('error', (error) => this.fail(error))
    this.child.on('close', (code) => this.fail(new Error(`child exited ${code}${this.stderr ? `: ${this.stderr.trim()}` : ''}`)))
    this.child.stdin.on('error', () => {})
  }

  send(message) {
    if (!this.alive) return
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`)
    } catch (error) {
      this.fail(error)
    }
  }

  onLine(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const task = this.task
    if (!task || message.id !== task.id) return
    switch (message.type) {
      case 'hit':
      case 'miss':
      case 'error':
      case 'stale':
        task.onMessage?.(message)
        return
      case 'done':
      case 'digest-done':
        this.pool.release(this)
        task.resolve(undefined)
        return
      case 'catalog':
        this.pool.release(this)
        task.resolve(message.files ?? [])
        return
      case 'stats':
        this.pool.release(this)
        task.resolve(message.stats)
        return
      case 'cache-cleared':
        this.pool.release(this)
        task.resolve(message.removed ?? 0)
        return
      case 'pruned':
        this.pool.release(this)
        task.resolve(undefined)
        return
      case 'fatal':
        this.fail(new Error(message.message ?? 'child fatal'))
        return
      default:
    }
  }

  fail(error) {
    if (!this.alive) return
    this.alive = false
    clearTimeout(this.idleTimer)
    const task = this.task
    this.task = null
    this.pool.remove(this)
    task?.reject(error instanceof Error ? error : new Error(String(error)))
  }

  dispose() {
    this.alive = false
    clearTimeout(this.idleTimer)
    try {
      this.child.stdin.destroy()
      this.child.kill()
    } catch {
      /* already gone */
    }
  }
}

class Pool {
  constructor(max = defaultConcurrency()) {
    this.workers = []
    this.waiters = []
    this.taskSeq = 0
    this.max = max
    this.disposed = false
  }

  acquire() {
    if (this.disposed) return Promise.reject(new Error('pool disposed'))
    const idle = this.workers.find((worker) => worker.alive && worker.task === null)
    if (idle) {
      clearTimeout(idle.idleTimer)
      idle.task = { reserved: true }
      return Promise.resolve(idle)
    }
    if (this.workers.length < this.max) {
      const worker = new ChildWorker(this)
      worker.task = { reserved: true }
      this.workers.push(worker)
      return Promise.resolve(worker)
    }
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  release(worker) {
    if (!worker.alive) return
    worker.task = null
    const waiter = this.waiters.shift()
    if (waiter) {
      worker.task = { reserved: true }
      waiter(worker)
      return
    }
    clearTimeout(worker.idleTimer)
    worker.idleTimer = setTimeout(() => {
      if (worker.task !== null) return
      worker.dispose()
      this.remove(worker)
    }, IDLE_MS)
    worker.idleTimer.unref?.()
  }

  remove(worker) {
    this.workers = this.workers.filter((item) => item !== worker)
    if (this.disposed) return
    const waiter = this.waiters.shift()
    if (waiter) this.acquire().then(waiter, () => {})
  }

  nextTaskId() {
    return ++this.taskSeq
  }

  run(kind, payload, onMessage, taskId) {
    return this.acquire().then((worker) => {
      if (!worker) throw new Error('pool disposed')
      return new Promise((resolve, reject) => {
        const id = taskId ?? ++this.taskSeq
        worker.task = { id, onMessage, resolve, reject }
        worker.send({ type: kind, id, ...payload })
      })
    })
  }

  cancel(ids) {
    for (const worker of this.workers) {
      if (worker.task && ids.has(worker.task.id)) worker.send({ type: 'cancel', id: worker.task.id })
    }
  }

  killTasks(ids) {
    for (const worker of this.workers) {
      if (!worker.task || !ids.has(worker.task.id)) continue
      const task = worker.task
      worker.dispose()
      this.remove(worker)
      task.reject(new Error('cancelled'))
    }
  }

  stats() {
    return { workers: this.workers.filter((worker) => worker.alive).length, busy: this.workers.filter((worker) => worker.alive && worker.task !== null).length }
  }

  dispose() {
    this.disposed = true
    for (const waiter of this.waiters.splice(0)) waiter(undefined)
    for (const worker of this.workers.splice(0)) {
      const task = worker.task
      worker.dispose()
      task?.reject(new Error('pool disposed'))
    }
  }
}

let pool = new Pool()
let maintPool = new Pool(Math.max(1, Math.min(2, defaultConcurrency() - 2)))
const maintQueue = []
const maintQueued = new Set()
let maintRunning = false
let activeQueries = 0
let cacheClearing = false

/** 当前池状态，测试/诊断用。 */
export function poolStats() {
  return { ...pool.stats(), maintenance: maintPool.stats(), queued: maintQueue.length, rebuilding: cacheClearing }
}

/** 插件卸载或测试收尾时销毁常驻进程。 */
export function disposePool() {
  pool.dispose()
  maintPool.dispose()
  maintQueue.length = 0
  maintQueued.clear()
  maintRunning = false
  cacheClearing = false
  pool = new Pool()
  maintPool = new Pool(Math.max(1, Math.min(2, defaultConcurrency() - 2)))
}

/**
 * 把一份会话缓存排进后台队列；同一个 path 只排一次。
 * @param {{path: string, sessionId: string, size: number, mtimeMs: number}} file
 * @param {boolean} [front] 刚被查询/刚结束的会话优先
 */
export function scheduleDigest(file, front = false) {
  if (!file?.path || !file?.sessionId) return
  if (maintQueued.has(file.path)) return
  if (maintQueued.size > 5000) return
  maintQueued.add(file.path)
  if (front) maintQueue.unshift(file)
  else maintQueue.push(file)
  pumpMaintenance()
}

/** 把一批历史会话排进后台，慢慢预热。 */
export function warmCorpus(files) {
  for (const file of files) scheduleDigest(file)
}

function pumpMaintenance() {
  if (maintRunning || activeQueries > 0 || cacheClearing) return
  const next = maintQueue.shift()
  if (!next) return
  maintQueued.delete(next.path)
  maintRunning = true
  maintPool
    .run('digest', { file: next })
    .catch(() => {})
    .finally(() => {
      maintRunning = false
      pumpMaintenance()
    })
}

/**
 * 并行检索会话文件。
 * @param {{ path: string, sessionId: string, size: number, mtimeMs: number }[]} files
 * @param {string} query
 * @param {object} options
 * @param {{ concurrency?: number, signal?: AbortSignal, limit?: number }} control
 */
export async function searchAcrossFiles(files, query, options = {}, control = {}) {
  const queue = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)
  if (queue.length === 0) return { results: [], errors: [] }
  activeQueries += 1
  const concurrency = Math.max(1, Math.min(control.concurrency ?? pool.max, queue.length))
  const buckets = splitEvenly(queue, concurrency)
  const limit = control.limit ?? Number.POSITIVE_INFINITY
  const results = []
  const errors = []
  const taskIds = new Set()

  return new Promise((resolve) => {
    let settled = false
    let remaining = buckets.length
    const finish = () => {
      if (settled) return
      settled = true
      // 让子进程在文件边界停下；超过宽限仍未退出的直接杀掉补位。
      pool.cancel(taskIds)
      setTimeout(() => {
        if (!settled) return
        pool.killTasks(taskIds)
      }, CANCEL_GRACE_MS).unref?.()
      control.signal?.removeEventListener('abort', onAbort)
      activeQueries = Math.max(0, activeQueries - 1)
      pumpMaintenance()
      resolve({ results, errors })
    }
    const onAbort = () => finish()

    for (const bucket of buckets) {
      const taskId = pool.nextTaskId()
      taskIds.add(taskId)
      pool
        .run('search', { files: bucket, query, options }, (message) => {
          if (settled) return
          if (message.type === 'hit') {
            results.push(message.hit)
            if (results.length >= limit) finish()
          } else if (message.type === 'stale') {
            scheduleDigest(message.file)
          } else if (message.type === 'error') {
            errors.push({ path: message.path ?? '<child>', message: message.message })
          }
        }, taskId)
        .then(() => {
          remaining -= 1
          if (remaining === 0) finish()
        })
        .catch((error) => {
          if (!settled) errors.push({ path: '<child>', message: String(error?.message ?? error) })
          remaining -= 1
          if (remaining === 0) finish()
        })
    }

    if (control.signal) {
      if (control.signal.aborted) finish()
      else control.signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

const catalogs = new Map()

/**
 * 会话文件清单：子进程枚举 + 3 秒缓存，过期先返回旧清单再后台刷新。
 * @param {{ cwd?: string }} [options]
 */
export async function listFilesCached(options = {}) {
  const key = options.cwd ?? ''
  const now = Date.now()
  const entry = catalogs.get(key)
  if (entry && entry.files && now - entry.at < CATALOG_TTL_MS) return entry.files
  if (entry && entry.files && !entry.pending) {
    entry.pending = true
    pool
      .run('catalog', { cwd: options.cwd })
      .then((files) => {
        entry.files = files
        entry.at = Date.now()
      })
      .catch(() => {})
      .finally(() => {
        entry.pending = false
      })
    return entry.files
  }
  if (entry && entry.pending && entry.files) return entry.files
  if (entry && entry.pending && entry.promise) return entry.promise
  const promise = pool
    .run('catalog', { cwd: options.cwd })
    .then((files) => {
      catalogs.set(key, { files, at: Date.now(), pending: false, promise: undefined })
      return files
    })
    .catch(() => {
      catalogs.delete(key)
      return []
    })
  catalogs.set(key, { files: entry?.files, at: 0, pending: true, promise })
  return promise
}

/** 后台同步一份会话缓存（turn/end 预热）。 */
export function refreshDigestInBackground(file) {
  scheduleDigest(file, true)
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/** 缓存统计（在子进程里统计，避免宿主同步 stat 几千个文件）。 */
export async function cacheStats(files) {
  try {
    return await pool.run('stats', { files })
  } catch {
    return { ready: 0, stale: 0, missing: files.length, total: files.length, bytes: 0, newest: 0, oldest: 0 }
  }
}

/** 增量把所有会话排进后台队列；已覆盖的文件只会被快速跳过。 */
export function incrementalCache(files) {
  warmCorpus(files)
  return files.length
}

/** 清空缓存并重新预热；返回清掉的条目数。 */
export async function rebuildCache(files) {
  if (cacheClearing) return { started: false, removed: 0 }
  cacheClearing = true
  try {
    maintQueue.length = 0
    maintQueued.clear()
    const deadline = Date.now() + 5000
    while (maintRunning && Date.now() < deadline) await delay(100)
    const removed = await pool.run('clear', {})
    warmCorpus(files)
    return { started: true, removed }
  } finally {
    cacheClearing = false
    pumpMaintenance()
  }
}

/** 上限调整后立即按新上限清理。 */
export function pruneCacheNow() {
  return pool.run('prune', {}).catch(() => {})
}
