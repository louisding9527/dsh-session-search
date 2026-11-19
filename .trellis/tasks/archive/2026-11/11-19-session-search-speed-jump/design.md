# 设计：会话搜索提速与命中定位

## 1. 目标架构

```
浏览器弹窗 (lib/client.js)
  │ GET /session-search/query?...&max?（带 AbortSignal）
  ▼
宿主路由 (lib/http.js)
  │ 取消贯通：req close → AbortController
  ▼
搜索调度 (lib/pool.js，重写)
  │ 目录清单（TTL 3s，由子进程枚举，不阻塞宿主）
  │ 文件分桶 → 常驻子进程（8 个上限，空闲 60s 退出）
  ▼
子进程 (lib/child.js，改为 NDJSON 长连接)
  │ 每个文件：读缓存 meta/body
  │   命中 → 扫描 body 文本（子串 AND）
  │   缺失/过期 → 解压 .zstd 重建缓存（唯一会碰 zstd 的地方）
  ▼
结果（含 seq/turn）→ 宿主排序 → JSON 返回

宿主监听 ctx.on('session/event')
  │ turn/end → 防抖 1.5s → 后台增量同步该会话缓存
  ▼
~/.dsh/cache/dsh-session-search/<sessionId>.meta.json + .body.tsv
```

保留现有安全边界：zstd 只在子进程解压（Electron 内嵌 Node 的 `CompressionStream::Close` 断言会 abort 整个进程）；缓存扫描也在子进程，避免宿主阻塞。

## 2. 缓存格式

目录：`<dshHome>/cache/dsh-session-search/`，与 `~/.dsh/sessions` 分离，可整体删除。

- `<sessionId>.body.tsv`：每行一条可检索文本，`seq \t turn \t time \t role \t text`。
  - `text` 中的 `\t`、`\r`、`\n` 统一替换为空格；其余字符原样（不做 JSON 转义），保证直接 `includes` 子串匹配。
  - 只收 `messages` 模式文本：用户输入、助手正文、标题、压缩摘要；不含系统提示/记忆注入/思考/工具结果。
  - 标题行也进 body（`role=title`），便于“搜标题”命中；但每次会话最多计 1 次标题命中，与现状 `titleHit` 语义一致。
  - meta 同时保存 `title`（最新标题）、`cwd`、`createdAt`、`updatedAt`（事件时间最大值，缺省用文件 mtime），查询时不必再解压头部。
- `<sessionId>.meta.json`：`{ v:1, sourceMtimeMs, sourceSize, sourceOffset, bodyBytes, seq, turn, title, cwd, createdAt, updatedAt }`。
  - `sourceOffset` 是上一次解压完成的 zstd 帧边界（字节）。
  - `bodyBytes` 是 body 已写入长度；若与磁盘实际长度不一致，视为损坏，整份重建。
- 原子性：body 追加后写临时 meta，再 `rename` 覆盖；崩溃最多留下多余 body 尾部，由 `bodyBytes` 校验发现并重建。
- 失效：源文件 `mtimeMs`/`size` 变化 → 增量；`size < sourceOffset` → 整份重建；解析异常 → 整份重建。
- 容量：总大小上限 200 MB；超过时按 meta 的 `updatedAt` 最旧删除，清理节流为每小时一次。

## 3. 增量更新

1. `fs.open(path,'r')` 从 `sourceOffset` 读到文件尾。
2. 用 `scanZstdFrames` 找完整帧；末尾撕裂帧（`tornStart`）不解，保留到下次。
3. 解压新帧，逐事件提取 `messages` 文本，追加到 body；更新 `sourceOffset`、`seq`、`turn`、`title`、`updatedAt`。
4. 写 meta。
5. 同步期间文件仍在增长时，以本次读到的完整帧边界为准；下一次查询继续追平。

触发点：
- **轮次结束**：宿主 `ctx.on('session/event', (session, event) => { if (event.type === 'turn/end') schedule(session) })`。按 `session.id` 单飞 + 1.5 s 防抖，避免每步都写盘。
- **查询时**：只读已经覆盖当前文件的缓存；缺失/过期时先用整文件扫描返回本次结果，再把该文件排进低优先级后台队列建缓存。这样冷查询不退化为“先建 2166 份缓存再回答”。
- **历史存量**：首次被搜到或首次收到该会话 `turn/end` 时按需建；不在启动时全量重建。

不含 `include=all`：`all` 仍走现有解压扫描路径，保证工具行为不变；缓存只服务默认 `messages`。

## 4. 搜索流程与提前收工

- 目录清单：子进程 `readdir` + `stat` 生成 `{path, sessionId, size, mtimeMs}`；宿主缓存 3 s，过期后由子进程后台刷新，查询先用旧清单。第一步查询最多多等一次枚举（约 250 ms），但不再阻塞宿主事件循环。
- 分桶：沿用按 `mtimeMs` 从新到旧轮转，保证提前收工时各子进程覆盖的时间范围一致。
- 每个文件：先读 meta/body；没有可用缓存就在本次用整文件扫描兜底，并把文件排进后台建缓存队列（查询结束后低优先级执行，避免与前台抢磁盘）。
- 命中达到全局 `limit`：宿主向所有子进程发 `cancel`，子进程在文件边界退出循环并回报。
- 缓存未覆盖的文件不阻塞本次查询：整文件扫描返回结果，同时入后台队列；维护池 2 个进程，查询进行时暂停，查询结束继续。
- 取消：路由把 `req.on('close')` 转成 `AbortSignal`；pool 立即发 `cancel`，等待 200 ms 后仍未退出的子进程直接 `kill` 并补一个空闲进程。

## 5. 返回契约

`/session-search/query` 的 `results[].snippets[]` 增加 `seq`（数字）与 `turn`（数字）；其余字段不变。客户端用 `seq/turn` 做定位，不再只依赖文本。

工具 `session_search` 的输出 schema 不变（`seq/turn` 只在 HTTP 路由暴露），避免影响模型调用。

## 6. 跳转定位（客户端）

点击行为：
- 点某条片段 → `pickResult(item, snippetIndex)`；点卡片其余区域 → 用第一条片段。
- 顺序：`close()` 弹窗 → `uiWorkspace.openSession(sessionId)` → 启动定位器。

定位器（`lib/client.js` 内部模块 `jump.ts` 逻辑，JS 内联在 client）：
1. 等 `[data-chat-flow]` 出现（轮询 50 ms，上限 3 s），再等 100 ms 布局稳定。
2. **轨道优先**：找 `nav` 下的 `button[data-index]`（DSH 轮次轨道，未加载轮次会先按 `turn/start` 的 seq 翻页再落位，见 `use-chat-navigation.ts:navigateToTurn`）。
   - 目标标记未挂载时，先把轨道内部滚动容器滚到 `index*10` 附近，等两帧再找 `button[data-index]`。
   - 用 `aria-label` 里的数字匹配目标 `turn`；点击后等 `aria-busy` 消失或目标文本出现（上限 4 s）。
3. **文本定位**：在 `[data-chat-flow]` 内按文本节点找命中（大小写不敏感）。多个命中时，选与片段文本最接近的一处（公共前后缀长度最大）。
   - 用 `Range.getBoundingClientRect()` 算目标位置，向上找最近的可滚动祖先（`overflow-y: auto|scroll`），把它滚到视口约 1/3 高度处。
   - 高亮：`CSS.highlights` + `Highlight(range)`，样式 `::highlight(session-search-hit)`（背景色 + 圆角）；3 s 后清除。不支持时退化为定位后 2 s 的 fixed 定位半透明遮罩。
4. **自动翻页兜底**：轨道不可用且文本不在已加载窗口时，把滚动容器置 `scrollTop=0`，每 400 ms 检查一次目标文本，最多 12 次 / 5 s。
5. **失败提示**：仍未找到 → 弹窗内联提示「已打开会话，但未定位到命中（可能在更早历史）」4 s；会话保持打开。
6. **取消**：用户再次打开弹窗、切换会话或按 Esc 时终止定位器（清定时器、清高亮）。

兼容与退化：
- 所有 DSH 内部标记（`data-chat-flow`、`button[data-index]`、`aria-label` 数字、`aria-busy`）都做存在性判断；DSH 升级导致失效时退到“自动翻页 → 提示”，不会停在末尾且无提示。
- 不修改聊天 DOM（不包 `<mark>`），只用 Highlight API/遮罩，避免 React 重渲染冲突。

## 7. 宿主生命周期

- 常驻子进程挂在 `ctx.effect` 上，插件卸载/宿主退出时统一 `kill`。
- `ctx.on('session/event')` 监听器只做类型判断与入队，任何异常吞掉并记 warn，不能影响会话写入。
- 缓存目录不存在时由子进程按需创建；权限失败时跳过缓存、退回旧扫描，并在 HTTP 响应 `scanned.cache="off"` 标记（客户端不展示）。

## 8. 风险与权衡

| 风险 | 处理 |
|---|---|
| DSH 聊天 DOM/轨道结构变化 | 全部特性探测 + 自动翻页兜底；发布说明标注 |
| 轮次轨道在窄窗口隐藏（宽度 ≤900px） | 直接走文本定位/自动翻页 |
| 持久子进程吃内存 | 上限 8 个、空闲 60 s 退出、查询后 `unref` 不阻止退出 |
| 缓存与源文件不一致 | meta 双重校验（mtime+size+bodyBytes）；不一致整份重建 |
| 磁盘占用 | 200 MB 上限 + 最旧优先清理 |
| 首次建缓存 IO 峰值 | 子进程内完成；并发沿用 6；可加配置 `cacheMaxBytes` |
| `turn/end` 时文件尚未落盘 | 1.5 s 防抖 + 查询时追平；允许短暂延迟 |

## 9. 测试策略

- 单元：`scratch/test-digest.mjs`
  - 用真实会话副本建缓存，和 `searchSessionFile` 对同一批中英文查询比对命中集合与片段文本。
  - 模拟追加帧 → 增量同步 → 新内容可命中。
  - 截断 body / 改 meta / 改源文件 → 自动重建。
- 集成：`scratch/test-pool.mjs` 启停常驻子进程、取消后 200 ms 内无残留任务。
- 性能：`scratch/bench-search.mjs` 输出冷/热查询 p50，对照验收阈值。
- 手工：GUI 点击冷门历史命中（轨道可达 / 窗口窄 / 命中在未加载页）三种场景。
