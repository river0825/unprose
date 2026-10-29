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
  kind: 'event-storming' | 'user-story-map' | 'kanban' | 'wireframe' | 'workflow' | 'domain-story' | 'user-journey' | 'ui-mock',
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
  `domain-story`, `journey`, `ui` (or `mockup`, §6c); the **key is `<name>-<kind>`** — `design/studio.es.yaml` → `studio-es`,
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
  `data.element` (a domain story's declared work object: its first card), else by the id convention `<key>.<role>.<element id>` (items drawn before a template set
  `data.element`); `awd design draw` lists every trace it could not draw instead of dropping it.
- `awd design draw <file> --board <id | title:…> [--canvas URL]` draws or refreshes the frame. A redraw keeps
  what the person placed or locked, keeps receipts, removes stale items **inside that frame only**, and keeps items
  holding a pending proposal until the file explains them (the workflow redraw rules, scoped to the frame) — the
  whole rule set is in the table below. `--dry-run` prints what it would do and writes nothing.
- `awd design lint <file>` validates every kind that has a schema, offline (EventStorming also gets its grammar,
  §3; the board shows the same findings on the frame). Fields the schema does not know are warnings
  (`unknown field \`x\` at cards[2]`), on lint and on draw, instead of being dropped silently. A YAML parse
  error caused by an unquoted `#` inside `[ … ]` says so (quote values containing `#`).
- Board meta records the project: `meta.project = { root: <abs repo root> }`, and per frame the files
  snapshot as for workflows (`meta.diagrams[<key>] = { source, files }`).

### What a redraw keeps

Four things have state: **the file** (the truth for content), **the board's file snapshot** (`meta.diagrams[key].files`,
what the Files tab and remote agents read — replaced on every draw), **the person's layout** (where they moved or
resized things, read from the change log, plus any **lock**), and **items nobody drew from this file** (the person's
stickies, another agent's cards, comments, proposals). A redraw (`awd design draw`, `design_draw`, `awd graph --canvas`)
decides each item's fate like this:

| Item | Content (text, colour, data) | Position and size | Removed when the file drops it? |
|---|---|---|---|
| Drawn from the file, **locked** (`data.lock: 'layout'` on it, or on its frame) | from the file | **kept** (lock wins) | yes — a lock keeps the place, not the item |
| Drawn from the file, **moved or resized by the person** (any time, per the change log) | from the file | **kept** | yes |
| Drawn from the file, neither | from the file | from the file | yes |
| Drawn from the file, **deleted by the person** (a wire or an item — a policy → command wire, a sticky) | the file's, **marked deleted** (`data.pending: { kind: 'remove', deleted: 'wire' \| 'item', by: 'user' }`), drawn struck | kept | **yes — that is the point**: while the file still has it the redraw keeps it removed (never redrawn as it was) and lists it as "kept removed"; once the file drops it, it goes for good and the mark with it |
| The **frame** itself | title from the file | kept if moved or locked; else grows to fit (never shrinks) | never |
| A **proposal** of this drawing (`data.pending`: a dragged wire, edited words, a proposed story) | left exactly as it is | left as it is | removed once the file explains it (then the drawn element replaces it) |
| A **note the file drew** — a numbered annotation card, a UI mock / wireframe note, a UI mock screen's own note | from the file | kept if moved; else from the file | **yes** — renamed or removed element, a note moved to another element, an annotation dropped; **unless someone answered it**: then it stays as a thread about the same item, with no number and no pin (the preview lists it as updated: "it has replies") |
| **Comments** (any other) | kept | kept | never |
| **Foreign items in the frame** — another id (the person's sticky, a card another agent added with `canvas_add_items`/`canvas_apply`) | kept | kept | **never**: listed as "not from this file (kept)" in the preview |
| An item with this file's id prefix that **the person added**, or **another agent added by hand** (a change that was not a redraw, by an agent that never redrew this frame) | kept | kept | **never** — treated as foreign |
| Items of **other frames** on the board, and their proposals | untouched | untouched | never |

Precedence for geometry: **locked > moved by the person > the file**; for existence: **deleted by the person > the file.**
Deleting a file-drawn wire or item on the page does not drop it (the next redraw would draw it again from the
file): it stays, struck and faint, as a **proposal to remove it from the file** — the panel says so, with **Ask AI to
remove it from the file** (a chat request carrying the proposal, as for wire proposals in docs/studio.md §7) and
**Undo**; the outline and `canvas_wait` show it as `[deleted by the person — the file still has it: proposed remove
from the file]`. A deletion made another way (over the API, or by an older page) is found in the change log and the
redraw puts the mark back instead of the item. Whoever holds the file removes the subscription / element after the
person agrees; the next redraw then removes the struck item. Presentation data (read receipts, wire sides and
bends, the lock itself, a frame's hidden contents — docs/canvas.md "Hiding a frame") survives every redraw: a hidden
frame stays hidden, and what the redraw adds to it is hidden with it. Nothing a redraw writes goes back into the file:
layout lives on the board only.

**A new item next to one the person placed.** A template says which item it put each new item next to — in a domain
story: a new actor drawing → the actor it was drawn beside, a work object → its sentence's actor, a note → what it is
on (a hint for the redraw, `near`, never stored on the board). When that neighbour is locked or the person moved it,
the redraw adds the new item at the same offset from where the neighbour **is on the board**, not where the file's
layout has it — so `drawAgain: lead` on "CL1 dials Lead" puts the new Lead beside the CL1 the person dragged to the
bottom row — moved aside to the nearest free spot when something is already there. The preview says so (`+ … "Lead" —
placed next to "CL1", where you put it`). It keeps that place on later redraws (`data.placedNear`; the preview lists
it as kept), as if the person had put it there.

**A note the file renamed.** A domain story's notes were numbered in file order (`<key>.note.note-1`, `-2` …), so
inserting one shifted every later id and the person's placement landed on the wrong notes; they are now named after
what they are on (§6b). On the first redraw of an older board, each new note takes over the old note with the same
`on` and the same text (else the same `on`, when only one is left on each side): its place when the person moved or
locked it, its presentation (the dashed line's folds too), and the threads about it (their `target` follows). The old
one is removed ("renamed: now …"), and the new note counts as placed on every later redraw (`data.renamedFrom`). An old
link to the note (`?focus=…note.note-2`) no longer finds it.

**Lock.** The person right-clicks an item → **Lock position** (a frame: **Lock layout**, which locks the frame and
everything inside it); a small lock shows at its corner and it can no longer be dragged or resized until **Unlock**.
Agents lock with `canvas_apply` ops `{kind: 'lock', id}` or `{kind: 'lock', frame: '<key>'}` (and `unlock`; they may unlock only what an agent locked — a lock the person set
stays until the person removes it). In a **kanban**, auto-stacking respects locks: a kanban in a locked frame is shown
exactly as stored (no stacking, no snapping, no growing); a locked column keeps its place and height while the other
columns flow around it, and its cards still stack inside it; a locked card keeps its place and the other cards of its
column stack around it. A locked column does not lock its cards (only a frame locks what is inside it).

**Preview.** `awd design draw <file> --board … --dry-run [--limit N]`, `awd graph <wf> --canvas --dry-run`, and
`design_draw { …, dryRun: true }` (local and remote MCP) print the plan and write nothing — no board is created, no
project registered, no ops, no meta:

```
Redraw preview — plan-kanban from design/plan.kanban.yaml on "Release plan" (http://localhost:4400/b/b_…) (dry run: nothing written)
  2 added · 2 updated · 2 unchanged · 2 removed · 1 kept where the person moved it · 1 kept: locked · 1 not from this file (kept)
  added (2):
    + plan-kanban.card.Refund-flow-partial-refunds-too  "Refund flow (partial refunds too)"
    + plan-kanban.card.Gift-cards  "Gift cards"
  updated (2):
    ~ plan-kanban.card.Payment-webhook  "Payment webhook" — data
    ~ plan-kanban.card.Order-emails  "Order emails" — x, y
  removed (2):
    - plan-kanban.card.Refund-flow  "Refund flow" — no longer in the file
    - plan-kanban.card.Old-coupon-code  "Old coupon code" — no longer in the file
  kept where the person moved it (1):
    = plan-kanban.card.Checkout-page  "Checkout page" — you moved it: keeps x, y, order
  kept: locked (1):
    # plan-kanban.card.Payment-webhook  "Payment webhook" — locked: keeps x, y, order
  kept removed (1):
    x plan-kanban.arrow.payment-webhook-order-emails  "then" — you deleted it — the file still has it; propose the file change?
  not from this file (kept) (1):
    * codex-b.note.sizing  "Sizing: ask about webhooks" — added by codex-b, not from this file: kept
```

Run it before redrawing a frame that other people or agents worked on; if something you expected to move is "kept",
the person moved or locked it — ask before changing that. A "kept removed" line is a deletion waiting for the file:
ask the person whether to remove it from the file, then edit the file and redraw.

### Bilingual boards (e.g. English + 繁體中文)

Two languages on one sticky double its text, and a sticky that grows to fit it pushes the timeline apart and
hides the flow. Use **a short title + the full detail**:

- **On the card: a short bilingual title** — `Order placed · 訂單已成立`, two short phrases, not two sentences.
- **The full text goes where the kind keeps longer text** (shown in the Inspector, not on the card): kanban
  `cards[].description`; story map `stories[].acceptance`; wireframe / UI mock `note`; domain story `sentences[].note`
  and `annotations`; workflow `description` / `detail`; in every kind, an `annotations` entry on the item (§2b) —
  EventStorming has no free-text field on a sticky, so the explanation goes there, in a `definitions` entry (`term` +
  `text`, the glossary below the timeline) or, for an open question, a `hotspots` entry on the element.
- **Do not enlarge stickies** (no `w` / `h` / `fontSize` to make text fit): templates keep every sticky the same
  size so the timeline reads; a cut-off title means the title is too long.

Recommended maximum length of the **text on the card**, per language (CJK characters count about double width):

| Kind | Element | English | 中文 |
|---|---|---|---|
| EventStorming | event, command, policy, read model, system (160 px sticky) | 32 chars | 12 字 |
| EventStorming | person, milestone (small sticky) | 20 chars | 8 字 |
| Story map | activity, step, story (150 px card) | 40 chars | 15 字 |
| Kanban | card title (240 px card) | 50 chars | 20 字 |
| Domain story | actor, work object, verb | 20 chars | 8 字 |
| Wireframe / UI mock | heading, button, label | as the real UI would — one language per screen is usually clearer; a second screen per language if both matter |
| Workflow | block label | 24 chars | 10 字 |

Keep ids in one language (ASCII slugs: `order-placed`) so traces and references stay stable when a translation
changes. The start prompts (`/unprose:eventstorm`, …) and `canvas_create_board`'s content help say the same.

## 2b. Annotations — what an item is for, in every kind

An annotation says **what an item is for**: why it is there, what it promises, what to keep in mind about it. It is
not a question or a disagreement (a hotspot, a comment), not something still to check with someone else (a TODO on the
board — docs/canvas.md "TODOs"), not the item's own words. Every kind's file takes a top-level list:

```yaml
annotations:
  - on: paid                    # the item it is about
    text: Shown only after the bank confirms the payment
  - id: frozen-cart             # optional: the card keeps this id when `on` is rewritten
    on: Order placed
    text: From here on the cart cannot change
```

- **`on` names one item of the diagram** — the same ids traces use, or the item's text:

  | Kind | `on` |
  |---|---|
  | EventStorming | an element's id or its text, as `hotspots[].on`: `paid`, `Order paid` |
  | Story map | an activity, step or story id or text; a release lane `release.<slug>` |
  | Journey | a stage `checkout` (the slug of its text), one of its stickies `checkout/pay`, or the text |
  | Kanban | a card's `id` (else the slug of its title) or its title; a column by the slug of its name (`done`) |
  | Wireframe | a screen `home` (the slug of its name) or an element `home/sign-up` (the slug of its text, else its role), or the text |
  | UI mock | a screen `home` or an element `home/new-board` — `<screen>/<element>`, as flows and traces (a stack, row or grid is not drawn: name an element in it) |
  | Workflow | a step or trigger id: `plan` (the runner ignores `annotations:`) |
  | Domain story | an actor, work object or sentence (§6b — Egon.io's notes) |

  Also, in every kind: the board item's id (`shop-es.event.paid`) or its id inside the diagram (`event.paid`) — what
  the canvas writes for a draft on an item that has no element id.
- **Drawn** as a numbered card beside the drawing, never on it: in a **band below** an EventStorming, story map,
  journey, kanban or workflow — numbered along the drawing, left to right, a column top to bottom — and in a
  **gutter right of the screen** for a wireframe and a UI mock (§6c), numbered top to bottom. Each card sits under
  (beside) what it is about when that is free, else next to the card before; the frame grows to hold them. The page
  puts a pin with the same number on the item and shows or hides both with the Notes switch. A card is a comment with
  `role: note`, `data.callout` and `data.annotation = { on, file }` — not a thread: it has no replies.
- **Inline notes are annotations too**: a wireframe element's `note:` and a UI mock element's, entry's or row's `note:`
  are numbered with the file's `annotations:` (a UI mock element with several: `data.ui.callouts` lists every number).
  A **domain story** keeps Egon.io's convention instead — a text note with a dashed line (§6b); a draft from the canvas
  appends to the same list.
- **Lint**: an `on` that names nothing is an error — `annotations[2]: on "refnd" matches nothing in this diagram, so its
  card is not drawn — name …, e.g. paid, placed, …` — and the draw leaves that card out.
- **Redraw**: content and numbers follow the file; a card the person moved stays where they put it; a card whose
  annotation left the file goes — so does a UI mock screen's own note, and a note whose element was renamed or that
  moved to another element — unless someone replied to it: then the discussion stays, as a thread without a number.
- **From the canvas**: the person writes an annotation on an item as a *draft* — a proposal to the agent holding the
  file, with the edit that adds one entry here. The holder judges it and, when it is sound, applies it at once (the
  person wrote it); otherwise it says why in the thread (docs/canvas.md "Annotations").

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
- Layout (detailed levels, `templates/esTimeline.ts`): **time reads left → right and no flow wire runs back
  to the left** (`handles`, `produces`, `triggers`, `raises`, `updates`, `informs`).
  - Sequential steps stay on **one row**. A read model that informs a command is a step of that row, between
    the event that updates it and the command (read model → person → command, p.201): `compose →
    cadences-created → cadence-library (read model) → configure → experiment-configured` is one straight row.
    A read model that informs only people sits just after the last event that updates it, above the row.
  - Branches get their own rows: a command's other outcomes (p.209), a variant (B) that forks from the same
    event as the row, a separate flow coming in. Of several ways on, the one that runs on furthest keeps the row.
  - **A retry or revision is a later occurrence, not a loop back.** A wire that would point back in time
    (a policy after a later event re-running an earlier command, a read model updated late that informs an
    earlier command) goes to the same sticky drawn again right after its source — id `<…>.again`
    (`.again-2`, …), `data: { occurrence: true, repeats: <first occurrence's id> }`, a command's person above it
    again. "Back in time" is decided from the file: events by their order, a command just before the first
    event it produces, a policy just after the last event it reacts to, a read model just after its last update.
  - A read model that informs a person points at an occurrence of that person at or after it; if there is none,
    the person is drawn once more in the read model's column.
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
bottom; "Later" last). The cut line decides scope: stories above the first line are Release 1. What an activity,
step or story is for goes in `annotations` (§2b), numbered cards below the map.

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

**What it is for — and not** (read this before the file format; [domain-story-review.md](domain-story-review.md) has
the method's rules with their pages). A domain story shows *who does what with what, and hands it to whom*, in one
concrete case, as sentences the person would say aloud. It is **not** the diagram for what does *not* happen, for
conditions or alternatives (the method has no symbol for them: each important alternative is its own story), for a
rule or a comparison ("only once per contact", "A vs B" — a definition, policy or hotspot sticky, or a note), or for
how things change over time (an EventStorming timeline). A story is told *with* the person: an actor or a purpose
you guessed is a question, not a sentence. And when pictograms collide, change the layout — spacing, groups, a split
into scenarios — never the story: no actor or sentence is dropped to make the picture fit. The lint and draw results
end with the story read back; tell it to the person before you call it done.

**Notation (as the site states it).**
- **Actors**: "a person, a group of people, or a software system". **Every actor appears only once** in a story —
  the board's default; a long story may let actors repeat (below, "Repeated actors").
- **Work objects**: what actors "create, work with, and exchange … documents, physical things, and digital
  objects". **For every activity, a separate work object** is drawn.
- **Activities**: arrows "labeled with verbs from the domain language"; "the sentences can be brought into an
  order by numbering them", with the number at the arrow's origin. A sentence reads *actor → activity → work
  object → (to) actor*.
- **Annotations** complement sentences (variations, domain terms, assumptions); a **group** is "an outline that
  clusters parts of a story" (repetition, optional parts, locations, organisations, subdomains). Where what does
  *not* happen goes (the book, pp. 23 and 28):

  | To say | Put it |
  |---|---|
  | which case this story tells ("Casey matches for the first time") | an annotation on the whole story — `annotations: [{ on: <first work object>, text: 'Assumption: …' }]` |
  | where a sentence would not happen ("already sent → ③ does not happen") | an annotation on that sentence — `{ on: <sentence id>, text: 'Variation: …' }`, the detail in the sentence's `note` |
  | a stretch that is sometimes skipped | a `groups` outline around those sentences, labelled "optional: …" |
  | the rule itself ("only once per contact") | an EventStorming policy / hotspot, or the story map's acceptance — the story links to it |
  | a rejected alternative | the decisions kanban; the story keeps one link |

  One sentence per annotation (`note-long` warns past 120 characters); a story made of the right column is no story.
- **Scope**: granularity — "the level of detail": **coarse-grained** (the whole process at a glance: what happens),
  **medium-grained**, **fine-grained** (one part in detail: how exactly it is done); Egon also offers the cloud …
  clam levels — point in time (as-is / to-be), domain purity (pure = no software systems / digitalized). A story
  keeps to one level; detail of another level is another story.

**File** `design/<name>.domain-story.yaml` (or `.dst.yaml`; key `<name>-domain-story` / `<name>-dst`):

```yaml
scope: { granularity: coarse-grained, time: to-be, purity: digitalized }
actors: [Moviegoer, { id: clerk, text: Cashier }, { text: Ticket system, kind: system }]   # person | group | system
workObjects: [{ text: seat request, kind: conversation }, { text: ticket, kind: document }]  # document | thing | digital | email | call | conversation | info | folder, or a custom icon name
sentences:
  - { actor: Moviegoer, verb: asks for, object: seat request, to: clerk }        # seq defaults to the next number
  - { actor: clerk, verb: books, object: ticket, to: Ticket system, toLabel: in, traces: [{ from: box-es/book, rel: relates }] }
  # drawAgain: Moviegoer   — optional: draw an actor of this sentence again, next to it ("Drawn again at one sentence")
groups: [{ text: Booking, members: [ticket], color: blue }]   # actors, work objects or sentences; color optional
annotations: [{ on: clerk, text: Cash only }]
layout: { spacing: roomy }    # optional: compact | normal (default) | roomy; or gapX / gapY in px
icons: { flask: '<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 10h14l-5-10V3"/></svg>' }   # optional: icons of your own, used as a kind
```

- **Drawn as a pictographic story**, the way domainstorytelling.org and Egon.io draw one: actors and work
  objects are **pictograms with the name under the icon — no boxes** (person, group, system; document, thing,
  digital, folder, call, email, conversation, info, message; unknown kinds fall back to person / document). An
  activity is a straight arrow with its **sequence number in a circle at its origin** and the **verb beside the
  line**; an onward arrow ("to", "into", …) takes the work object on to the receiver. Arrows float: they aim
  from pictogram to pictogram and start at the icon's edge, so the arrows leaving one actor spread around it.
  An arrow that would run through another pictogram is folded around it by the board (and a person can fold any
  arrow by hand — docs/canvas.md "Folding a line by hand"); the number and the verb stay on its first run.
  Groups are dashed rounded outlines; annotations are text notes with a bracket and a dashed line to what they
  explain; the legend shows the icons and the numbered arrow, and the scope closes the frame.
- **Layout**: actors appear once (unless they repeat, below) and are **placed freely** on a coarse grid — the first sentence's actor on the
  left, each new actor in a free cell next to the actor it first works with (right first, then below / above);
  a work object at the middle of the way from its actor to its receiver(s), spread sideways when several share
  that way; a sentence without a receiver puts its object in a free slot around its actor. A few placement
  preferences are tried and the one with the fewest crossing arrows is kept (deterministic). Positions are not
  part of the file, so Egon.io import/export is unaffected.
- **Spacing** (`layout:` in the file, our addition — Egon.io ignores it): every activity arrow gets room for its
  number circle and its verb, measured with the same text metrics as the snapshot and the layout check (the
  verb at 12 px; a verb longer than ~220 px does not stretch the grid further — it is cut on the board), so labels
  and numbers do not crowd. `spacing: normal` (the default) is about 1.25× the earlier fixed grid plus that
  measured room; `roomy` is about 1.55× with more air after each verb; `compact` keeps the earlier fixed grid
  (460 × 330 px actor pitch; long verbs may crowd). `gapX` / `gapY` (px, 240–2000 / 180–2000) set the actor
  grid's pitch outright. Spacing only changes positions, never ids, so a redraw still keeps what the person
  moved or locked ("What a redraw keeps").
- **Repeated actors** (`layout: { actors: repeat }`, or `repeat: true` on one actor; our addition to the book's rule,
  `once` is the default). A long story keeps coming back to its early actors — the customer who ordered pays at the
  end — and with every actor drawn once, those sentences are long arrows back across the picture that cross other
  arrows and run through pictograms. An actor that repeats is still **declared once** in the file and keeps its name;
  the board draws it again where the story continues, the way a work object is drawn again for every sentence.
  Sentence by sentence, the sentence is drawn next to the drawing of one of its actors nearest to the previous
  sentence's; another actor of the sentence uses its nearest drawing when that one is at most two grid cells away
  and the arrow to it crosses no arrow drawn before and runs through no other actor — else it is drawn again next
  to the sentence (an actor that does not repeat always uses its one drawing). On a 17-sentence order-to-cash story
  that took the crossings from 7 to 0, the lines through pictograms from 4 to 0, and the longest arrow from 1,449 to
  734 px (4 actors drawn twice or three times). Deterministic. The first drawing keeps the id `<key>.actor.<id>`,
  later ones are `<key>.actor.<id>.2`, `.3` … (`data.occurrence: true`, as EventStorming marks a person drawn
  again), numbered in the order the story needs them, so a redraw keeps what the person moved. What reads the
  actors knows: an **annotation** on an actor and a **trace** to it go to its first drawing; a **group** naming an
  actor takes the drawings of it that the group's own sentences use (its first drawing when they use none);
  **replay** brings a drawing in with the first sentence that uses it; selecting one drawing lights up the others,
  and the Inspector lists them ("Same actor, also drawn for ⑭ …"); `canvas_read_board` lists the actor once ("drawn
  3 times: also #… #…"). **Egon.io**: each drawing exports as an Egon actor of the same name (Egon lets a modeller
  place an actor again); importing a story with several Egon actors of one name and icon gives one actor with
  `repeat: true`.
- **Drawn again at one sentence** (`drawAgain:` on a sentence, an actor or a list; our addition). `repeat` only
  *allows* a copy, and the layout decides from its own grid — where two actors may sit side by side that the person
  put far apart on the board, so the line between them still runs across the picture. `drawAgain` names an actor of
  the sentence (its actor or a receiver, by id or text) to draw again for that sentence, next to it, whether or not
  the actor repeats: `{ id: dial, actor: cl1, verb: dials, object: call, to: lead, drawAgain: lead }`. The sentence
  is drawn next to its other actors and Lead is drawn again beside them (`<key>.actor.lead.2`, `data.drawAgain:
  dial`); later sentences use Lead's nearest drawing, as for any actor (an actor that does not repeat gets exactly the
  drawings `drawAgain` asks for). On a board the person arranged, the new drawing goes next to where they put CL1,
  not where the layout has CL1 ("What a redraw keeps"). The lint warns when `drawAgain` names an actor the sentence
  does not have (`draw-again-not-in-sentence`) and says so when it names one at its first appearance — there is no
  drawing yet to draw again (`draw-again-first-appearance`). `canvas_read_board` says which sentence asked ("drawn 2
  times: also #… (drawAgain in dial)"). Egon.io gets the drawing as one more actor of the same name; importing it
  back gives that actor `repeat: true` (Egon has no `drawAgain`).
- **No collisions.** The layout makes sure nothing is drawn on top of something else:
  - an actor that **sends to itself** (`actor: cl, to: cl`) gets its work object **beside** it, in a free slot whose
    arrow passes no other pictogram, and **no return arrow** (it would run back over the activity arrow); the lint
    warns (`self-receiver`) — omit the redundant `to` (an internal step: actor → activity → work object) or name the
    real receiver. Without a work object such a sentence has nothing to point at and is not drawn;
  - **no two pictograms share a spot**: a work object that finds no free place on its way is moved to the nearest
    free place around it, with the same metrics as everything else; layouts whose arrows run through pictograms
    count as worse when the placement preferences are compared;
  - **annotations are as big as their text**: measured with the text metrics (12.5 px, the page's size), wrapped
    within 280 px, the height grows with the lines — nothing is cropped. They sit beside what they explain, off the
    pictograms and other notes, where they cross the fewest arrows. The lint warns on a note over 120 characters
    (`note-long`, a CJK character counts as 2): keep the gist on the board, the detail in a sentence's `note`;
  - **group outlines** shrink-wrap their members with padding (the title above the outline counts too). A group
    whose members all belong to another group is drawn **inside** it (`data.nestedIn`); two groups whose outlines
    would still touch are trimmed apart where their members leave room. Groups that **share members** (neither
    inside the other) cannot have separate outlines: the outline carries `data.overlaps` and the lint warns
    (`groups-overlap`) — keep each shared element in one group, or make one group a sub-group;
  - **a group's colour** (ours; Egon.io colours a group's outline): `color:` on a group — orange, blue, yellow,
    pale-yellow, lilac, green, pink, red, purple — draws a pale wash of it behind the members and the dashed outline in
    its shade, so groups are told apart at a glance (grey, the default, and white draw no wash). Without `color` in the
    file the person sets it on the board (right-click the group → *Change colour*) and a redraw keeps it; a colour in
    the file wins over the board's. The snapshot draws it too, and `export-egon` gives the group that colour;
  - **verbs and number circles** are placed for the board as a whole (`wireGeometry.ts` `planWires`, the same for the
    page, the snapshot and the layout check): first the number circles in sequence order, each at its arrow's start
    and a little further along when another circle or a pictogram is there; then the verbs in sequence order, each
    beside its line (the free run past its number), off the pictograms, every circle, the group titles and the
    verbs already placed (edgeLabel.ts rules: wrap, cut with …, else a dot that shows the verb on hover).
  - `canvas_check_layout` reports what is left: pictograms on each other, group outlines that intersect (with the
    shared members), annotation text cut off by its box, number circles on a pictogram or on each other, labels on
    circles or on other labels (every diagram kind's wires) — each with a plain-words fix.
- A sentence **without a work object** is one numbered arrow from actor to actor; its element id rides on that
  arrow, traces into it resolve to its actor, and its own traces are drawn from its actor.
- Each work object carries its sentence's element id and the sentence read out ("⑤ You approves proposal to
  AI Agent"); the Inspector shows it. No board item carries "① verb" as text. A **declared work object** is drawn
  once per sentence, so a trace, a note or a group naming it (`<key>/quote`) goes to its first card.
- **One set of ids per story**: actors, work objects, sentences, groups and notes share it. An `id` another element
  already has is drawn with `-2` (`quote-2`), and a trace, note or group naming it reaches the first owner; the lint
  warns (`id-taken`) — give one of them another id.
- **A note is named after what it is on**: `<key>.note.note-<element>` (`note-clerk`; a second note on the same element
  `note-clerk-2`), so a note inserted into the list moves no other note on the board. Give a second note on one
  element an `id` of its own (`{ id: cash-only, on: clerk, text: … }`): then its place never depends on the order of
  the list. (Before, notes were numbered in file order, `note-1`, `note-2` …: see "What a redraw keeps" for how an
  older board keeps the person's placement.)
- The icons are our own simple line SVGs (Apache-2.0 like the rest of the code); Egon.io's GPL-3.0 icon set is
  not used.
- Grammar check (lint and the frame panel): unknown actor or element, a sentence with no work object, gaps
  and shared numbers (shared = parallel activities: Egon allows them, the site does not describe them), work
  objects in no sentence, actors who neither act nor receive, custom actor kinds; and, for the drawing, sentences
  sent to their own actor, groups sharing members, notes longer than recommended ("No collisions" above), a
  `drawAgain` that names an actor not in its sentence or one appearing there for the first time ("Drawn again at one
  sentence" above).
- **Reviewer's hints** (lint and the frame panel; `info`, because only the people telling the story can say
  whether it is wrong — [domain-story-review.md](domain-story-review.md) has the reasoning and the sources): a scope
  that does not state its granularity, time or purity; `pure` with a software system among the actors (a warning);
  a story in which every sentence is one user and one system answering each other; a story mostly about what does
  not happen (`negative-story`); several work objects whose names start with the same word (`work-objects-variants`);
  a date inside a verb (`date-in-verb`);
  a sentence that reads like a choice ("if", "or"); a work object that reads like an outcome ("check passed")
  instead of a thing; no work object coming back in a second sentence; half or more of the work objects drawn
  with the same icon (`work-objects-one-icon`, naming them, with an example icon to draw); a kind with no icon. `/unprose:critique` (the `critique` prompt) has an agent read a story this way.
- **The same work object, drawn again**: the method draws a work object once per sentence that touches it, so one
  thing appears several times under the same name. To make that visible (our display aid, not part of the
  notation), selecting or pointing at one of them puts the selection wash behind the others (no ring: they are related to
  the selection, not selected), and the
  Inspector lists them: "Same work object, also in ③ … ⑥ …". Two pictograms are the same when they come from the
  same declared work object (`workObjects[].id`), else when they have the same name, inside one story.
- **Icons of your own** (`icons:`; Egon.io has them too — "upload your own icons", "square SVG images"): a name →
  an SVG line drawing on a 24 × 24 box, used as an actor's or a work object's `kind`. Only plain shapes are read
  out of it — `path` (`d`), `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon` with plain numbers, at most 40
  shapes and 4000 characters; styles, fills, text, images, links and scripts are ignored, and the board, the
  snapshot and the Egon export draw from that list in the ink colour (an icon is text an agent wrote: it is never
  put on the page as it came). An icon with nothing to draw is a lint warning and falls back to the built-in one.
  `export-egon` puts them into the story's icon set; `import-egon` does not read Egon's icons.
  **Agents should draw them.** The built-in work-object icons are generic and a work object without a `kind` is a
  document, so a story an agent writes tends to be a row of identical pages; the book wants an icon set "adapted to
  the domain" (p. 21). The prompt and the `domain-storytelling` skill ask the agent to draw icons for the domain's
  things — one per kind of thing, the main work object first, three to seven in a story — and lint asks when half
  or more of the work objects look alike. How to draw one (an outline on 24 × 24, stroked 1.9 wide in ink, never
  filled; no `transform` or `<g>`) and a gallery of about twenty to copy from (invoice, payment, appointment,
  reminder, contract, form, shipment …): `skills/domain-storytelling/references/icons.md`.
- **Egon.io interop**: `awd design import-egon <story.egn | story.egn.svg> --out design/<name>.domain-story.yaml`
  and `awd design export-egon <file> --out <story.egn>` (with plain icons of our own for the names used).
- **Into a story map** (our rule — the site gives none): `awd design propose-stories <domain-story file> --into
  <story map file>` proposes one story per sentence whose actor is a person or group ("As <actor>, I <verb>
  <work object> to <receiver>"), acceptance "<work object> reaches <receiver>", under the group it belongs to
  (else the story), traced `derived-from` the sentence. Systems acting propose nothing.
- *Inferred, not stated by the site:* the default work-object kind (document), the icons, the grid-based placement, the
  `toLabel` field (Egon labels both arrows), treating a sentence without a work object as an actor → actor
  activity.

### Replay

A domain story is told one sentence at a time, and the board can tell it that way too — as Egon.io's **Replay**
does (its `tools/replay` in github.com/WPS/egon.io). Start it with **Play story** on a domain-story frame's header,
in the frame's side panel, or from the right-click menu of the frame or anything in it.

- **One step per sequence number.** Step 1 shows only sentence 1: its actor, the numbered activity arrow, the work
  object, the onward arrow and the receiving actor. **Next** reveals the next sentence; everything told earlier
  stays, everything later is hidden. Sentences that **share a number** (parallel activities) are **one step**, as
  in Egon. Gaps in the numbering are simply skipped.
- **The current sentence stands out** the way Egon marks it — the activity line thick, its verb bold, its number
  circle filled — and, beyond Egon, the pictograms of the sentence take the accent colour and a bold name.
- **Annotations** appear with what they explain; a **group outline** appears when its first member does; a
  comment about a story item appears with the item; an actor in no sentence is not shown during the replay (Egon
  hides it too). The legend, the scope line and anything else in the frame that is not part of the story stay.
- **Controls** (a floating bar at the top of the canvas): ⏮ restart, ◀ previous, ▶ next, the step "3 / 8", the
  sentence(s) read out as the Inspector reads them ("③ Bea assigns claim form to Clerk"), **auto-play** at
  1.5 / 2.5 / 4 s per sentence, **Ghost** (show what is still to come faintly instead of hiding it), ✕ stop.
  Keys: → ↓ Space PageDown next, ← ↑ PageUp previous (Egon uses the arrow keys; Space and PageUp / PageDown are what
  presentation clickers send), Home / End first / last, P play / pause, Esc stop.
- **The view follows** gently, at a size you can read. A story that can be read whole (fitted at 80 % or more, so the
  13 px names come out at 10 px or more) starts whole; a bigger one starts on sentence 1 at 100 %. On each step the
  view moves only when the current sentence is out of view or too small to read, and then centres it at 100 % —
  zoomed out only as far as a long sentence needs to be seen whole (the bar still reads it out). A zoom you make
  while it plays is kept.
- **Purely a way of looking**: nothing is stored on the board and other viewers are not affected; while it plays
  the story's items cannot be dragged and the board's edit keys wait. **Copy as image** during a replay copies
  what is visible (hidden sentences are not drawn; ghosted ones come out faint).
- **Differences from Egon.io**, on purpose: Egon refuses to start when a number is missing ("Sentence 3 is
  missing") — we skip the gap, since lint already reports it; Egon hides groups unless "show groups" is on and then
  shows them all from step 1 — we bring each group in with its first member; Egon has no auto-play, ghost mode,
  restart / last-step keys or spoken-out sentence; Egon's HTML presentation export (one slide per sentence) is not
  copied. Not yet: presenting to everyone on the board at once.

## 6c. UI mock — real-looking screens to discuss, like a Figma frame

A wireframe (low-fi boxes on a 12-column grid) settles *what is on a page*. A **UI mock** shows *what it will look
like*: real components, real copy, a device size, light or dark — so the person can point at one button and say
"this should be secondary", the way a team comments on a Figma frame.

**Options we weighed.**
- **(a) A native frame kind backed by a file** (chosen). The agent writes `design/<name>.ui.yaml`; the canvas draws
  it. Files stay the truth, the agent can edit every pixel of it, each element is a board item, so selection,
  comments, chats, traces, Copy as image and "keep the person's layout" all work unchanged.
  - *Format:* HTML + CSS is what models write best, but rendering it would need a sandboxed iframe per screen
    (the canvas has no auth and can sit behind a tunnel), its elements would not be board items (no per-element
    comments, no proposals), and a diff to arbitrary HTML is hard to map back from a canvas edit. So the file is a
    **constrained component tree in YAML** with a small design system, drawn by React — no HTML from the file is
    ever rendered, nothing runs, nothing loads.
- **(b) Embedding real Figma** (`https://www.figma.com/embed?embed_host=…&url=…`). Cheap to show, but read-only:
  the agent cannot edit Figma, the person's comments land on the whole frame, a private file needs the viewer's
  Figma login (or a REST token for import), and the iframe would load a third-party site into the canvas. Not
  done now; a link frame (an embed shown as one item, commentable as a whole) is a small follow-up if wanted.

**File** `design/<name>.ui.yaml` (key `<name>-ui`; `.mockup.yaml` works too):

```yaml
device: desktop              # desktop 1280×800 · laptop 1024×680 · tablet 768×1024 · phone 390×844
theme: light                 # the mock's theme, independent of the canvas theme; per screen too
tokens: { accent: '#1f56d6', radius: 8, font: sans }   # sans | serif | mono | rounded
screens:
  - id: boards
    name: Boards
    body:                    # a vertical stack, padding 0 — put content in a section
      - { type: navbar, text: Unprose, items: [Boards, Docs], active: Boards }
      - type: section        # padding 24, gap 12
        children:
          - type: row
            justify: between
            children:
              - { type: heading, id: title, text: Boards, level: 1 }
              - { type: button, id: new-board, text: New board, icon: plus, goto: new-board, note: Starts an empty board by hand; most are drawn by the agent }
          - type: grid
            cols: 3
            children: [{ type: card, id: studio, text: Studio design, children: [{ type: badge, text: Freeform }] }]
          - type: table
            id: recent
            sample: true         # made-up rows: a hatched stripe on the frame, no "sample" inside the product
            columns: [Board, When]
            rows:
              - [Studio design, 2 min ago]
              - { cells: [Runner, 1 h ago], note: Relative times, or the date after a day? }   # a row note: pin ② on the row
  - { id: new-board, name: New board, device: phone, theme: dark, body: [ … ] }
flows: [{ from: boards/studio, to: new-board, label: open }]
```

- **Components.** Layout (not drawn): `stack` (vertical, `gap`, `pad`, `align`), `row` (children take `span` of 12,
  a fixed `w`, hug their content — button, link, badge, avatar, icon, checkbox, toggle — or share what is left;
  `justify: start|center|end|between`; cards and sidebars stretch to the row's height), `grid` (`cols`). Drawn
  containers: `card` (`text` = title, `variant: flat|elevated`), `section` (`bg: surface|muted|accent`), `navbar`
  (`text` = brand, `items` = links, `active`; its children sit at the right end). Elements: `heading` (`level` 1–4),
  `text` (`variant: muted|small|code`), `link`, `button` (`variant: primary|secondary|ghost|danger|link`, `icon`,
  `size`), `input` / `textarea` / `select` / `search` (`label`, `placeholder`, `value`, `hint`), `checkbox`, `radio`,
  `toggle` (`checked`), `badge` (`tone: neutral|info|success|warning|danger`; a status word picks its tone), `avatar`
  (initials), `icon`, `divider`, `image` (a placeholder; `ratio`, `h`), `table` (`columns`, `rows`; a cell `[Done]`
  is a status badge), `list` (`items: [text | { text, meta, icon, badge }]`), `stat` (`value`, `delta`), `alert`
  (`tone`), `progress` (`value` 0–100), `tabs`, `breadcrumb`, `pagination`, `spacer`, `empty`, `chart` (`variant:
  bar|line`, `rows: [[numbers]]`), `sidebar` (`items` with `icon` / `badge`, `active`). Icons are a small set of
  our own line glyphs (`plus search settings user users bell home menu filter …`; lint lists them).
- **Notes are design annotations, never product text.** A `note` says *what this item is for, why it is there* —
  or what is still open about it — the remark you would otherwise be tempted to write into the UI ("TBD", "sample",
  "proposal"). A screen, an element, a list / navbar / sidebar / tabs / breadcrumb / select entry (`items: [{ text,
  note }]`) and a table row (`rows: [[cells], { cells: [...], note }]`) each take one; the product words stay in
  `text` / the cells.
  - **Drawn as callouts**, the way a design review marks a screen: a **numbered pin** on the item itself — a 16 px
    graphite circle on paper with the number, on an element's top-right corner (half outside, so it keeps off the
    element's words), at the end of a list entry, tab, navbar / sidebar / breadcrumb item or table row, after the
    chevron of a closed select — and a **card with the same number** in the **gutter**, a column right of the screen
    (`UI_GUTTER`: 24 px gap, 260 px wide), never on the screen. The card is quiet: the number, the note at 12 px,
    a hairline border, no author line, no reply box, no tether (the number is the link). Point at a pin and its card
    lights up; point at a card and its pin is outlined; click a pin to select its card and bring it into view.
  - **Numbers** run 1…n per screen in reading order: by the top of what the note is about (a row's or an entry's own
    line), tops within 16 px read as one line from left to right, the same spot (a list and its first entry, the tabs
    of one bar) in the order of the file. The cards stack in that order, each at the height of what it explains
    when the gutter is free there, else right below the one before; a card is as tall as its text (`uiCalloutSize`:
    240 px wide, 12 px text on 17 px lines). **The screen's own note** is not a callout: it stays a comment thread,
    first in the gutter, unnumbered.
  - **Notes view** (the board's Notes switch): *all* shows pins and cards; *badges* shows the pins only — the note is
    the pin's tooltip, a click shows that card for this viewer, a second click puts it away; *none* draws neither
    (and Copy as image leaves them out too). While a mock plays, the pins are labels, not controls.
  - **Data contract.** Every note is a `comment` with `role: note`, `color: yellow`, its stable id —
    `<key>.note.<screen>`, `<key>.note.<screen>.<element>`, `….<element>.item-<i>` / `.row-<i>` — and `target` the
    screen or element; an entry's carries `data.item`, a row's `data.row` (the index), and every callout
    `data.callout: <number>` and `data.annotation: { on: '<screen>/<element>' }`. The element's `data.ui` says where
    the pins go: `callout` (and `note`, the pin's tooltip) for its own note, `items[i].callout`, and `rowCallouts: {
    "<row index>": <number> }` beside `rowNotes`.
  - **The file's `annotations:`** (§2b) read like notes: `on: '<screen>/<element>'` is numbered with that element's
    callouts (after its own note at the same spot; card id `<key>.annotation.<id, else the slug of on>`), `on:
    '<screen>'` is a callout on the screen itself (before what is at its top). An element with several numbers keeps
    the first in `data.ui.callout` and lists every one in `data.ui.callouts`.
  - **Conversation is not numbered.** People's comments and agents' threads (`canvas_add_items` without x/y, a
    proposal) land in the same gutter at the height of their target, below the screen's callouts and whatever else
    is there; the frame is fitted to hold every screen's gutter.
  - **Lint** warns (`ui-text-reads-like-a-note`) when a product text — an element's text / label / placeholder /
    hint / value, an item's text / meta, a table cell, a column name — contains a note word: `OPEN TBD TODO FIXME
    sample proposal proposed placeholder lorem` as a whole word, case-insensitive ("Open" the button label is a hit —
    name it "Open board" or accept the warning; `reopen` is not), or `待定 待確認 待決定 示例 範例 假資料 提案`
    anywhere: *reads like a design note, not product text: move it to `note` (on the element, the item or the row),
    and keep the product words here*.
- **`sample: true`** on a screen or an element says this content is sample data (made-up rows, a stand-in name);
  the board shows it as a hatched stripe on the frame, not as a badge inside the product, so nothing in the mock
  has to say "sample" in its own words.
- **Ids.** Every element has an id unique in its screen — `id`, else the slug of its text, else its type — and is
  referenced as `<screen>/<element>` (traces from other diagrams: `<key>/<screen>/<element>`). Give an explicit `id`
  to anything you will talk about: a default id follows the words, so rewording it in the file makes a new item.
- **Drawn** as screens side by side, each a device frame with its name above it, and one `ui` board item per
  drawn element (`role` = its type) inside its screen / card / section / navbar, at the position the template's
  layout gives it (text is measured approximately). Ids: `<key>.screen.<screen>`, `<key>.ui.<screen>.<element>`;
  `data.element` carries the reference, `data.ui` the props (`items[i].note`, table `rows` always as cell arrays
  with their notes in `rowNotes: { "<row index>": note }` — only when there is one —, `sample: true` only when
  set, the callout numbers above), the screen's look and the element's `path` in the file. `goto: <screen>` on an
  element and `flows` draw `navigate` arrows to the target screen. `note` is a numbered pin on the item and a card
  in the gutter beside the screen (above); `traces` work as everywhere (a screen `shows` a story).
- **Talking about it.** Select an element to comment on it or chat about it (the brief names the diagram and file).
  Moving or resizing elements is the person's layout on this board: kept on redraw, never written to the file.
  **Editing an element's words on the board is a proposal**: the item keeps the new words and `data.pending =
  { kind: 'text', before, after, path, key }`, tagged "proposed"; the panel shows before → after and the
  unified diff to the file, with **Ask AI to apply** (a chat request carrying `discuss.edit = { file, base, diff }`,
  the source dialog's protocol, docs/studio.md §9) and **Undo**. A redraw whose file says the new words — or no
  longer has the element — settles it. The same goes for **one value inside an element**: double-click a table
  cell, a list item, a tab, a navbar link, a sidebar or breadcrumb item to change its words — a text proposal for
  exactly that value (`sub: ['rows', r, c]` or `['items', i]`; the diff touches only that scalar, and a number stays a
  number).
- **Removing and adding are proposals too.** Delete (key or menu) on an element does not take it off the board: it
  stays, struck through and dashed red with everything inside it, as `data.pending = { kind: 'remove', before:
  { type, text }, path }`; the diff removes exactly its lines from the file (a list left empty reads `[]`). With an
  element selected and no proposal open, the panel's **Add element** row proposes a new one — button, input, text,
  heading, link, select, checkbox, toggle, badge, alert, image — at the end of the selected screen / card / section /
  navbar, or right after the selected element. It appears dashed with a fresh explicit id (`new-button`, …), its
  words editable in place, as `data.pending = { kind: 'add', node: { type, id, text }, parent | after }`; the diff
  inserts one line `- { type: …, id: …, text: … }` into the right list (or gives the container a `children:` list),
  and containers on the board grow to hold it. Both have **Ask AI to apply** / **Undo**; a redraw settles a removal
  once the element is gone and an addition once an element with that id is drawn. One proposal per element at a
  time. Diffs find the element by its id in the file as it is now, so an older proposal still lands right after
  another one was applied; edits are made in the text, so comments, flow style and every other line stay.
- **Lint** (`awd design lint`, offline): the schema with unknown fields, plus `goto` / `flows` to screens that do
  not exist, table rows whose cell count differs from the columns, unknown icons, children under an element that
  cannot hold them, ids used twice in a screen, product text that reads like a design note (above), and a note that
  only says where a click goes (rule `ui-note-says-where-a-click-goes`: "Click → Settings", "Tap: opens the editor",
  "點擊 → 設定" — an element's `note` or a file annotation on an element, naming a screen by its name or id): write
  `goto: <screen>` instead and keep only the rest of the note — info; one that repeats the element's `goto` / flow:
  drop it — info; one that names another screen than its `goto`: a warning. This one is the lint's alone (how the
  file is written, not the design): the board does not mark it. After a draw,
  `canvas_check_layout` adds the geometry: a comment that covers a screen, an element or another card
  (`comment-covers`), a comment outside the frame its target is in (`comment-outside`). **The board shows the same
  findings** (but for the click notes): the drawing puts each on the
  element it is about (`data.ui.findings`; a `stack` / `row` / `grid`'s go to what holds it, a flow's to the first
  screen) — a small ! (warning) or i (info) mark on the element, "N to check" on the frame, and the list in the
  frame's panel under *Checks*: a click moves the board to the element and flashes it, the › opens its details.
  The selected element's own findings are in its panel too.
- *Not (yet):* real images, overlays (a modal is a card in the flow), responsive reflow when the person resizes a
  screen, moving an element to another place in the file by dragging it, adding a table row or column, Figma import.

### Play

A mock is drawn to be pointed at; sometimes the question is "and what happens when I press this?". **Play** lets
the person operate the screens the way a Figma prototype runs: start it with **Play** on a UI-mock frame's
header, in the frame's side panel, or from the right-click menu of the frame or anything in it — from an element, a
screen, or a note or thread about one, play starts **on that screen** (and Restart goes back there).

- **One screen at a time.** Play starts on the first screen (or the right-clicked one); the others wait faintly where they are, with the
  navigate arrows. A click on an element whose `goto` names a screen — or that a `flows` entry starts from —
  moves the view to that screen; a card (section, navbar) that leads somewhere takes the click anywhere on it,
  except on a field, select, toggle or tabs inside it, which keep their own job. A `goto` to a screen that does
  not exist leads nowhere (lint reports it).
- **The elements work**, as far as the file describes them: a `select` opens and lists its `items` (its `value`
  alone when it has none; pick one and it closes), `tabs` switch, an `input` / `textarea` / `search` takes
  typing, a `checkbox` / `radio` / `toggle` flips. What the person typed, picked and toggled stays while they move
  between screens; Restart forgets it.
- **Controls** (a floating bar at the top of the canvas, the Replay bar's shape): the screen on view by name,
  "2 / 3", ⏮ restart (on the screen play started on), ◀ back to the screen before, ✕ exit. Keys: ← or Backspace back, Home restart, Esc exit —
  none of them while typing into a mocked field.
- **The view follows**: each screen is shown whole, below the bar, never zoomed in past 100 %.
- **Purely a way of looking**: nothing is stored on the board, the file does not change, other viewers are not
  affected. While it plays, nothing in the frame is dragged, resized, wired or edited — a double-click edits no
  words, Delete proposes nothing, the right-click menu stays closed — and the board's edit keys wait. A redraw
  while it plays keeps the screen on view when it still exists, else goes back to one that does.
- **Where a click leads nowhere**, the screen's clickable elements light up for a moment (a heading, text, a badge,
  the empty screen — not a field, select or tabs): the Figma hotspot hint, whatever the Clickable switch says.
- *Not (yet):* buttons without a `goto` (they do nothing), a navbar or sidebar item that leads to a screen,
  typed text that changes what another screen shows, a radio group where one choice clears the others,
  presenting to everyone on the board at once.

### Clickable

Where every click leads, at a glance — for the developer reading the mock, without a "Click → Settings" note per
button: **Clickable** on a UI-mock frame's header (after Play), *Show clickable* in the frame's panel, or **Shift+G**.

- **What it reads** is what Play follows: an element's `goto`, a `flows` entry that starts from it, a card / section /
  navbar that leads somewhere. Each gets a thin outline and a small tag `→ <screen name>` at its top-right corner,
  beside its numbered pins (never on them). Inside a card that leads somewhere only the card is tagged — unless
  something in it leads to another screen. A whole screen, a flow from a whole screen and a `goto` to a screen that
  does not exist are not tagged.
- **The frame's panel lists them** — *Clickable (n)*, by screen in the frame's order, `<element> → <screen>`; a click
  takes the board to the element and flashes it, › opens it.
- **Do the click without playing**: **⌥ click** (Alt+click) an element a click leads from — or right-click it →
  **Click → <screen>** — and the view goes to that screen and flashes it, as Play would; **⌥ ←** comes back. Whether
  the switch is on or not; while a frame plays, a click is Play's.
- **A way of looking**: for this viewer, every UI mock on the board, remembered in this browser
  (`awd.canvas.clickable`); nothing is stored. Copy as image draws it; while a frame plays, Play's own look wins there.
- **So write where a click goes as `goto` / `flows`, never as a note** — lint flags a note that only says it
  (`ui-note-says-where-a-click-goes`, above); keep notes for why an element is there.

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
