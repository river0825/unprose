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
- `traces: [{ from: '<diagram key>/<element id>' | '<diagram key>', rel: 'derived-from' | 'groups' | 'shows' | 'relates' }]`
  on any element points at an element of another diagram (usually on the same board), at an element of its
  own diagram, or — with just `'<diagram key>'` — at a whole diagram (its frame; e.g. a kanban card standing
  for a sub-board). `relates` (相關) is the general link when none of the others fits. Drawn as dotted trace
  wires (`role: 'trace'`, label 來自 / 組成 / 畫面 / 相關), never as flow. A target is found by
  `data.element`, else by the id convention `<key>.<role>.<element id>` (items drawn before a template set
  `data.element`); `awd design draw` lists every trace it could not draw instead of dropping it.
- `awd design draw <file> --board <id | title:…> [--canvas URL]` draws or refreshes the frame. A redraw keeps
  what the person placed, keeps receipts, removes stale items **inside that frame only**, and keeps items
  holding a pending proposal until the file explains them (the workflow redraw rules, scoped to the frame).
- `awd design lint <file>` validates every kind that has a schema, offline (EventStorming also gets its grammar,
  §3; the board shows the same findings on the frame). Fields the schema does not know are warnings
  (`unknown field \`x\` at cards[2]`), on lint and on draw, instead of being dropped silently. A YAML parse
  error caused by an unquoted `#` inside `[ … ]` says so (quote values containing `#`).
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

### Frozen headers

Like freeze panes in a spreadsheet, a diagram frame keeps its column and row titles in view while you pan.
Templates mark the header items with `data.header = 'column' | 'row'` (and optionally `data.headerText`, the text
to pin): story map — activities and steps are columns (two pinned levels), release lanes are rows; kanban —
column lanes are columns (only their title bar counts); EventStorming — swimlanes are rows, phases are columns.
Domain stories have none: their actors are placed freely, so there are no columns or rows to pin. When a frame is on screen but
its column titles have scrolled above the top of the canvas (or its left edge off to the left), the web pins a
copy of them to that edge, lined up with the real columns / rows at the current zoom and clipped to the frame;
where both strips meet, the corner shows the frame's title. They are visual only, hidden below 25 % zoom, and
never cover the side panel. "Freeze headers" in the frame's panel turns them off for that frame (a per-viewer
preference kept in the browser).

## 6. Work tracker (not only Trello)

"Several related stories become one card" goes through a **WorkTracker port** (runtime):
`list() / upsert(card) / move(cardId, column)`, card = `{ id, title, description?, stories: [trace],
column, labels? }`. Adapters now: **canvas kanban frame** (the existing kanban / cards API; columns are resolved inside the
kanban frame and passed to the server by id, so two kanbans with a "Backlog" each never mix) and a **text
file** (`design/<key>.tasks.md`: `<!-- columns: … -->` under the title, then one `##` per card with
`<!-- card: <id> · column: <name> · labels: … -->` and an optional `stories:` line; the rest is the description). Trello, Jira, Linear later — same port. A card's
`stories` are `groups` traces back to the story map. In a kanban diagram file (`design/<name>.kanban.yaml`) a
card takes `stories: ['<story map key>/<story id>']` (→ `groups` traces) and/or explicit `traces`, and every card
carries `data.element` (its `id`, else the slug of its title) so other diagrams can trace to it.

## 6b. Domain Storytelling

Source: [domainstorytelling.org](https://domainstorytelling.org/quick-start-guide) (the method's quick-start
guide) and [Egon.io](https://egon.io), the modeler by the method's authors
([github.com/WPS/egon.io](https://github.com/WPS/egon.io), GPL-3.0 — we read its file format, we copy none of its
code or icons). A domain story is **one concrete scenario**, told in pictographic sentences.

**Notation (as the site states it).**
- **Actors**: "a person, a group of people, or a software system". **Every actor appears only once** in a story.
- **Work objects**: what actors "create, work with, and exchange … documents, physical things, and digital
  objects". **For every activity, a separate work object** is drawn.
- **Activities**: arrows "labeled with verbs from the domain language"; "the sentences can be brought into an
  order by numbering them", with the number at the arrow's origin. A sentence reads *actor → activity → work
  object → (to) actor*.
- **Annotations** complement sentences (variations, domain terms, assumptions); a **group** is "an outline that
  clusters parts of a story" (repetition, optional parts, locations, organisations, subdomains).
- **Scope**: granularity (coarse ↔ fine; Egon also offers medium and the cloud … clam levels), point in time
  (as-is / to-be), domain purity (pure / digitalized).

**File** `design/<name>.domain-story.yaml` (or `.dst.yaml`; key `<name>-domain-story` / `<name>-dst`):

```yaml
scope: { granularity: coarse-grained, time: to-be, purity: digitalized }
actors: [Moviegoer, { id: clerk, text: Cashier }, { text: Ticket system, kind: system }]   # person | group | system
workObjects: [{ text: seat request, kind: conversation }, { text: ticket, kind: document }]  # document | thing | digital | email | call | conversation | info | folder, or a custom icon name
sentences:
  - { actor: Moviegoer, verb: asks for, object: seat request, to: clerk }        # seq defaults to the next number
  - { actor: clerk, verb: books, object: ticket, to: Ticket system, toLabel: in, traces: [{ from: box-es/book, rel: relates }] }
groups: [{ text: Booking, members: [ticket] }]          # actors, work objects or sentences
annotations: [{ on: clerk, text: Cash only }]
```

- **Drawn as a pictographic story**, the way domainstorytelling.org and Egon.io draw one: actors and work
  objects are **pictograms with the name under the icon — no boxes** (person, group, system; document, thing,
  digital, folder, call, email, conversation, info, message; unknown kinds fall back to person / document). An
  activity is a straight arrow with its **sequence number in a circle at its origin** and the **verb beside the
  line**; an onward arrow ("to", "into", …) takes the work object on to the receiver. Arrows float: they aim
  from pictogram to pictogram and start at the icon's edge, so the arrows leaving one actor spread around it.
  Groups are dashed rounded outlines; annotations are text notes with a bracket and a dashed line; the legend
  shows the icons and the numbered arrow, and the scope closes the frame.
- **Layout**: actors appear once and are **placed freely** on a coarse grid — the first sentence's actor on the
  left, each new actor in a free cell next to the actor it first works with (right first, then below / above);
  a work object at the middle of the way from its actor to its receiver(s), spread sideways when several share
  that way; a sentence without a receiver puts its object in a free slot around its actor. A few placement
  preferences are tried and the one with the fewest crossing arrows is kept (deterministic). Positions are not
  part of the file, so Egon.io import/export is unaffected.
- A sentence **without a work object** is one numbered arrow from actor to actor; its element id rides on that
  arrow, traces into it resolve to its actor, and its own traces are drawn from its actor.
- Each work object carries its sentence's element id and the sentence read out ("⑤ You approves proposal to
  AI Agent"); the Inspector shows it. No board item carries "① verb" as text.
- The icons are our own simple line SVGs (Apache-2.0 like the rest of the code); Egon.io's GPL-3.0 icon set is
  not used.
- Grammar check (lint and the frame panel): unknown actor or element, a sentence with no work object, gaps
  and shared numbers (shared = parallel activities: Egon allows them, the site does not describe them), work
  objects in no sentence, actors who neither act nor receive, custom actor kinds.
- **Egon.io interop**: `awd design import-egon <story.egn | story.egn.svg> --out design/<name>.domain-story.yaml`
  and `awd design export-egon <file> --out <story.egn>` (with plain icons of our own for the names used).
- **Into a story map** (our rule — the site gives none): `awd design propose-stories <domain-story file> --into
  <story map file>` proposes one story per sentence whose actor is a person or group ("As <actor>, I <verb>
  <work object> to <receiver>"), acceptance "<work object> reaches <receiver>", under the group it belongs to
  (else the story), traced `derived-from` the sentence. Systems acting propose nothing.
- *Inferred, not stated by the site:* the default work-object kind (document), the icons, the grid-based placement, the
  `toLabel` field (Egon labels both arrows), treating a sentence without a work object as an actor → actor
  activity.

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
