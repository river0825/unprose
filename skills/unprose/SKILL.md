---
name: unprose
description: Discuss a design with the person on a shared visual canvas instead of long prose — EventStorming, user story maps, kanban, wireframes and workflows, each backed by a YAML file you edit. Use when the person wants to explore a system's flow, decide scope, plan work, sketch pages, or understand/change an agent workflow, or says "draw it", "put it on the board", "let's EventStorm this", "story map", "wireframe", "show me the workflow".
---

# Unprose — talk designs through on a canvas

Pictures align people and agents faster than paragraphs. Unprose gives you a canvas the person can see
and annotate, and a rule set that keeps it honest:

- **Files are the truth.** Every diagram is a file under `design/` (or a workflow yaml). The board is a
  projection of it; redraw after every change.
- **You are the editor, the person directs.** Change files when they agree; say what you changed.
- **Canvas edits are proposals.** A wire the person drags, text they edit in the source dialog, a story
  the tool proposes — discuss it in the thread, then apply it to the file.

## Tools

- MCP server `awd-canvas` (this plugin registers it): `canvas_create_board`, `canvas_add_items`,
  `canvas_read_board`, `canvas_diff`, `canvas_wait`, `canvas_focus`, `canvas_list_boards`, `canvas_open`, `canvas_apply`.
  It needs a running canvas server. As a plugin, it is started for you at the start of each session (and
  restarted on the new version after a plugin update); a note in the session says so if it had to act. If
  none is running (e.g. the `canvas_autostart` option is off), start it in the background from the plugin (or repo) root —
  two directories above this skill's directory: `node <root>/scripts/canvas.mjs` (http://localhost:4400). No install or build is needed; if the runtime is missing, `node
  <root>/scripts/ensure.mjs` fetches it for this version.

**Boards live in the project.** Boards you create are stored in the session's project at
`<project>/.unprose/boards/` (the plugin registers the project with a local canvas); commit
`.unprose/boards/*.json` with the project — the change logs are ignored by `.unprose/.gitignore`.
`canvas_list_boards` shows this project's boards (`all: true` for every project). Move an older board in
with `awd boards move <board id | title:…> --to <project dir>`.

**Canvas somewhere else** (a tunnel, another machine, `https://canvas.example.com`): set
`AWD_CANVAS_URL` to its address before the agent starts — a pasted board link (`…/b/<id>`) works too, the
origin is taken from it. If the MCP server cannot reach the canvas it exits with
`awd-canvas MCP: cannot reach <url> (<reason>)`; fix the URL or start the canvas, then restart the agent.
For the CLI, pass `--canvas <url>`.
- CLI `awd` (`node <root>/scripts/awd.mjs …`):
  - `awd design draw design/<name>.<kind>.yaml --board "title:<board>"` — draw/refresh one diagram frame
    (kinds: `es`, `story-map`, `kanban`, `wireframe`, `domain-story`, `journey`, `*.workflow.yaml`).
    A domain story tells one scenario as sentences (actor → verb → work object → receiver); move stories to and
    from Egon.io with `awd design import-egon` / `export-egon` (docs/diagrams.md §6b).
  - `awd design lint <file>` — schema + EventStorming grammar (with book page references).
  - `awd design propose-stories <es file> --into <story map file> --board …` — story candidates from
    EventStorming, drawn as dashed proposals (never written until the person accepts).
  - `awd graph <workflow.yaml> --canvas` — a workflow as a board; `awd lint` / `awd test` for workflows.

## The loop

1. Pick the diagram that fits: **EventStorming** for a system's flow (left → right in time; a system
   between a command and its event, a policy between an event and the next command), **story map** to
   decide scope (backbone → steps → stories, release cut lines), **kanban** for the work, **wireframe**
   for a page, **workflow** for an agent pipeline. Several can share one board; link them with
   `traces` (來自 derived-from / 組成 groups / 畫面 shows).
2. Write or edit the `design/*.yaml` file, `awd design lint` it, `awd design draw` it. Give the person
   the board URL and say what to look at.
3. When you ask the person to look at something, call `canvas_focus` with the item ids or the frame key (and a
   one-line note) so their page jumps there — don't make them search. Put the returned link in your reply too.
4. `canvas_wait` for their comments, moves and proposals; read the diff lines. Ignore pure layout moves.
5. Answer in the comment thread (`canvas_add_items` with a `comment` targeting their comment). Mark open
   questions as hotspots in the file rather than guessing.
6. When they agree, edit the file, lint, redraw — dashed proposals become solid.

## Studio (optional)

`awd studio --project <repo>` watches every board of the project: each comment the person writes opens or
continues a Claude Code session in a herdr tab, briefed on the selection, the diagram's grammar and the
files behind it. See `docs/studio.md` and `docs/diagrams.md`.
