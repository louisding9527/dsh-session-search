/**
 * 解压子进程：从 stdin 读任务，逐个文件检索，把结果按 NDJSON 逐行写回 stdout。
 *
 * 为什么用子进程而不是 worker 线程：Electron 内嵌 Node 24 在解压 zstd 时，
 * 若解压流未正常收尾就被销毁，会命中 `CompressionStream<ZstdDecompressContext>::Close`
 * 的 `init_done_` 断言并让整个进程 SIGABRT。放在子进程里，最坏情况只是这个子进程退出，
 * DSH host 不受影响。
 */
import { searchSessionFile } from './sessions.js'

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  raw += chunk
})
process.stdin.on('end', () => {
  let task
  try {
    task = JSON.parse(raw)
  } catch {
    process.stdout.write(`${JSON.stringify({ type: 'fatal', message: 'invalid task payload' })}\n`)
    return
  }
  for (const file of task.files ?? []) {
    try {
      const hit = searchSessionFile(file, task.query, task.options ?? {})
      process.stdout.write(`${JSON.stringify(hit ? { type: 'hit', hit } : { type: 'miss' })}\n`)
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ type: 'error', path: file.path, message: String(error?.message ?? error) })}\n`,
      )
    }
  }
  process.stdout.write(`${JSON.stringify({ type: 'done' })}\n`)
})
