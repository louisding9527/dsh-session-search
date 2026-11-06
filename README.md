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

Both answer from **local files only** — nothing is uploaded, no index is built.

The dialog searches titles and message bodies together. Space-separated terms must all appear. Click a result to expand the matching turns inside the dialog.

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

Results are ranked by hit count. Files are dispatched newest-first and the search stops as soon as `limit` sessions matched — common keywords return in a few hundred milliseconds; a rare keyword scans the whole history (~1.7 s for 1,300 sessions).

### `session_read`

Takes a `session_id` (full or prefix), an optional `query` to keep only matching turns, and `max_chars` for the size cap.

## How it works / 实现要点

- **Decompression runs in a child process, never in the host.** DSH's embedded Node aborts the whole host when a zstd decompress stream is torn down without being initialised (`CompressionStream::Close` → `init_done_` assertion). The plugin spawns `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, so a failure only costs one bucket of results.
- Session logs are **multi-frame zstd**: one frame per batch of events, and Node's `zstdDecompressSync` only decodes the first frame. The plugin scans frame boundaries itself (`lib/core.js`).
- Files are bucketed round-robin over newest-first order, so an early stop covers the same time range across children.
- `messages` mode skips context injection: mnemon memory snapshots carry `source.kind: "dsh-mnemon"` instead of `"user"`, and system prompts / reasoning / tool output are excluded too — otherwise every search would match the injected memory first.
- Very large events (tool results) get a whole-line substring pre-check before `JSON.parse`.
- **The shortcut is owned by the plugin.** A `window` keydown listener is the primary path, so the dialog opens even when DSH's shortcuts service never registers the command. The chord lives in `localStorage` (`dsh.session-search.hotkey.v1`), and the plugin page records a new one in place — press the combination, it saves immediately. The recorder warns when the chosen chord collides with a known built-in action (`Ctrl+N`, `Ctrl+K`, `Ctrl+Alt+F`, `Ctrl+Shift+A`, `Ctrl+Alt+G`).
- The plugin also tries to register the command in DSH's own shortcut catalog, which would list it on Settings → Shortcuts. If that registration is rejected, only the plugin-owned listener remains, and the dialog still opens.
- **`messages` mode skips context injection.** Memory snapshots (`source.kind: "dsh-mnemon"`), system prompts, reasoning and tool output are excluded, so a keyword matches real dialogue instead of the preamble every turn carries — without that filter every query hits the injected memory first.

## Limitations / 已知限制

- Reads `.zstd` session logs only; the legacy plain `.jsonl` format is not supported.
- No persistent index — every search re-reads the files. Sparse hits pay for a full scan.
- Plain substring matching: no wildcards, no regex, no tokenizer. Chinese needs no segmentation, which is why substring matching was chosen.

## Development / 开发

```bash
node scratch/test-core.mjs "keyword"   # core search + timing
node scratch/test-tool.mjs             # tool registration / execute / render
```

## License

MIT
