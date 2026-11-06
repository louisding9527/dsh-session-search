/**
 * 宿主侧 HTTP 路由：给侧边栏弹窗提供同源检索接口。
 *
 * 只在本机 webServer 上注册两条只读路由：
 *   GET /session-search/query?q=&limit=&per_session=&include=&scope=&cwd=
 *   GET /session-search/read?session=&q=&max_chars=
 */
import { endOfDay, listSessionFiles, readSessionFile, resolveSession, startOfDay } from './sessions.js'
import { searchAcrossFiles } from './pool.js'

/** 单次检索最多扫多少个会话文件。 */
const MAX_FILES = 4000

/**
 * 写 JSON 响应。
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(payload)
}

/**
 * 只允许 GET，并拒绝跨站来源。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} method
 * @returns {boolean} 是否继续处理
 */
function guard(req, res, method) {
  if (req.method !== method) {
    res.setHeader('allow', method)
    writeJson(res, 405, { error: 'method not allowed' })
    return false
  }
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    let host
    try {
      host = new URL(origin).host
    } catch {
      writeJson(res, 403, { error: 'bad origin' })
      return false
    }
    if (host !== req.headers.host) {
      writeJson(res, 403, { error: 'cross-origin request refused' })
      return false
    }
  }
  return true
}

/**
 * 构造路由表。
 * @param {any} ctx
 * @returns {{ kind: 'exact', path: string, handler: (req: any, res: any) => Promise<void> }[]}
 */
export function makeRoutes(ctx) {
  return [
    {
      kind: 'exact',
      path: '/session-search/query',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const query = (url.searchParams.get('q') ?? '').trim()
        if (query.length === 0) {
          writeJson(res, 200, { query, scanned: { sessions: 0, matched: 0, milliseconds: 0 }, results: [] })
          return
        }
        const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') ?? 20) || 20))
        const perSession = Math.max(1, Math.min(5, Number(url.searchParams.get('per_session') ?? 3) || 3))
        const include = url.searchParams.get('include') === 'all' ? 'all' : 'messages'
        const scope = url.searchParams.get('scope') ?? 'auto'
        const cwd = (url.searchParams.get('cwd') ?? '').trim() || undefined
        const sinceMs = url.searchParams.get('since') ? startOfDay(url.searchParams.get('since')) : undefined
        const untilMs = url.searchParams.get('until') ? endOfDay(url.searchParams.get('until')) : undefined
        const startedAt = Date.now()

        let files = listSessionFiles(scope === 'all' ? {} : cwd ? { cwd } : {})
        if (files.length === 0) files = listSessionFiles({})
        if (files.length > MAX_FILES) {
          files = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_FILES)
        }

        try {
          const { results, errors } = await searchAcrossFiles(
            files,
            query,
            { cwd: scope === 'project' ? cwd : undefined, sinceMs, untilMs, include, perSession },
            { limit },
          )
          writeJson(res, 200, {
            query,
            scanned: { sessions: files.length, matched: results.length, milliseconds: Date.now() - startedAt },
            results: results
              .sort((a, b) => b.hits - a.hits || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
              .slice(0, limit),
            errors: errors.slice(0, 3),
          })
        } catch (error) {
          ctx.logger?.warn?.('[session-search] query failed: %s', String(error?.message ?? error))
          writeJson(res, 500, { error: String(error?.message ?? error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/session-search/read',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = (url.searchParams.get('session') ?? '').trim()
        if (id.length === 0) {
          writeJson(res, 400, { error: 'session is required' })
          return
        }
        const cwd = (url.searchParams.get('cwd') ?? '').trim() || undefined
        const file = resolveSession(id, cwd ? { cwd } : {}) ?? resolveSession(id, {})
        if (!file) {
          writeJson(res, 404, { error: `session ${id} not found` })
          return
        }
        try {
          const result = readSessionFile(file.path, {
            query: (url.searchParams.get('q') ?? '').trim() || undefined,
            include: url.searchParams.get('include') === 'all' ? 'all' : 'messages',
            limit: Math.max(1000, Math.min(200_000, Number(url.searchParams.get('max_chars') ?? 20_000) || 20_000)),
          })
          writeJson(res, 200, {
            sessionId: file.sessionId,
            title: result.title,
            cwd: result.header?.cwd,
            createdAt: result.header?.createdAt,
            truncated: result.truncated,
            turns: result.turns,
          })
        } catch (error) {
          writeJson(res, 500, { error: String(error?.message ?? error) })
        }
      },
    },
  ]
}
