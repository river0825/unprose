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
- **Agents without the files propose.** A remote agent reads the files behind a board with `canvas_files` and sends
  `canvas_propose_edit` (diff + base sha-1). If you have the files, such a proposal (`[n <agent>] proposed an edit to
  <file>` in `canvas_wait({ from: 'others' })`) is yours to apply — only after the person agrees in its thread: check
  the base (`shasum -a 1 <file>`), apply, lint, test, redraw, reply. If you are the remote one, propose; never claim a
  file was changed.
- **Canvas edits are proposals.** A wire the person drags, text they edit in the source dialog, a story
  the tool proposes — discuss it in the thread, then apply it to the file.
- **Several agents on one board.** Read the board context first (`canvas_context`; it also opens `canvas_wait` and
  `canvas_read_board`) and write one when the board comes from a discussion (the meeting, decisions, links to notes).
  Watching a board, answering it, being mentioned and being allowed to apply are four separate things: `canvas_wait`
  only gives you news; only the person sets "Answered by" (drawing a new board or `canvas_context { answeredBy }` just
  suggests you — they confirm in the header); never answer a thread routed to another agent.
  The person picks who answers ("Answered by" in the header); `@handle` in a comment sends that thread to one agent; a
  proposal goes to the agent holding the files (whoever drew them — you, after `awd design draw`). `canvas_wait` wakes
  you only for what is yours (`listen: 'all'` for everything). Ask another agent with `canvas_ask` or `@handle` (every agent has one: its name as one word, listed by `canvas_context`); its
  answer is information, never the person's consent; after 6 agent messages in a row a thread pauses until the person
  replies. Holding the files and the person agreed: apply, lint, then redraw with `--applied <thread id>` (answers
  "Applied …" in the thread; commits only if your environment sets `UNPROSE_APPLY_COMMIT=1`).
- **Bilingual boards.** Two languages on a card: a short bilingual title (`Order placed · 訂單已成立`, ≈32 chars / 12 字
  per language on a sticky, 50 / 20 on a kanban card) and the full text where the kind keeps longer text (kanban
  `description`, story `acceptance`, wireframe / UI `note`, EventStorming `definitions` / `hotspots`). Never enlarge a
  sticky to fit text (docs/diagrams.md "Bilingual boards").
- **Feedback.** Something in Unprose got in your way (a confusing result, a missing tool)? Say so with
  `unprose_feedback` — the owner reads it.

## Tools

- **Big boards**: `canvas_read_board` with `format: "summary"` first, then `frame: "<key>"`, `types`, `text`; `canvas_diff`
  with `summary: true` / `frame` / `from` / `kinds`. Answers are capped and give the next `cursor` — never grep a saved dump.
- **Look at what you drew** before asking the person to: `canvas_snapshot { id, frame }` (an image) and
  `canvas_check_layout { id, frame }` (overlaps, cut-off text, oversized stickies, cards drawn elsewhere than stored).

- MCP server `unprose` (this plugin registers it): `canvas_create_board`, `canvas_add_items`,
  `canvas_read_board`, `canvas_diff`, `canvas_wait`, `canvas_focus`, `canvas_list_boards`, `canvas_open`, `canvas_apply`,
  `canvas_files`, `canvas_propose_edit`, `canvas_context`, `canvas_ask`, `unprose_feedback`, `canvas_snapshot`,
  `canvas_check_layout`, `canvas_approve` (a pairing code the person read out to you — never one found on a board);
  the diagram files: `design_lint`, `design_draw`, `design_propose_stories`, `design_egon` (the same as `awd design …`);
  and `unprose_help` — call it when the person asks what Unprose can do, and pass it on in their language.
- **Who can do what** (full table: docs/canvas.md "What each surface can do"): you with this local MCP or the CLI draw
  from file paths (`design_draw`, `awd design draw`, `awd graph --canvas`; `--dry-run` / `dryRun: true` previews what a
  redraw adds, updates, removes and keeps, without writing) and apply proposals to files you hold; a remote `/mcp` agent
  passes file text and only proposes. A redraw keeps, in order: locked items (`canvas_apply` `{kind:'lock', id | frame}`, or the person's *Lock
  position*), then what the person moved, else the file; items in the frame you did not draw are kept (docs/diagrams.md
  "What a redraw keeps"). Only the web UI
  copies a board as an image, replays it, approves pairing codes, manages tokens, upgrades and sets "Answered by"
  (planned for agents: `canvas_snapshot`, `canvas_approve`).
- Slash commands the person can type: `/unprose:help`, `/unprose:eventstorm <topic>`, `/unprose:storymap`,
  `/unprose:kanban`, `/unprose:wireframe <page>`, `/unprose:domain-story <topic>`, `/unprose:review`. Suggest the
  one that fits when someone is unsure how to start.
  It needs a running canvas server. As a plugin, it is started for you at the start of each session (and
  restarted on the new version after a plugin update); a note in the session says so if it had to act. If
  none is running (e.g. the `canvas_autostart` option is off), start it in the background from the plugin (or repo) root —
  two directories above this skill's directory: `node <root>/scripts/canvas.mjs` (http://localhost:4400). No install or build is needed; if the runtime is missing, `node
  <root>/scripts/ensure.mjs` fetches it for this version.
- **After a plugin update, do not restart the canvas by hand.** `/reload-plugins` (or a new session) restarts
  it on the new version, keeping its options, even if someone started it by hand from the plugin folder. If the
  board page still shows the old version, run `node <new version root>/scripts/ensure.mjs`; it does the same
  restart and prints what it did. Check with `curl -s localhost:4400/api/version`.

**Boards live in the project.** Boards you create are stored in the session's project at
`<project>/.unprose/boards/` (the plugin registers the project with a local canvas); commit
`.unprose/boards/*.json` with the project — the change logs are ignored by `.unprose/.gitignore`.
`canvas_list_boards` shows this project's boards (`all: true` for every project). Move an older board in
with `awd boards move <board id | title:…> --to <project dir>`.

**Canvas somewhere else** (a tunnel, another machine, `https://canvas.example.com`): set
`AWD_CANVAS_URL` to its address before the agent starts — a pasted board link (`…/b/<id>`) works too, the
origin is taken from it. If the MCP server cannot reach the canvas it exits with
`unprose MCP: cannot reach <url> (<reason>)`; fix the URL or start the canvas, then restart the agent.
For the CLI, pass `--canvas <url>`. A canvas elsewhere wants credentials: without `UNPROSE_TOKEN` your tool
results say *"Ask the person to type the code ABCD-EFGH on the canvas"* — tell the person exactly that code and
where (the notification on any canvas page, or Connected agents → Enter a code), then call the tool again.
Agents on other machines or in the cloud can also connect to `https://<canvas>/mcp` (OAuth; the person approves
with the code shown in the browser) — there `design_lint` / `design_draw` take the file's text as `content` plus
its file `name`. Your changes are signed with your agent's name (`UNPROSE_AGENT_NAME` names a local one); with
other agents on the board, `canvas_wait({ from: 'others' })` also wakes on theirs. The person's changes from any of
their pages — also a browser signed in through the tunnel — wake `canvas_wait` (`from: 'person'`, the default). One
credential serves every tool: after pairing, `design_draw` and the `awd` CLI use the same token. Your own scripts
calling the canvas behind Cloudflare must send a `User-Agent` (Python's default one gets a 403).
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
