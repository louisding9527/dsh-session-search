# 实施计划：会话搜索提速与命中定位

前置：`task.py start` 后按顺序执行；每步先跑验证再进入下一步。不改 DSH 本体。

## 阶段 0：DOM 探针（只读，约 30 分钟）

- [ ] 在运行中的 GUI 打开一个长会话，确认：
  - `[data-chat-flow]` 容器与 `[data-chat-node-key]` 行存在；
  - 轮次轨道 `nav > button[data-index]` 的 `aria-label` 是否含轮次数字、`aria-busy` 何时清除；
  - 窄窗口（<900px）时轨道是否消失。
- [ ] 记录一份最小选择器清单到 `scratch/dom-probe.md`（不进运行时依赖）。
- 失败处理：若轨道选择器不可用，仍按设计走文本定位 + 自动翻页，不阻塞后续阶段。

## 阶段 1：缓存模块

- [ ] 新增 `lib/digest.js`
  - `digestPath(sessionId)`、`readDigestMeta()`、`buildDigest(file, { fromOffset })`、`updateDigest(file)`、`searchDigest(file, tokens, options)`。
  - 复用 `core.js` 的 `scanZstdFrames`/`decodeFrames`/`extractTexts`/`tokenize`/`makeSnippet`/`matchesAll`。
  - 实现 §2 的 meta/body 格式、原子写、失效与容量清理。
- [ ] 新增 `scratch/test-digest.mjs`：真实会话副本上对比 `searchSessionFile`；追加/截断/改 meta 三类恢复用例。
- 验证：`node scratch/test-digest.mjs`；对 3 个中英文查询命中集合完全一致。

## 阶段 2：常驻子进程与调度

- [ ] 重写 `lib/pool.js`
  - 常驻子进程：NDJSON 任务 `{id, files, query, options, limit}`、`{id, type:'cancel'}`；空闲 60 s 退出；崩溃自动补位；插件 dispose 全杀。
  - 取消：`AbortSignal` → 广播 cancel；200 ms 后强杀。
  - 目录清单：由一个子进程执行 `readdir/stat`，宿主缓存 3 s。
- [ ] 改造 `lib/child.js` 为长连接循环；每个文件先试缓存，缺失/过期再解压重建；文件边界检查 cancel。
- [ ] `lib/http.js`：`req.on('close')` → `AbortController`；查询走新 pool；错误仍写 JSON。
- [ ] `lib/index.js`：工具路径复用新 pool；注册 `ctx.on('session/event')` 的 `turn/end` 钩子（防抖 1.5 s、单飞、后台队列）；插件卸载清理定时器与子进程。
- [ ] 新增 `scratch/test-pool.mjs`：连续两次查询子进程数不增长；abort 后 200 ms 内无任务；宿主同步调用 <50 ms。
- 验证：`node scratch/test-pool.mjs`。

## 阶段 3：搜索正确性与性能

- [ ] 新增 `scratch/bench-search.mjs`：冷/热、常见词/生僻词、limit 25 的 p50 与 p95。
- [ ] 对固定查询集（「会话」「compaction」「zstdDecompressSync」+ 2 个中文短语）回归：命中会话集合与改动前一致。
- [ ] 宿主卡顿检查：搜索时另发一个 `/session-search/read` 请求，响应不被同步枚举拖住。
- 验证门槛见 PRD 验收项；未达标先查 meta 命中率与磁盘读次数，不进入阶段 4。

## 阶段 4：跳转定位

- [ ] `lib/http.js`：`snippets[]` 增加 `seq`、`turn`（数字）。
- [ ] `lib/client.js`
  - `ResultItem`：片段行单独可点（`stopPropagation`），卡片点击取第一条片段。
  - 新增定位器：等待聊天挂载 → 轨道点击 → 文本定位/高亮 → 自动翻页 → 失败提示 → 取消清理。
  - 高亮 CSS 走注入的 `css` 常量（`::highlight(session-search-hit)`）。
  - 弹窗关闭/切换/ Esc 时调用 `locator.cancel()`。
- [ ] 手工验证三种场景：命中在当前窗口、命中在未加载旧页（轨道可达）、窄窗口轨道隐藏。
- 验证：点击后 1.5 s 内目标句居中，高亮 ≥1.5 s；失败场景有提示。

## 阶段 5：收尾

- [ ] README 增加：缓存目录与容量、首查成本、跳转行为与降级、`include=all` 不缓存。
- [ ] 版本升到 `0.3.0`；`scratch/release-0.3.0.md` 摘要。
- [ ] 跑全部 scratch 测试 + 性能门槛；`node --check` 所有改动文件。
- [ ] 用户侧安装验证：desktop profile 为 `link:` 指向本目录，重启 DSH 后生效（宿主路由与客户端都需重启）。

## 风险文件与回滚点

| 文件 | 风险 | 回滚 |
|---|---|---|
| `lib/pool.js` | 常驻进程泄漏/僵尸 | 保留旧文件于 git，`git checkout -- lib/pool.js` 并重启 |
| `lib/digest.js` | 缓存损坏导致漏命中 | 删除 `<dshHome>/cache/dsh-session-search/` 即回到重建路径 |
| `lib/client.js` | 定位器误滚/卡死 | 特性开关：`localStorage['dsh.session-search.jump.v1']='off'` 关闭定位器（仅打开会话） |
| `lib/http.js` | abort 误杀正常请求 | `AbortSignal` 仅在 `req` close 且 `!res.writableEnded` 时触发 |
| `lib/index.js` | session/event 监听器抛错影响会话 | 监听器整体 try/catch，失败只 warn |

## 提交拆分（小步可验证）

1. `feat(cache): digest module + tests`
2. `feat(pool): persistent workers, cancellation, catalog cache`
3. `feat(host): turn/end prewarm + abort wiring`
4. `feat(ui): jump to hit with highlight and fallback`
5. `chore: docs, version 0.3.0`
