# dsh-session-search

Keyword search over your local **DeepSeek Harness (dsh)** chat history — ask "how did we fix this last time?" and get the session, the timestamp, and the matching excerpt.

在 DSH 自己的历史会话里按关键字检索过往对话。

## What it does / 做什么

DSH stores every session under `~/.dsh/sessions/<encoded-cwd>/<session-id>/session.v4.jsonl.zstd`. This plugin adds two model-facing tools that read those logs directly:

| Tool / UI | Purpose |
|---|---|
| `session_search` | Keyword search across sessions; returns matching sessions with timestamps and excerpts |
| `session_read` | Dump one session's dialogue, optionally filtered by keyword |
| Sidebar entry | A magnifier row at the sidebar foot opens a search dialog |
| Shortcut | `Ctrl+Shift+K` (`Cmd+Shift+K` on macOS). Change it on the plugin page: Settings → Plugins → dsh-session-search → 修改 |

Both answer from **local files only** — nothing is uploaded. A local text cache is written under `~/.dsh/cache/dsh-session-search/` to keep later searches fast.

The dialog searches titles and message bodies together. Space-separated terms must all appear. Click a result to open the session; clicking a snippet scrolls to that hit and highlights it. When the hit is older than the loaded window, the plugin first uses DSH's turn rail to page to that turn, then falls back to scrolling history in (up to 5 s). If it still cannot find the text, the session stays open with a short notice.

The host serves the dialog through two same-origin read-only routes: `GET /session-search/query` and `GET /session-search/read`.

## Install / 安装

Requires a dsh build with the web client (0.2.x). Nothing else is needed: no npm package, no build step, no extra dependency.

**Desktop app.** Open Settings → Plugins, and install from the repository URL or the tarball URL below. Restart dsh afterwards so the browser half is scanned.

**CLI.** Pick one of the two specs:

```sh
# from the repository (pnpm fetches the codeload tarball)
dsh plugin add github:louisding9527/dsh-session-search

# or from the prebuilt Release tarball (no build step at all)
dsh plugin add https://github.com/louisding9527/dsh-session-search/releases/latest/download/dsh-session-search.tgz
```

Add `--profile <name>` when the target is not the default profile (`desktop` for the desktop app, `web` for a headless dsh).

**Plugin market.** Once the [listing PR](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/12514) is merged, search `session-search` in the market and click install.

**Local checkout** (development): point the profile at this directory.

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- insert:
    - id: session-search
      name: 'dsh-session-search'
      config: {}
```

The package's own `cordis.patch.yml` inserts the same row, so a bundle install needs no manual edit.

Restart dsh after a manual patch-layer edit. **The browser half is scanned when the host starts**, so restart dsh (or reload the page) before the sidebar entry and the shortcut appear — the host half, including the two routes, works immediately.

### After installing / 装完确认

The agent gets `session_search` and `session_read`. The UI gets a magnifier row at the sidebar foot. `Ctrl+Shift+K` opens the same dialog; rebind it on Settings → Shortcuts.

If the sidebar row is missing, the browser half did not load: restart dsh (not just the page) and check Settings → Plugins for a load error.

## Tools / 工具说明

### `session_search`

| Option | Default | Meaning |
|---|---|---|
| `query` | required | Keywords. Space-separated terms must all appear (AND), case-insensitive |
| `scope` | `auto` | `auto` scopes to the current project when known; `project` forces it; `all` searches every session |
| `cwd` | inferred | Override the project path |
| `since` / `until` | — | `YYYY-MM-DD`, filters on event time (inclusive) |
| `include` | `messages` | `messages` = user input + assistant text + titles + compaction summaries; `all` adds reasoning, tool calls, tool results and system prompts |
| `limit` | `10` | Max sessions returned (≤50) |
| `per_session` | `2` | Max excerpts per session (≤5) |
| `include_subagents` | `false` | Subagent sessions mostly restate their parent, so they are excluded by default |

Results are ranked by hit count. With a warm text cache, common keywords return in tens of milliseconds and a rare keyword that scans the whole history takes about 0.6 s (2,166 sessions, 317 MB on the development machine). Before the cache covers a file, that file is read the old way (whole-file decompression), so a first search over cold history takes about 3 s and fills the cache in the background.

### `session_read`

Takes a `session_id` (full or prefix), an optional `query` to keep only matching turns, and `max_chars` for the size cap.

## Cache management / 缓存管理

Open Settings → Plugins → `dsh-session-search`. The page shows the cache panel:

- **自动预热 / Auto warm**: on first install (or whenever less than half the sessions are cached), the host starts building the cache in the background about 5 s after startup. You normally do not need to click anything; searches stay responsive and use the old path until a file is covered.
- coverage: how many sessions are cached, total size against the cap, pending files, and the background queue;
- **增量更新 / Incremental**: enqueue every session once; cached files are skipped quickly, changed tails are appended;
- **重建缓存 / Rebuild**: clears body/metadata files (keeps the config), then warms the cache in the background. Searches stay available and fall back to whole-file scans while the cache is empty; a second click confirms;
- **缓存上限 / Cap**: set the cap in MB (20 MB–2 GB). Exceeding it prunes the oldest caches first.

The cap lives in `~/.dsh/cache/dsh-session-search/.config.json`. Deleting the whole directory is always safe; the cache rebuilds on demand.

## How it works / 实现要点

- **Decompression runs in a child process, never in the host.** DSH's embedded Node aborts the whole host when a zstd decompress stream is torn down without being initialised (`CompressionStream::Close` → `init_done_` assertion). The plugin keeps a small pool of persistent `process.execPath` workers with `ELECTRON_RUN_AS_NODE=1`, so a failure only costs one bucket of results.
- **Text cache.** Each session gets a `seq / turn / time / role / text` sidecar plus a metadata file. A cached file is scanned as plain text; only a missing or stale cache is decompressed. The cache is keyed by the source `mtime + size`, covers the default `messages` scope only, and defaults to a 200 MB cap (configurable 20 MB–2 GB on the plugin page; oldest entries are pruned first).
- **Warm-up happens after each Turn.** The host listens for `session/event` `turn/end`, debounces 1.5 s, and appends only the newly written frames. Historical sessions are cached lazily in a low-priority background queue the first time they are scanned.
- **Cancellation crosses the host.** Closing the dialog or typing a new query aborts the fetch; the route turns the closed response into an `AbortSignal`, cancels the child tasks, and kills any worker still decoding after 200 ms.
- **The jump uses DSH's own turn rail when available.** `openSession` has no message anchor, so the client waits for the chat, clicks the rail mark for the hit's turn, then scrolls to the matched text and highlights it with the CSS Custom Highlight API. If the rail is hidden or missing, it pages history by scrolling to the top, and reports when it gives up.
- Session logs are **multi-frame zstd**: one frame per batch of events, and Node's `zstdDecompressSync` only decodes the first frame. The plugin scans frame boundaries itself (`lib/core.js`).
- Files are bucketed round-robin over newest-first order, so an early stop covers the same time range across children.
- `messages` mode skips context injection: mnemon memory snapshots carry `source.kind: "dsh-mnemon"` instead of `"user"`, and system prompts / reasoning / tool output are excluded too — otherwise every search would match the injected memory first.
- Very large events (tool results) get a whole-line substring pre-check before `JSON.parse`.
- **The shortcut is owned by the plugin.** A `window` keydown listener is the primary path, so the dialog opens even when DSH's shortcuts service never registers the command. The chord lives in `localStorage` (`dsh.session-search.hotkey.v1`), and the plugin page records a new one in place — press the combination, it saves immediately. The recorder warns when the chosen chord collides with a known built-in action (`Ctrl+N`, `Ctrl+K`, `Ctrl+Alt+F`, `Ctrl+Shift+A`, `Ctrl+Alt+G`).
- The plugin also tries to register the command in DSH's own shortcut catalog, which would list it on Settings → Shortcuts. If that registration is rejected, only the plugin-owned listener remains, and the dialog still opens.
- **`messages` mode skips context injection.** Memory snapshots (`source.kind: "dsh-mnemon"`), system prompts, reasoning and tool output are excluded, so a keyword matches real dialogue instead of the preamble every turn carries — without that filter every query hits the injected memory first.

## Limitations / 已知限制

- Reads `.zstd` session logs only; the legacy plain `.jsonl` format is not supported.
- No inverted index — the fast path is a text cache (tens of MB). A rare keyword still scans every session's cached text (about 0.6 s here); only cold history pays full decompression.
- Plain substring matching: no wildcards, no regex, no tokenizer. Chinese needs no segmentation, which is why substring matching was chosen.
- Jump-to-hit depends on DSH's internal chat DOM (`data-chat-flow`, turn-rail marks). A DSH upgrade can disable the precise jump; the plugin then degrades to opening the session plus the auto-scroll fallback.
- `include=all` (tool calls/results, reasoning) is not cached and still pays the old whole-file scan.

## Development / 开发

```bash
node scratch/test-core.mjs "keyword"   # core search + timing
node scratch/test-digest.mjs           # text cache parity / incremental / repair
node scratch/test-pool.mjs             # persistent workers, cancellation
node scratch/test-http.mjs             # HTTP routes + abort
node scratch/test-host.mjs             # turn/end prewarm + tool wiring
node scratch/test-cache-api.mjs        # cache stats / incremental / rebuild / limit routes
node scratch/test-auto-warm.mjs         # install-time auto cache build
node scratch/test-client-load.mjs      # browser bundle + slot registration
node scratch/bench-search.mjs --warm   # warm-cache p50 baseline
node scratch/test-tool.mjs             # tool registration / execute / render
```

## License

MIT
