/**
 * 子进程池：把会话文件分桶交给独立进程解压，命中够数即提前收工。
 *
 * 解压必须离开 host 进程：Electron 内嵌 Node 在 zstd 解压流异常收尾时会让整个进程 abort。
 * 子进程即使崩，host 只会看到非零退出码。
 */
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'

/** 默认并发：留一个核给主线程，最多 6 个（每个都是独立进程，别太贪）。 */
export function defaultConcurrency() {
  return Math.max(1, Math.min(6, availableParallelism() - 2))
}

/**
 * 把文件分成 N 桶：按修改时间从新到旧轮转分配，让每个子进程都先啃较新的会话，
 * 提前收工时覆盖的时间范围尽量一致。
 * @param {{ mtimeMs: number }[]} files
 * @param {number} buckets
 */
export function splitEvenly(files, buckets) {
  const slots = Array.from({ length: Math.max(1, buckets) }, () => [])
  const ordered = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const [index, file] of ordered.entries()) slots[index % slots.length].push(file)
  return slots.filter((slot) => slot.length > 0)
}

/**
 * 并行检索会话文件。
 * @param {{ path: string, sessionId: string, size: number, mtimeMs: number }[]} files
 * @param {string} query
 * @param {object} options - 传给 searchSessionFile 的选项
 * @param {{ concurrency?: number, signal?: AbortSignal, limit?: number }} [control]
 * @returns {Promise<{ results: any[], errors: { path: string, message: string }[] }>}
 */
export async function searchAcrossFiles(files, query, options = {}, control = {}) {
  const queue = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)
  if (queue.length === 0) return { results: [], errors: [] }

  const concurrency = Math.max(1, Math.min(control.concurrency ?? defaultConcurrency(), queue.length))
  const limit = control.limit ?? Number.POSITIVE_INFINITY
  const buckets = splitEvenly(queue, concurrency)
  const childUrl = new URL('./child.js', import.meta.url)
  const childPath = fileURLToPath(childUrl)

  const results = []
  const errors = []
  const children = []
  let closed = false

  const shutdown = () => {
    closed = true
    for (const child of children) {
      try {
        child.stdin?.destroy()
        child.kill()
      } catch {
        /* 已经退出 */
      }
    }
  }

  await new Promise((resolve) => {
    let finished = 0
    const finish = () => {
      if (closed) return
      shutdown()
      resolve()
    }

    for (const bucket of buckets) {
      const child = spawn(process.execPath, [childPath, '--session-search-child'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      children.push(child)

      let buffer = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        buffer += chunk
        let index
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          if (!line) continue
          let message
          try {
            message = JSON.parse(line)
          } catch {
            continue
          }
          if (message.type === 'hit') {
            results.push(message.hit)
            if (!closed && results.length >= limit) finish()
          } else if (message.type === 'error' || message.type === 'fatal') {
            errors.push({ path: message.path ?? '<child>', message: message.message })
          }
        }
      })
      child.stderr.setEncoding('utf8')
      let stderrTail = ''
      child.stderr.on('data', (chunk) => {
        stderrTail = `${stderrTail}${chunk}`.slice(-500)
      })
      child.on('error', (error) => {
        errors.push({ path: '<child>', message: String(error?.message ?? error) })
      })
      child.on('close', (code) => {
        if (code !== 0 && !closed && code !== null) {
          errors.push({ path: '<child>', message: `child exited with code ${code}${stderrTail ? `: ${stderrTail.trim()}` : ''}` })
        }
        finished += 1
        if (finished >= buckets.length) finish()
      })

      child.stdin.on('error', () => {})
      child.stdin.end(JSON.stringify({ files: bucket, query, options }))
    }

    const signal = control.signal
    if (signal) {
      if (signal.aborted) finish()
      else signal.addEventListener('abort', finish, { once: true })
    }
  })

  shutdown()
  return { results, errors }
}
