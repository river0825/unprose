# Diagrams — several kinds on one board, each backed by a file

Unprose helps people and AI agents talk designs through. A designer's chain is
**EventStorming → User Story Mapping → a work tracker (kanban, Trello, Jira, a text file)**, with
**wireframes** explaining pages and **Domain Storytelling** as an optional way in. These diagrams are
related, so they live side by side on one board, joined by trace links, and every one of them is backed by a
file the agent edits — the same rules as the workflow board (docs/studio.md): **files are the truth, the AI
is the editor, the person directs, edits on the canvas are proposals.**

## 1. Diagram frames

A board is a space. A **diagram frame** is a `frame` item whose `data.diagram` says what it holds:

```ts
data.diagram = {
  kind: 'event-storming' | 'user-story-map' | 'kanban' | 'wireframe' | 'workflow' | 'domain-story' | 'user-journey',
  key: string,        // stable, human-readable, unique on the board: 'studio-es'. Made once, survives renames.
  source?: string,    // repo-relative file behind it: 'design/studio.es.yaml' (workflow: the workflow yaml)
  level?: string,     // event-storming: 'big-picture' | 'process' | 'software'
}
```

- One kind per frame. Items drawn from the frame's file are its children (`parent` = frame id) with ids
  scoped by the key: `<key>.<role>.<element id>`.
- Moving a frame moves its children; resizing a frame never re-lays out its content. Layout is only
  computed when an element is drawn for the first time; after that the board keeps where the person put it.
- **Legacy boards need no migration.** A board whose `kind` is not `freeform` behaves as if its top-level
  items were one diagram of that kind with key = the board kind. New boards are `freeform` and hold frames.
  Everything that used to key off `board.kind` (templates, kanban column logic, workflow meta, studio,
  board triggers) asks "which diagram is this item in?" — the nearest ancestor frame with `data.diagram`,
  else the legacy board kind.
- `POST /api/boards/:id/template` accepts `{ kind, content, frame?: { key, title?, source?, level?, at? } }`:
  with `frame`, the items are drawn inside that diagram frame (created if missing, ids scoped by the key).

## 2. Files: `design/<name>.<kind>.yaml`

Each non-workflow diagram frame is backed by one YAML file under `design/` in the host project. The
content is the template's schema (zod-validated), extended with **stable element ids** and **trace links**.

- The filename names the diagram: `<kind>` is `es`, `story-map` (or `usm`), `kanban`, `wireframe`,
  `domain-story`, `journey`; the **key is `<name>-<kind>`** — `design/studio.es.yaml` → `studio-es`,
  `design/studio.story-map.yaml` → `studio-story-map` — so the diagrams of one topic never clash on a board.
  Top-level `key:`, `kind:` and `title:` in the file win over the filename and are not template content.
- A **workflow** file (`<name>.workflow.yaml`, or any file with top-level `steps:`) is drawn with the
  runner's own projection (graph + block details) into a `workflow` frame keyed `<name>-workflow`; its
  `key:` stays the run-key template, and `awd design lint` runs `awd lint` on it. `--at x,y` places a new frame.
- Every element has `id` (optional in the file; default = slug of its text). References between
  elements use ids; a text reference still works when unambiguous (older content).
- `traces: [{ from: '<diagram key>/<element id>', rel: 'derived-from' | 'groups' | 'shows' }]` on any
  element points into another diagram (usually on the same board). Drawn as dotted trace wires
  (`role: 'trace'`, label 來自 / 組成 / 畫面), never as flow.
- `awd design draw <file> --board <id | title:…> [--canvas URL]` draws or refreshes the frame. A redraw keeps
  what the person placed, keeps receipts, removes stale items **inside that frame only**, and keeps items
  holding a pending proposal until the file explains them (the workflow redraw rules, scoped to the frame).
- `awd design lint <file>` validates the schema and the diagram's grammar (§3); the board shows the same
  findings on the frame.
- Board meta records the project: `meta.project = { root: <abs repo root> }`, and per frame the files
  snapshot as for workflows (`meta.diagrams[<key>] = { source, files }`).

## 3. EventStorming, as the book describes it

Source: *Introducing EventStorming* (Brandolini). Page numbers are the book's printed ones.

- Levels: `big-picture`, `process`, `software` (p.24-25). Colours (legend drawn on the frame, p.314):
  event **orange** (past tense), command **blue**, policy **lilac**, read model **green**, person **small
  pale-yellow**, system **pink** (large), hotspot **purple** (a new `purple` colour token), opportunity
  **green**, value **green (+) / red (−)**, arrow vote **blue**, aggregate **large pale-yellow** (software).
- Grammar (p.202): *a system between a command and an event; a policy between an event and a command.*
  Events come from a person's action, an external system, time, or another event via a policy (p.208).
  Read models: events update them, they inform people (who issue commands) (p.200-202).
- Elements in the file: `events` (with `pivotal`, `time`, `lane`, `phase`), `commands` (`by` person,
  `system`, `produces` events — several = branches, happy path first), `policies` (`when` events, `then`
  commands, optional `person`), `readModels` (`updatedBy` events, `informs` people/commands), `people`,
  `systems`, `hotspots` (`on` element, `kind?`), `opportunities`, `values`, `votes`, `milestones`,
  `phases` (frames/labels for bounded contexts or chapters), `definitions`, `aggregates` (software level,
  **instead of** the timeline grouping — the book: the two are orthogonal, p.21).
- Grammar check (pure, shared by `awd design lint` and the web): command with no system; event → command
  with no policy; event with no source; read model nobody uses; open hotspots (count = the "not done yet"
  signal, p.199); pivotal events on a process board. Findings carry an element id and a page reference.

## 4. From EventStorming to a story map (our rule — the book gives none)

The book only says a story's acceptance can be *the events it produces and the read models it shows*
(p.279). Our proposal, to try and adjust:

- a **person + command** (big-picture: a person's action) → a **story candidate** "As <person> I
  <command>", acceptance = the events it produces + the read models it shows;
- **pivotal events / phases** → **backbone activities**, in timeline order; the commands between two pivotal
  events → the **steps** under that activity;
- every proposed story carries `traces: [{ from: 'studio-es/<command id>', rel: 'derived-from' }]`.

`awd design propose-stories <es file> --into <story map file>` computes the candidates (pure function)
and draws them on the story-map frame as **pending** items (`data.pending = { kind: 'add', … }`, dashed)
— nothing is written to the story-map file until the person accepts (the studio session writes it, as
with wire proposals). Stories already present (same trace) are not proposed again.

## 5. Story map

`user-story-map` file: `activities[{ id, text, steps[{ id, text, stories[{ id, text, release?,
acceptance?: string[], traces? }] }] }]`, `releases: string[]` (drawn as horizontal cut lines, top to
bottom; "Later" last). The cut line decides scope: stories above the first line are Release 1.

## 6. Work tracker (not only Trello)

"Several related stories become one card" goes through a **WorkTracker port** (runtime):
`list() / upsert(card) / move(cardId, column)`, card = `{ id, title, description?, stories: [trace],
column, labels? }`. Adapters now: **canvas kanban frame** (the existing kanban / cards API; columns are resolved inside the
kanban frame and passed to the server by id, so two kanbans with a "Backlog" each never mix) and a **text
file** (`design/<key>.tasks.md`: `<!-- columns: … -->` under the title, then one `##` per card with
`<!-- card: <id> · column: <name> · labels: … -->` and an optional `stories:` line; the rest is the description). Trello, Jira, Linear later — same port. A card's
`stories` are `groups` traces back to the story map.

## 7. Board triggers point at a frame key

`triggers.<id>: { on: board, board: "title:…" | <id>, frame?: <diagram key>, … }`. The trigger only turns
card moves from or into a column of that kanban diagram into events; `frame` may be omitted when the board holds exactly one
kanban diagram (the legacy dev board keeps working). Columns are still matched by their text.

## 8. Studio per project, one session per board

- **Every comment reaches the agent while studio runs** (docs/studio.md §2): a plain root comment is a chat
  about its target (default model), a reply goes to its chat's session when that session is idle (held in
  order, never forked, while it works), a reply on an old plain thread opens a chat on its root. Agent
  comments never count; an empty comment counts from the first change that gives it text.
- One `awd studio` process per **project** (repo root): `awd studio --project <dir>` serves every board
  whose `meta.project.root` (or `meta.workflow.file`) is inside it. `awd studio <workflow.yaml>` still
  works (project = its repo). The canvas server's allow-list becomes `--studio-project <dir>` (repeatable;
  `--studio <file>` still accepted and means its project). The Studio control shows on **any** capable
  board.
- **Sessions are per board.** A board's chats go to that board's session (`claude --session-id`, resumed
  with `--resume` after idle-close). A request that arrives while the board session is busy runs in a
  **fork** of it (`claude --resume <board session> --fork-session`), sharing its context and prompt cache;
  a fork closes when its chat goes idle. The pane limit and FIFO queue still apply per project.
- On start, studio may warm a board session by prompting it to read the board's design files once.
- The brief names the diagram(s) the selection is in: kind, key, source file, the grammar for that kind,
  and the elements traced to/from the selection in other frames.
- "New session" on the board (a button) drops the board session so the next chat starts fresh.
