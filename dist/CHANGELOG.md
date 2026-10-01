# Changelog

All notable changes to Unprose. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/) (while below 1.0, a minor bump may change
behaviour). Each released version is tagged `vX.Y.Z` on GitHub, with these notes as the release text.

## [Unreleased]

## [0.6.7] — 2026-10-01

### Changed
- Hovering a block no longer fades or highlights wires; only selecting a block brings its wires forward.

## [0.6.6] — 2026-10-01

No changes: a mistake in the release script published this version without its change (the hover change,
now in 0.6.7). It runs the same code as 0.6.5.

## [0.6.5] — 2026-10-01

### Changed
- Clicking a connected block or wire in the side panel (Connected, Wiring, traces) now shows it on the board — the
  view moves there and it flashes — and the panel stays on what you were reading. The small **›** beside the link
  opens that item's details instead.

## [0.6.4] — 2026-10-01

### Changed
- **Wires are easier to follow.** Workflow boards are laid out in proper layers: loops no longer push half the graph
  to the far right, and blocks in a column are ordered to cut crossings. Every wire leaves its block on the side
  facing its target (unless a side was set), wires sharing a side are spread apart instead of overlapping, turns run
  in the gaps between blocks, loops go round over or under, and labels sit on their own wire, not on a block. This
  changes how wires look on every board. Your layout is kept: routing is worked out when drawn, nothing is stored.
- Hovering a block fades the wires that do not touch it.

### Fixed
- A script block whose command reaches outside the workflow's folder (`python3 ../scripts/coordinator_state.py
  release {{ key }}`) now shows that script: View, Edit and Ask AI work on it like on any other file. Any file inside
  the repo counts (never one outside it); quotes, flags and `--opt=<path>` are looked through. Redraw the workflow
  board (`awd graph <workflow.yaml> --canvas`) to pick it up.

## [0.6.3] — 2026-10-01

### Fixed
- **Updating from a terminal restarts the canvas.** `claude plugin update unprose@unprose` run outside a session left
  the canvas on the old version until the next session, because Claude Code runs nothing after an update. A canvas
  running from the plugin now watches Claude Code's install record and, within about ten seconds of an update,
  restarts on the new version by itself — same port, same boards, the open pages reconnect. If the new version does
  not come up, the old one keeps serving. (`UNPROSE_FOLLOW_INSTALLED_MS=0` turns it off.) A canvas older than this
  version has to be restarted once to start following.

## [0.6.2] — 2026-10-01

### Added
- Pointing at a block, wire or element in the side panel (Connected, Wiring, traces, chat chips, the change
  list) lights it up on the board too — an outline on a block, a thick blue line on a wire — so you can see which
  one it is without selecting it. Keyboard focus on the link does the same.

## [0.6.1] — 2026-10-01

### Added
- **View and edit a script from its block.** A workflow script block shows a `‹/› <file>` button on the canvas
  (a double-click on the block does the same) that opens the script in the large editor, and the Inspector's
  Source section has **View** and **Edit** buttons; Edit opens it ready to type. As before, an edit is sent to
  the AI as a proposal, reviewed with you in the thread, then applied to the file. A step whose command names no
  file gets View / Edit on its command, opening the workflow yaml at the step's lines.

## [0.6.0] — 2026-10-01

### Added
- **Slash commands** in Claude Code: `/unprose:help`, `/unprose:eventstorm <topic>`, `/unprose:storymap`,
  `/unprose:kanban`, `/unprose:wireframe <page>`, `/unprose:domain-story <topic>`, `/unprose:review`. Type
  `/unprose:` to see what Unprose can do; each one starts the conversation the right way. Codex and other MCP
  clients get the same as MCP prompts.
- **`unprose_help`** MCP tool: what Unprose can do — the diagrams, the tools, the comment loop, the ways to
  start — so an agent can answer "what can Unprose do?" in your language.
- **Diagram-file tools over MCP:** `design_lint`, `design_draw`, `design_propose_stories` and `design_egon`
  (Egon.io import / export), the same as `awd design …`, so agents without the CLI (Codex, other MCP clients)
  can check, draw and propose too. The MCP server is now `awd mcp` (`awd-canvas mcp` still serves the canvas
  tools alone).
- "Ask your agent" hints in the canvas: the board list shows what Unprose can do as sentences to copy into the agent
  (with the matching `/unprose:…` slash commands), and an empty board shows a short version until it has items.

### Changed
- The MCP server is called **`unprose`** (was `awd-canvas`), matching the plugin, and its instructions now say
  what Unprose is for. Tool names change with it (in Claude Code `mcp__plugin_unprose_unprose__…`), so a
  permission rule written for `awd-canvas` must be renamed; outside the plugin, register it again as
  `unprose` (`claude mcp add unprose …`, `[mcp_servers.unprose]` for Codex).

## [0.5.2] — 2026-10-01

### Fixed
- A canvas started with a relative path from the plugin folder (`cd <plugin> && node scripts/canvas.mjs`) is
  now recognised and restarted after an update too; 0.5.1 resolved that path against the wrong folder. Its
  relative options (`--dir boards`) are kept, made absolute.
- The skill tells agents not to restart the canvas by hand after an update: `/reload-plugins` does it, and
  `node <plugin>/scripts/ensure.mjs` does the same on demand.

## [0.5.1] — 2026-09-30

### Fixed
- **A plugin update restarts the canvas even when it was started by hand.** Before, only a canvas the plugin
  had started itself was restarted; one an agent (or you) had started from the plugin folder kept running the
  old version after an update. Now a canvas running the plugin's own code, from any of its installed versions,
  is restarted on the new version with the same options (`--dir` …). A canvas started from a checkout or any
  other folder is still left alone.

## [0.5.0] — 2026-09-30

### Added
- **Upgrade from the canvas:** the version button says **update** when a newer release is out (checked
  server-side against GitHub, cached 6 h; a private repo is checked with `GITHUB_TOKEN` / `GH_TOKEN` or the
  `gh` login), and the release notes dialog shows its notes with **Upgrade to v…**. Upgrade runs what fits the
  install — `claude plugin update unprose@unprose`, `git pull --ff-only` (+ `npm ci && npm run build` in a dev
  checkout, refused while tracked files are dirty), or a checksum-verified runtime download — then hands the
  port to the new version and the pages reconnect; if the new server does not come up, the old one keeps
  serving. Only from a page on the canvas's own machine (`POST /api/update` answers `403` through a tunnel).
  `GET /api/update`, `GET /api/update/status`; `UNPROSE_UPDATE_CHECK=0` turns it off.

## [0.4.1] — 2026-09-30

### Fixed
- Comments no longer join a frame: a comment could only move inside the frame of the item it was about. A
  comment now belongs to its target (the tether shows it), can sit anywhere on the board, stays where it is when
  the frame moves, and is not deleted with the frame; older comments that were stored inside a frame are freed too.

## [0.4.0] — 2026-09-30

### Added
- **Go to…** (`⌘K` / `Ctrl+K`, or the header button): search diagram frames and items by title, key or text and
  jump there. Links can open a board on a diagram frame (`?frame=<key>`; *Copy link* in the frame panel).
- **"Look here" from the agent:** the MCP tool `canvas_focus` (and `POST /api/boards/:id/focus`) shows "Agent
  wants to show you …" on the person's open page with **Go** / **Dismiss**; *Follow agent* jumps without asking.
  Nothing is stored on the board. The skill tells agents to use it whenever they ask you to look at something.
- **Boards live in their project:** a project's boards are stored in `<project>/.unprose/boards/` — the
  snapshots are meant to be committed with the project, the change logs stay local (a generated
  `.unprose/.gitignore` says so). One canvas server serves several projects on the same port and URL; the
  board list groups boards by project. Projects are registered by `awd-canvas serve --project <dir>`, the
  plugin (the session's project, at session start), and `awd design draw` / `awd graph --canvas` (the file's
  repo); `GET/POST /api/projects`, `?project=` and `project` on the boards API. `canvas_create_board` stores
  new boards in the session's project and `canvas_list_boards` lists them (`all: true` for every project).
- `awd boards move <board id | title:…> --to <project dir>` moves an older board (snapshot and log) into a
  project; the old files go only after the copy is in place.

### Changed
- Boards made before projects stay in the **personal** space (the server's `--dir`, default
  `~/.awd/boards`) and keep working; a title lookup still finds them. Registering a project or moving a board
  is only accepted from the canvas's own machine (no proxy/tunnel headers), since the canvas has no auth.

## [0.3.1] — 2026-09-30

### Added
- The plugin keeps itself runnable after an install or update: a SessionStart hook (and the MCP server when it
  starts) makes sure the runtime exists — the plugin's `dist/`, else this version's copy in the plugin data dir,
  else downloaded from the GitHub release and checksum-verified — and keeps a local canvas on the plugin's
  version: started if none answers, **restarted on the new version after `/plugin` update**, never touching a
  canvas you started or a remote one. `AWD_CANVAS_AUTOSTART=0` turns the canvas part off. Every release now
  carries `unprose-runtime-v<version>.tgz` (`scripts/release-assets.sh`, and a workflow as a safety net).
- `GET /api/version` also returns the server's `pid`, so the plugin can tell a canvas it started from yours.

### Fixed
- 0.3.0 installed without its runtime (no `dist/`), so the MCP server failed ("Failed to reconnect to
  plugin:unprose:awd-canvas") and the canvas had to be built by hand: the public `.gitignore`'s `dist/` +
  `!/dist/` re-include was not honoured by the plugin copy. The public repo no longer ignores the root `dist/`
  at all, and the export fails if any rule would (`git check-ignore`). Reported from real use in another project.
- The plugin's MCP server failed to start in every project ("Failed to reconnect to plugin:unprose:awd-canvas";
  its log: `Cannot find module '<your project>/scripts/mcp.mjs'`): the root `.mcp.json` used
  `${CLAUDE_PLUGIN_ROOT:-.}/scripts/mcp.mjs`, which Claude Code does not expand like a shell, so it resolved to
  the project directory. The server is now declared in `.claude-plugin/plugin.json` with plain
  `${CLAUDE_PLUGIN_ROOT}`, the public repo ships no root `.mcp.json`, and the export rejects any `${VAR:-…}`
  in plugin configs. New plugin options `canvas_url` and `canvas_autostart` replace the environment defaults.


## [0.3.0] — 2026-09-30

### Added
- A version button at the bottom of the rail opens the release notes (CHANGELOG.md, newest first); a dot marks a
  version you have not opened yet. The canvas serves them at `GET /api/version`.
- Frozen headers: a diagram frame's column and row titles (story-map activities / steps and releases, kanban
  columns, EventStorming swimlanes and phases) stay pinned to the top / left edge while you pan, lined up with
  the frame; "Freeze headers" in the frame panel turns it off per frame.
- Domain Storytelling as a diagram kind (`design/<name>.domain-story.yaml`), drawn like domainstorytelling.org /
  Egon.io pictures: pictogram actors (each once, placed freely) and work objects, numbered activity arrows with the
  verb on the line, groups, annotations, scope, a grammar check, the sentence read out in the Inspector;
  `awd design import-egon` / `export-egon` exchange stories with Egon.io, and `awd design propose-stories` turns a
  domain story's sentences into story-map proposals.
- **Copy as image** (right-click menu, ⌘⇧C / Ctrl+Shift+C): the selection — a frame with its contents and the
  wires between captured items — as a 2× PNG on the clipboard, falling back to a download. Right-clicking inside a
  multi-selection now keeps it, so the menu acts on all of it.

## [0.2.0] — 2026-09-29

### Added
- Links in item text and descriptions are clickable: bare `http(s)://` / `mailto:` URLs and Markdown
  `[label](url)`. A click opens a new tab without selecting or dragging the item.
- Kanban cards join the trace graph: every card and column carries `data.element`; cards take `traces`
  and a `stories: ['<story map key>/<story id>']` shorthand, drawn as 組成 (groups) trace wires.
- A public README with a demo GIF, a first-session walkthrough and screenshots, plus a Traditional
  Chinese translation (`README.zh-TW.md`).
- Traces can point at a whole diagram (`from: '<diagram key>'`, e.g. a card standing for a sub-board), link two
  elements of the same diagram, and use the general relation `relates` (相關) (#7).
- `awd design lint` checks kanban, wireframes and journeys offline too, and a YAML error caused by an unquoted
  `#` inside `[ … ]` explains itself: quote values containing `#` (#9).
- `awd design lint` and `awd design draw` warn about fields a diagram does not know (``unknown field `link` at
  cards[1]``) instead of dropping them silently (#8).
- CI on Ubuntu and macOS (Node 20, 22) with `npm ci`, build and tests; `docs/releasing.md`.

### Changed
- The zod trace schema is shared by EventStorming, story maps and kanban.

### Fixed
- `npm install` works on Linux: the root `package.json` no longer lists a flattened macOS dependency tree
  (with the macOS-only `fsevents`); workspaces declare what they import, and the lockfile covers every
  platform (#2).
- Boards are no longer stored inside the plugin install, where a plugin reinstall deleted them: the default
  is `$AWD_BOARDS_DIR`, else `$XDG_DATA_HOME/awd/boards`, else `~/.awd/boards`; the server warns when
  `--dir` points into a `plugins/cache` folder. A save that fails recreates a deleted boards folder and
  retries; if it still fails, the page shows "Changes are not being saved" (#1).
- Traces into diagrams drawn before `data.element` existed are drawn again (found by the id convention), and
  `awd design draw` lists every trace it still cannot draw instead of dropping it silently (#6).
- The MCP server says why it cannot start: it checks the canvas at startup and exits with
  `awd-canvas MCP: cannot reach <url> (<reason>)` instead of a bare "Connection closed";
  `AWD_CANVAS_URL` accepts a pasted board link. Remote canvases are documented (#5).
- Releases bump the plugin version, so `claude plugin update` picks up new code: `scripts/version.mjs <new>`
  sets it in every manifest and cuts the release notes; `npm test` and CI fail when the versions disagree
  or when shipped files changed since the last tag without a bump (#3).
- The plugin runs as installed: the published repository ships a bundled runtime in `dist/` (CLI, canvas +
  MCP server, web UI), so there is no `npm install` / `npm run build` step. New launchers
  `scripts/canvas.mjs` and `scripts/awd.mjs` use it, falling back to a dev checkout's build, and say how to
  fix a missing build (#4).

## [0.1.0] — 2026-09-29

First public version.

### Added

**Canvas: boards people and agents share**
- A board server (HTTP + WebSocket) with templates for EventStorming, user story maps, user journeys,
  wireframes, kanban and agent workflows; an MCP server (`awd-canvas`) so agents can draw, read, diff and
  wait for changes.
- **Diagram frames:** several kinds of diagram on one board, each frame backed by a file in the repo
  (`design/<name>.<kind>.yaml`). Redraws keep the person's layout, keep pending proposals, remove stale
  items and grow a frame that was never resized.
- **EventStorming per *Introducing EventStorming*:** the book's colours (purple hotspots), command →
  system → event → policy grammar, branches, read models, milestones, votes, values, definitions, a drawn
  legend, a grammar check with page references, and a left → right timeline layout.
- **Story maps** with stable ids, acceptance criteria, release cut lines and trace wires; stories
  **proposed from EventStorming** (person + command → story, events and read models → acceptance), drawn
  as dashed proposals until accepted.
- **Traces** between diagrams (來自 derived-from · 組成 groups · 畫面 shows), labels shown on selection.
- **Workflow boards:** every block explains itself in an **Inspector** — agent persona and settings, the
  exact AI prompt, gate rules in plain words, script source, its yaml, and Wiring (each event with the
  block on its other end). Wires are events; editing a wire becomes a **proposal** for the AI to review.
- **Chat:** chat with one item, a selection, or the whole board; a **Chats** tab with every chat;
  **line comments** on files, prompts, personas and scripts; a **source dialog** (CodeMirror, syntax
  highlighting) whose edits are sent to the AI as a diff; read receipts (Sent · Seen by agent · Working ·
  Needs you).
- Comment threads tether to the item they are about; the side panel is resizable; wire labels stay above
  wires; selected wires come to the front.

**Studio: an agent session behind the board**
- `awd studio --project <dir>` turns every comment on a watched board into a Claude Code session in a
  herdr pane: one session per board, forks for concurrent requests, a pane limit with a queue, idle close
  and `--resume`. The canvas server can start and stop it for allow-listed projects.

**Workflow runtime (`awd`)**
- Workflows as data (`workflow.yaml`): triggers (webhook, cron, board), script / ai / gate / human steps,
  retries and timeouts, `*.failed` listeners, agents with their own model, tools and runner (Claude Code,
  Anthropic API, CLI agents, herdr panes), short- and long-term memory, reflection signals and
  `awd reflect`; an event log with a pure reducer, golden tests, lint, a live run overlay on the board.
- `awd design draw | lint | propose-stories` for diagram files, including workflow files as frames.
- A WorkTracker port (canvas kanban, a `tasks.md` file); board triggers can point at a frame key.

**Packaging**
- A plugin for Claude Code (skill + MCP server) and setup for Codex and other MCP clients (`AGENTS.md`,
  `docs/agents-setup.md`). Apache-2.0.

[Unreleased]: https://github.com/river0825/unprose/compare/v0.6.7...HEAD
[0.6.7]: https://github.com/river0825/unprose/compare/v0.6.6...v0.6.7
[0.6.6]: https://github.com/river0825/unprose/compare/v0.6.5...v0.6.6
[0.6.5]: https://github.com/river0825/unprose/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/river0825/unprose/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/river0825/unprose/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/river0825/unprose/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/river0825/unprose/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/river0825/unprose/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/river0825/unprose/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/river0825/unprose/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/river0825/unprose/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/river0825/unprose/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/river0825/unprose/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/river0825/unprose/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/river0825/unprose/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/river0825/unprose/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/river0825/unprose/releases/tag/v0.1.0
