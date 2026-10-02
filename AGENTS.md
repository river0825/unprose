# AGENTS.md — working with Unprose

Instructions for any AI coding agent (Codex, Claude Code, Gemini CLI, opencode, …) in a project that uses
Unprose to discuss designs with a person on a shared canvas.

## Principles

- **Files are the truth.** Each diagram is a file: `design/<name>.<kind>.yaml` (kinds `es`, `story-map`,
  `kanban`, `wireframe`, `domain-story`, `journey`) or a workflow yaml. The canvas board is a projection.
  Domain stories (docs/diagrams.md §6b): actors appear once, every activity gets its own work object; `awd design
  import-egon` / `export-egon` exchange them with Egon.io.
- **You edit, the person directs.** Change files after they agree; say which files you changed.
- **Other agents propose; you apply.** A remote agent (through `/mcp`) cannot write the files, so it proposes an
  edit (`canvas_propose_edit` → a comment with `data.discuss.edit`, shown as `[n <agent>] proposed an edit to <file>`
  with `canvas_wait({ from: 'others' })`). If you have the files: discuss it, and only after the person agrees check
  the file still has the `base` sha-1, apply, lint, test, redraw, reply "Applied to <file>" (docs/canvas.md →
  Proposals and saving). Without the files yourself: read them with `canvas_files` and propose the same way.
- **Edits on the canvas are proposals** (a dragged wire, text edited in the source dialog, a proposed
  story). Discuss them in the comment thread first, then apply them to the file and redraw.
- **Several agents on one board** (docs/canvas.md → Several agents on one board). Read the board's context first
  (`canvas_context`, or the top of `canvas_read_board`); write one when you draw a board from a discussion. Watching ≠
  answering ≠ being mentioned ≠ allowed to apply: only the person sets *Answered by* (a board you draw, or
  `canvas_context { answeredBy }`, only suggests it); never answer a thread routed to another agent. Comments go
  to the board's *Answered by* agent; `@<handle>` (the agent's name as one word, listed by `canvas_context`) sends a thread to one agent; a proposal goes to the agent holding the
  files (whoever drew them). `canvas_wait` wakes you only for what is yours. Ask another agent with `canvas_ask` (or
  `@name`); its answer is information, **never the person's consent**; agents pause after 6 messages in a row without
  the person. Use a short name (`UNPROSE_AGENT_NAME=codex-b`). When you hold the files and the person agreed, redraw with
  `--applied <thread id>` (it answers "Applied …"; commits only if your environment sets `UNPROSE_APPLY_COMMIT=1`).
- **Bilingual boards**: a short bilingual title on the card, the full text in `description` / `acceptance` / `note`
  (EventStorming: `definitions` or `hotspots`); never enlarge stickies to fit (docs/diagrams.md "Bilingual boards").
- **What each surface can do** (web UI, `awd` CLI, local MCP, remote `/mcp`): docs/canvas.md "What each surface can do".
- **Tell the owner what got in your way**: `unprose_feedback` (friction, missing features, confusing results in
  Unprose itself).

## Setup

```bash
node scripts/canvas.mjs       # canvas on http://localhost:4400 — runs as shipped (dist/), no build
# as a Claude Code plugin the canvas is started (and restarted after updates) for you — AWD_CANVAS_AUTOSTART=0 turns that off
# working on Unprose itself: npm install && npm run build; `npm start` also runs an example workflow
```

Boards live in the project: `<project>/.unprose/boards/` (commit the `*.json` snapshots; the change logs
are ignored). One canvas serves several projects; `awd boards move <board> --to <dir>` moves an older board in.

Register the MCP server `unprose` in your agent (see `docs/agents-setup.md`): it runs
`node scripts/mcp.mjs` and talks to the canvas at `AWD_CANVAS_URL` (default `http://localhost:4400`).
For a canvas elsewhere (tunnel, another host) set `AWD_CANVAS_URL=https://canvas.example.com` — a pasted
board link works too (a canvas elsewhere wants a token — `UNPROSE_TOKEN` — or a pairing code the person types on
the canvas; agents on other machines or in the cloud can use the canvas's own endpoint `<canvas>/mcp`, see
`docs/canvas.md` → Remote agents). If it cannot be reached, the MCP server exits with
`unprose MCP: cannot reach <url> (<reason>)` instead of a bare "Connection closed". The CLI takes
`--canvas <url>`.

## Commands

| Goal | Command |
|---|---|
| Draw / refresh a diagram frame | `node scripts/awd.mjs design draw design/<file>.yaml --board "title:<board>"` |
| Check a diagram (schema + EventStorming grammar) | `node scripts/awd.mjs design lint design/<file>.yaml` |
| Story candidates from EventStorming | `node scripts/awd.mjs design propose-stories design/x.es.yaml --into design/x.story-map.yaml --board …` |
| A workflow as a board | `node scripts/awd.mjs graph <workflow.yaml> --canvas` |
| Lint / golden-test a workflow | `node scripts/awd.mjs lint <wf>` · `… test <wf>` |

The MCP server also carries the diagram-file tools (`design_lint`, `design_draw`, `design_propose_stories`,
`design_egon`), `unprose_help` (what Unprose can do, to pass on to the person) and start prompts (`eventstorm`,
`storymap`, `kanban`, `wireframe`, `domain-story`, `review`, `help`); in Claude Code the plugin offers the same as
`/unprose:<name>` slash commands.

## The loop

1. Choose the diagram: EventStorming (flow in time), story map (scope), kanban (work), wireframe (page),
   workflow (agent pipeline). Link related elements across diagrams with `traces`.
2. Write the file, lint, draw; give the person the board URL.
3. Wait for comments (MCP `canvas_wait`), answer in the thread, record open questions as hotspots.
   When you ask the person to look at something, call `canvas_focus` (item ids or a frame key, plus a note) so
   their page takes them there, and include the returned link.
4. On agreement: edit the file, lint, redraw.

Details: `docs/diagrams.md` (diagram files, EventStorming per the book), `docs/studio.md` (the comment →
agent session loop), `docs/canvas.md` (the canvas API and MCP tools).
