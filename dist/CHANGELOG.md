# Changelog

All notable changes to Unprose. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/) (while below 1.0, a minor bump may change
behaviour). Each released version is tagged `vX.Y.Z` on GitHub, with these notes as the release text.

## [Unreleased]

## [0.30.1] — 2026-10-30

### Fixed
- **A trace to a domain story's work object is drawn** (docs/diagrams.md §6b). A work object is drawn once per
  sentence and each card carries its sentence's id, so a trace from another diagram to `<key>/<work object id>` found
  nothing ("target not found on the board") — and when a sentence had the same id as a work object (both `quote`), the
  sentence was quietly drawn as `quote-2`. A trace to a declared work object now goes to its first card, as a note or a
  group on it already did, and `awd design lint` warns when an `id` is already another element's (`id-taken`): a
  story's actors, work objects, sentences, groups and notes share one set of ids.

## [0.30.0] — 2026-10-22

### Added
- **Draw an actor again at one sentence** (docs/diagrams.md §6b "Drawn again at one sentence"). `layout: { actors:
  repeat }` and `repeat: true` only allow a copy, and the layout decides from its own grid: on a board the person
  arranged by hand, "CL1 dials Lead" could still be a long line back to the one Lead, because in the layout's grid CL1
  sits next to Lead. `drawAgain: lead` on that sentence now draws Lead again for it, next to the sentence — with or
  without `repeat`. The lint warns when `drawAgain` names an actor the sentence does not have, and says so when it
  names one at its first appearance; `canvas_read_board` says which sentence asked; Egon.io gets one more actor of
  the same name.
- **A new drawing lands next to where you put its neighbour** (docs/diagrams.md "What a redraw keeps"). A redraw used
  to add a new item where the file's layout put it, which on a moved or locked frame could be far from the item it
  belongs to. Now a domain story's new actor drawing goes next to the actor it was drawn beside, a new work object
  next to its sentence's actor and a new note next to what it is on — where those are on the board — moved aside when
  something is already there, and it keeps that place on later redraws. The preview says "placed next to "CL1", where
  you put it".

### Fixed
- **Inserting a note into a domain story no longer moves the others.** Notes were numbered in file order (`note-1`,
  `note-2` …), so a note inserted in the middle shifted every later id and the places the person gave them landed on
  the wrong notes. A note is now named after what it is on (`note-clerk`; a second one on the same element
  `note-clerk-2`, or the `id` you give it). An older board keeps the person's placement: on its first redraw each
  renamed note takes over the old one's place, folds and threads (an old link to a note, `?focus=…note.note-2`, no
  longer finds it).

## [0.29.0] — 2026-10-22

### Added
- **A domain-story group can have a colour** (docs/diagrams.md §6b), to tell groups apart: `color:` on a group in the
  file (orange, blue, yellow, pale-yellow, lilac, green, pink, red, purple), or right-click the group on the board →
  *Change colour*. It draws a pale wash behind the members — light enough for the arrows and names on it — and the
  dashed outline in its shade, on the page and in the snapshot; Egon.io export colours the group's outline. Grey (the
  default) and white draw no wash, so boards drawn before look the same. A colour chosen on the board survives a redraw
  unless the file gives one.
- **Report a problem · Suggest a feature** (docs/canvas.md "Feedback about Unprose"). Problems and ideas are tracked
  as GitHub issues, and the person files them: Unprose never posts to GitHub. On the canvas page the entry sits at the
  bottom of the keyboard shortcuts (`?`) and the release notes, and under the board list; a small dialog asks for the
  kind, a title and what happened or what would help, says the issue will be public, and *Continue on GitHub* opens
  the new issue in a tab with the form picked and filled in, the running version included — the person checks it and
  submits it under their own account.
- **Issue forms** in `.github/ISSUE_TEMPLATE`: *Report a problem* (what happened, what you expected, how to get there,
  where, the version; label `bug`) and *Suggest a feature* (the problem, the idea, the version; label `enhancement`).
  Blank issues stay allowed. The link fills the fields by their ids; a test checks every id against the forms.
- **File on GitHub** on Connected agents → Feedback from agents: the same dialog, filled with what the agent wrote and
  the tools it named (never the board id or item ids), to edit before going to GitHub.
- **`unprose_feedback` takes `kind: 'bug' | 'idea'` and a `title`**, kept on the record, and its answer has the
  record as a prefilled issue link with one line for the agent: the person files it if they want it tracked; an agent
  files one itself only when asked and with its own GitHub access. `UNPROSE_ISSUES_REPO` sends issues elsewhere
  (default: the repository updates come from, `river0825/unprose`); `GET /api/version` names it as `issuesRepo`.

### Changed
- **Agents are asked to draw icons for a domain story's things**, not to leave every work object a document. The
  built-in work-object icons are generic and a work object without a `kind` is a document, so stories came out as a
  row of identical pages. The `domain-story` prompt, the `domain-storytelling` skill, the tool description and
  AGENTS.md now say: declare the work objects, draw an icon per kind of thing under `icons:` (the main work object
  first, three to seven in a story) and use its name as the kind. The skill has a new `references/icons.md` — when to
  draw one, how (an outline on 24 × 24, stroked in ink, never filled), and a gallery of 22 to copy from (invoice,
  payment, card, order, appointment, reminder, contract, form, contact, shipment, place …).
- **Lint asks when most work objects look alike**, not only when all do: `work-objects-one-icon` now fires when half
  or more of them share one icon, names them, shows an example icon to draw, and points out the ones only named in
  a sentence (they can only get a kind once declared under `workObjects`).

### Fixed
- **One malformed change in a board's log no longer blanks the board** (river0825/unprose#10). A line written by hand
  (a board rebuilt after a loss) without `before` made the history panel throw, and the whole page went blank. Each
  change is now read repaired: `before` missing reads as `{}`, `ops` not a list as none, an op of no known shape is
  left out, an unknown author reads as the agent — and the canvas log says what it repaired, once per change, with its
  seq. The side panel also draws behind an error boundary: if a part of it still fails, it says so in one line and
  the board keeps working.
- **An item can be dragged out of its frame or lane.** It used to stop at the frame's edge. Dropped with its centre
  outside, it no longer belongs to the frame (it stays put when the frame moves or hides); dropped inside another frame,
  lane or column, it joins that one. A frame or lane inside another stays in it. An item drawn from a file and moved out
  keeps its place on a redraw, like any item the person moved.
- **Taking an item out of its frame, lane or column was lost on the way** (a kanban card dropped outside every column,
  the Inspector's *Move to lane or frame → None*): the change was sent as `parent: undefined`, which JSON drops, so the
  item stayed in. An update now takes a key away with `null` (`parent: null`).

## [0.28.0] — 2026-10-22

### Added
- **Fold a line by hand** (docs/canvas.md "Folding a line by hand"), any line — a workflow wire, a domain-story
  activity, an annotation link. Select it: drag the small handle in the middle of a run to fold the line there, drag
  a fold to move it (it snaps level or plumb with the next point), double-click a fold to take it out; dragging the
  label folds the line where you drop it. Several folds per line, straight runs with a slightly rounded corner,
  undoable, kept by a redraw; agents set them as `data.bend: [{ x, y }, …]`. A single bend from an older board (a
  curve through one point) is now one fold.
- **A domain-story arrow is folded around a pictogram it would run through** — the shortest way that clears every
  box and crosses the fewest other story lines; the number and the verb stay on its first run. The page, the
  snapshot and the layout check draw the same; the layout check reports a line still through a box
  (`wire-through`).
- **A domain story may draw an actor more than once** (docs/diagrams.md §6b "Repeated actors"). `layout: { actors:
  repeat }` in the file (or `repeat: true` on one actor) draws an actor again where the story comes back to it —
  as a work object is drawn for every sentence — instead of a long arrow back to its one drawing. The actor is still
  declared once; `once` (the book's rule) stays the default and draws exactly as before. On a 17-sentence story the
  crossings went from 7 to 0 and the lines through pictograms from 4 to 0. Later drawings are `<key>.actor.<id>.2`,
  `.3` …; annotations and traces go to the first, replay brings each in with its sentence, selecting one lights up
  the others, agents read the actor once ("drawn 3 times"), and Egon.io gets one actor per drawing (and gives
  several Egon actors of one name back as one actor that repeats).

### Fixed
- **A domain story's annotation links were not drawn at all**: the note had no handle for its dashed line to start
  from, so the line was dropped. They are drawn again, a little darker (1.5 px, ink-2, dashed 6 / 4).

## [0.27.1] — 2026-10-21

### Fixed
- **Replaying a big domain story stays readable** (docs/diagrams.md §6b "Replay"). The replay used to fit the whole
  story, so on a big frame the names came out at ~5 px. A story that can be read whole still starts whole; a bigger
  one is told sentence by sentence at 100 %, zoomed out only as far as a long sentence needs to be seen whole, and a
  zoom you make while it plays is kept.

## [0.27.0] — 2026-10-15

### Added
- **Hide a frame's contents** (docs/canvas.md "Hiding a frame"). Right-click a frame → **Hide contents**: everything
  it holds, the wires with an end in it and the threads about them are no longer drawn, for everyone on the board; the
  frame stays as a short strip with its title, "N items hidden" and **Show**. One ordinary, undoable change
  (`data.hidden` on the frame) that a redraw keeps. A jump to something inside lands on the strip and says so; nothing
  is dropped into it. Agents see one line per hidden frame in `canvas_read_board` and `canvas_context` — not what it
  holds, unless `includeHidden: true`; the layout check, `canvas_snapshot` and the thumbnail leave it out too. Hiding
  an unused mock is also the quickest way to make a big board light: on a 3,824-item board, hiding its 2,681-item
  mock cut opening to 0.9 s and a change by someone else to under 0.15 s.

### Changed
- **A big board is fast again.** Measured on a 3,824-item board with a 108 MB change log: opening went from 5.8 s to
  1.4 s, and a change by someone else (an agent's add or move) is drawn after 0.15–0.3 s instead of 4–5 s.
  - Wires are planned again only near what changed (a move or an add re-planned every wire on the board), and the
    crossings are counted by intervals — the same routes, ~20× faster.
  - The page loads the latest 300 changes, trimmed for the Changes tab (`GET …/changes?last=N&brief=1`), not the
    whole log: 97 MB → 1 MB (33 s → under 1 s through a tunnel). A change's ops are drawn only once it is opened.
  - The panel re-reads the board's meta alone (`GET …/meta`), not the whole board, and only after a redraw.
  - The Chats list is gathered in one pass over the comments, not one per thread.
- **A redraw writes only what changed.** An item the file draws exactly as it is gets no op; before, every drawn item
  was rewritten (a big UI mock: ~3,000 ops and 3.6 MB of log per redraw, sent to every open page).
- **A redraw from another machine downloads no log**: `awd design draw`, `design_draw` and `awd graph --canvas` read
  what they need from it — who moved, added and deleted what — from `GET …/redraw-inputs` (245 KB instead of 97 MB),
  kept by the canvas per board; an older canvas is read as before.
- **The canvas reads its change log through an index**: `changes`, `diff` and every `canvas_wait` check read only
  what is new (~260 ms → under 1 ms on a 108 MB log, without blocking the server); a torn last line no longer breaks
  reading the log.

### Fixed
- After a redraw, undoing your own move no longer says the agent changed the item since: an unchanged item is no
  longer re-stamped by the redraw.

## [0.26.0] — 2026-10-13

### Added
- **Do a UI mock click without playing**: ⌥ click (Alt+click) an element a click leads from, or right-click it →
  **Click → <screen>**, and the view goes to that screen and flashes it — ⌥ ← comes back (docs/diagrams.md §6c
  "Clickable").
- **A diagram whose frame is gone is told to agents.** Removing a frame (over `/ops`, or on the page) leaves the
  diagram registered — its holder and file snapshot. `canvas_read_board` and `canvas_context` now say so, with the two
  ways out: the holder redraws it from the file, or drops the entry (`PATCH /api/boards/:id
  {"meta":{"diagrams":{"<key>":null}}}`); `GET …/settings` lists them as `frameless`.

### Changed
- **Right-click → Play starts on that screen.** Play from the menu of an element, a screen, or a note or thread about
  one starts on its screen instead of the first, and Restart goes back there; Play on the frame header or panel still
  starts on the first.

## [0.25.0] — 2026-10-13

### Added
- **Clickable — where every click leads, at a glance** (docs/diagrams.md §6c "Clickable"). A UI mock's frame header
  has a **Clickable** switch after Play (also in the frame's panel, and **Shift+G**): every element a click leads from
  — its `goto`, a `flows` entry, a card that leads somewhere — gets a thin outline and a small `→ <screen>` tag, and the
  frame's panel lists them all by screen; a click on a row takes you to the element. It reads what Play follows, so a
  developer sees every clickable item without a "Click → Settings" note on each. Per viewer, nothing stored; Copy as
  image draws it.
- **Play shows its hotspots**: a click on something that leads nowhere lights up the screen's clickable elements for a
  moment.
- **Lint: a note that only says where a click goes** (`ui-note-says-where-a-click-goes`): "Click → Settings",
  "Tap: opens the editor", "點擊 → 設定" — write `goto: <screen>` instead; a note that repeats its `goto` can go; one that
  names another screen than its `goto` is a warning. Told by `awd design lint` / `design_lint` only, not marked on the
  board.

### Fixed
- **A redraw leaves no stale notes behind.** A UI mock screen's own note now goes when the file drops it, like the
  numbered cards; a note someone replied to is no longer deleted under its replies — it stays as a thread about the same
  item, without a number.
- **The layout check sees a card lying on another card** (a stale note stacked on live ones, two at the very same
  spot) — `canvas_check_layout` and the frame panel's *Layout*.

### Changed
- **`null` in a comment update's `data` removes that key** (`POST /api/boards/:id/ops`): the canvas merges a comment's
  data, so leaving a key out never took it away — the same convention as `PATCH /api/boards/:id` for `meta`.

## [0.24.0] — 2026-10-12

### Added
- **Annotations — what an item is for — in every diagram kind** (docs/diagrams.md §2b, docs/canvas.md →
  Annotations). Until now the board only had comments, which are conversations. A design file now takes
  `annotations: [{ on, text }]` (EventStorming, story map, journey, kanban, wireframe, UI mock, workflow; a domain
  story keeps its Egon.io annotations). Each is drawn the way UI mock callouts are: a small **numbered pin on the item**
  and a quiet **card with the same number** beside the drawing — in a band below it for the wide kinds, right of the
  screen for UI mocks and wireframes — with no author line and no reply box, so nobody reads it as a thread.
  `awd design lint` reports an `on` that names nothing.
- **The person writes annotations on the canvas.** Right-click an item → **Annotate…** (or the item's panel). On an
  item drawn from a file it becomes a **draft** — a dashed card with ✎ — and a proposal to the agent holding the
  files, with the one-line file edit attached. That agent judges it in its thread first (true to the design? at odds
  with the file or another annotation?) and, when it is sound, applies it at once — the person wrote it, which is
  consent — else says why and waits; the redraw draws the numbered card and the draft goes away. On an item with no
  file behind it, the card is written on the board itself. Agents see annotations as annotations:
  `canvas_read_board` lists them per diagram, not as threads (`types: ["annotation"]`).
- **TODOs — something still to confirm with someone else** (docs/canvas.md → TODOs). Right-click → **Add TODO…**
  (with an optional *ask whom*) puts an amber square on the item and a card with a check box beside it; the board
  panel's **TODOs** section lists them. A TODO lives on the board only and wakes no agent when it is written. Checking
  it off asks *What did you find out?*: an answer is posted in its thread and goes to the Answered-by agent, which
  decides whether the design changes; without one nobody is told. Agents open, list, check off and reopen TODOs with
  the new **`canvas_todo`** tool; `canvas_context` counts open TODOs and drafts waiting.
- **Copy link in the right-click menu** of every item, comments and annotation cards included — the same link as the
  panel's *Copy link*. A `?focus=` link opens a comment, a card or a TODO even when the view switches hide it.

### Changed
- **The Notes switch is three switches:** *Comments* (All / Badges / None, Shift+N — threads only), *Annotations*
  (All / Pins / None, Shift+A; *Pins* keeps the numbers and shows a card on click) and *TODOs* (Open / All / None,
  Shift+T). UI mock callouts follow *Annotations* now. Copy as image draws what the switches draw.
- **A wireframe's `note:` is a numbered annotation card**, no longer a comment thread.
- **A redraw removes a numbered card whose annotation left the file** (UI mock notes too); a card the person moved
  keeps its place.
- `canvas_snapshot` draws annotation cards with their numbered pins, and TODOs as check boxes.
- Studio's brief for a draft annotation says: judge it, then apply it at once when it is sound.

## [0.23.0] — 2026-10-08

### Changed
- **UI mock notes are callouts, not a column of sticky notes.** v0.21 moved every note of a mock into the gutter
  beside its screen, where nothing said which note was about which item. Now a note on an element, a list / tabs /
  navbar / sidebar / breadcrumb / select entry or a table row is drawn the way a design review marks a screen: a
  small **numbered pin on the item itself** and a quiet **card with the same number** beside the screen, numbered
  1…n per screen in reading order; cards are as tall as their text. Point at a pin and its card lights up, point at a
  card and its pin is outlined, click a pin to select its card. *Notes: Badges* keeps the pins (the note as tooltip),
  *None* hides pins and cards, also in Copy as image. The screen's own note stays an unnumbered thread; people's
  comments and agents' threads go below the callouts. Data: `data.callout` on the note comment; `data.ui.callout`,
  `data.ui.note`, `items[i].callout`, `rowCallouts` on the element. Redraw a mock to get the numbers. The sample
  mock's notes now say what four of its items are for.

## [0.22.0] — 2026-10-08

### Added
- **Hand the files behind diagrams over to another agent** (docs/canvas.md → Handing over the files). A board drawn
  by one agent (say, the one with the meeting notes) can now be led by another (the one that reads the code): the
  person opens **Hand over files…** in the board panel (or **Hand over…** on a frame's panel), picks the diagrams —
  all checked by default — and the agent, and leaves **Also make it Answered by** on. The holder settles its open
  proposals, redraws what changed and marks the files ready (`canvas_handover({ ready: true })`), or the person hands
  them over anyway when it is gone; the new agent accepts (`canvas_handover({ accept: true })`), gets the list of files
  to copy into its repo with `canvas_files` and redraws once from its copy. Its holder line keeps where the files came
  from (`holder.from`, `holder.handover`). Every message of the handover thread reaches both sides, also with
  `untilMention`; the panel shows who it waits for; the finished thread folds into a ✓. Only the person starts a
  handover (`POST /api/boards/:id/handover`, then `…/ready`, `…/accept`, `…/cancel`; `GET …/handover`).
- MCP **`canvas_handover`** (local and `/mcp`): the status, `ready`, `accept`, `cancel`. `canvas_context` and the
  top of `canvas_read_board` say what the open handover waits for.

### Changed
- **Only the holder redraws a diagram.** Until now any agent that redrew a diagram silently became its holder, so two
  agents could take it from each other. Now a draw that would take over, change or drop a diagram (or the workflow)
  another agent holds is refused before anything is drawn — `design_draw` (local and remote), `awd design draw`,
  `awd graph --canvas`, and `PUT` / `PATCH` of the board meta (`409`): *the files of "<key>" (<file>) are held by
  <agent>: you cannot redraw them. Propose instead (canvas_files → canvas_propose_edit), or ask the person to hand them
  over to you (board panel → Hand over files).* A diagram nobody holds yet is free for the first drawer, as before; a
  `PUT` that leaves out another agent's diagram keeps it. `GET /api/boards/:id/settings` also returns `handover`.

## [0.21.0] — 2026-10-08

### Added
- **UI mock: notes beside the screen, never on it.** Every screen has a gutter column to its right (24 px gap,
  260 px wide; docs/diagrams.md §6c): the screen's `note` goes at its top, the element notes stack below it in the
  order of what they are about, and comments added later (`canvas_add_items` without x/y, a proposal) land in the
  same gutter below what is there — `src/place.ts` finds the screen through the target's parents. The diagram frame is
  fitted to hold every gutter. Before, a screen note sat on the top-right corner of the screen and an element note
  on its right-hand neighbours.
- **Notes on list items and table rows.** `items: [{ text, note }]` and `rows: [[cells], { cells, note }]` carry
  a design note where there was no place for one, so "TBD" and "sample" stop being written into the product text.
  Drawn: `data.ui.items[i].note`, `data.ui.rowNotes: { "<row index>": note }` (rows stay cell arrays), and a gutter
  comment per note — id `<key>.note.<screen>.<element>.item-<i>` / `.row-<i>`, `target` the element, `data.item` /
  `data.row` the index.
- **`sample: true`** on a screen or an element: this content is sample data; passed through as `data.ui.sample`
  so the board can mark it on the frame instead of a badge inside the product.
- **Lint `ui-text-reads-like-a-note`** (`awd design lint`, `design_lint`, the board's *Checks*): a warning when
  product text — an element's text / label / placeholder / hint / value, an item's text / meta, a table cell, a
  column name — contains a note word (`OPEN TBD TODO FIXME sample proposal proposed placeholder lorem` as a whole
  word, case-insensitive; `待定 待確認 待決定 示例 範例 假資料 提案` anywhere): *reads like a design note, not
  product text: move it to `note` (on the element, the item or the row), and keep the product words here*.
- **The layout check sees comments** (`canvas_check_layout`, `GET /api/boards/:id/layout`, the frame panel):
  `comment-covers` when a comment's box lies on an item (a frame or lane is the paper, a UI-mock screen is the
  product — the fix names the screen's gutter) and `comment-outside` when its target is inside a diagram frame but
  the comment is not. Both carry `severity: 'info'`.

### Fixed
- `design/unprose-board-list.ui.yaml` no longer says "proposal" / "Proposed" in its activity rows (the new lint
  would flag them); the rewire row carries the question as a row note and the table is marked `sample: true`.

### Changed
- **Notes have a switch, finished proposals fold by themselves, annotations stay outside the mock.** Comments
  piled up on UI-mock screens and a design note was easily read as product text (docs/canvas.md → Notes). The
  settings in the bottom-right corner now have **Notes: All / Badges / None** next to Lines and Traces (shown when
  the board has a comment; **Shift+N** cycles; per viewer, `awd.canvas.notes`; the button says `Lines: all · Notes:
  badges`): *Badges* folds every comment — notes, threads, a loose comment about the board — into a marker at what it
  is about, opened by a click; *None* draws none (the panel's Chats tab still lists them). A proposal thread
  (`prop_…`, or one carrying `data.discuss.edit`) that was answered *Applied to <file>* — or declined with the
  button — is drawn as a quiet **✓** at its anchor in every mode; click it to read the thread, fold it to put the ✓
  back. On a UI mock, `data.ui.items[i].note` (list entry, tab, sidebar / navbar item, select option) and
  `data.ui.rowNotes` (table rows) draw a small graphite **ⓘ** at the end of the row with the note as its tooltip;
  pointing at it lights up the note comment about that row. `data.ui.sample: true` on a screen or element draws a
  hatched *sample* stripe along the outside of its top edge, nothing inside the box. While the mock plays these
  are labels only. The rules are pure (`web/src/flow/notesView.ts`) and tested.

## [0.20.0] — 2026-10-08

### Changed
- **One word per kind of line, one panel section for all of them.** Every line on the board is an arrow; the
  panel used to show them in three places with three vocabularies (*Wiring*, *Connected*, *Traces*) and listed a
  trace twice. Now a selected item has one **Links** section (docs/canvas.md → Wires): *In this <diagram>* — a
  workflow block's *Listens to* / *Emits* first, then the arrows inside the diagram —, *Across diagrams* — the
  traces, with their relation and the other diagram's kind — and *Drawn on the board* — lines a person drew that
  are in no file, said so. A selected line is headed by what it is: **wire** (a workflow's event line), **trace**
  (between diagrams), **arrow** (inside a diagram) or **link** (hand-drawn). The settings button and **W** say
  *Lines* for everything but traces; *wire* now means a workflow's event line only.

## [0.19.0] — 2026-10-08

### Added
- **The way back after a panel link moved the view.** A link in the panel (Traces, Connected, "Same work object,
  also in") brings the view to that item while the selection stays where it was; now **2** brings the view back to
  the selection (*⌖ show on the board* at the top of the Selected tab does the same), and **⌥←** / **⌥→** step back
  and forward through the places the view jumped from — a panel link, a locate, ⌘K, an agent's focus, *Take me
  there* — like a browser (flow/viewHistory.ts, 20 places; a wheel or a drag is not recorded). `?` lists them.

## [0.18.0] — 2026-10-08

### Added
- **Play a UI mock** (docs/diagrams.md §6c "Play"): *Play* on a UI-mock frame's header, in its panel or in the
  right-click menu lets the person operate the screens — a click on a button (or a card) whose `goto` or `flows`
  entry names a screen moves the view there, a select opens its `items`, tabs switch, fields take typing,
  checkboxes and toggles flip — with a bar like the domain story's Replay (the screen on view, back, restart,
  exit; ← Backspace Home Esc). Only this viewer's view changes: nothing is stored on the board, the file is not
  touched, and nothing in the frame can be edited while it plays. The sample mock's Project select got `items`.

### Fixed
- **A big board no longer re-draws itself on every hover, click or change.** On a 329-item board every wire
  subscribed to the whole node list, so pointing at a sticky, selecting one, dragging one or one incoming change
  re-routed and re-labelled all 120 wires (hovering 30 nodes: 777 ms of main-thread work, a 10-step drag: 484 ms,
  five incoming changes: 675 ms); the edit context and React Flow's handlers were new functions on every render, so
  every node and wire re-rendered with the page; a change rebuilt every node, so React Flow re-measured all of them.
  Now a wire reads only the boxes it can meet and only when one moved (flow/obstacleBoxes.ts), the context and the
  handlers stay put (reading the latest state from a ref), unchanged nodes and wires keep their objects across a
  change (flow/reuse.ts), the agent-change wash no longer rebuilds the graph, a wire's planned sides are kept while
  nothing moved, and a hover is tracked only on an element it can light up. Same board: 289 ms, 166 ms, 245 ms;
  every wire path and label comes out the same.

## [0.17.0] — 2026-10-06

### Added
- **A `domain-storytelling` skill** in the plugin (skills/domain-storytelling/): the method as the authors state it —
  when a domain story is the right diagram and when not, scope, the language, the authors' do's and don'ts, the
  moderator's questions, how to review — with the book's pages, good / bad examples, where what does not happen goes,
  checklists, and the mistakes agents actually made. Any agent with the plugin loads it when it writes, draws or
  reviews a story; the `domain-story` and `critique` prompts ask for it.

## [0.16.1] — 2026-10-06

### Changed
- **Where what does not happen goes in a domain story** — the `domain-story` and `critique` prompts, the tool
  guidance and docs/diagrams.md §6b now say it: the case told is an assumption on the whole story, a sentence that
  would not happen gets a variation note, a stretch sometimes skipped is an optional group, the rule itself lives in an
  EventStorming policy or the story map's acceptance, a rejected alternative in the decisions kanban — never a story
  of its own.

## [0.16.0] — 2026-10-06

### Changed
- **The method is where an agent acts, not only in docs/.** An agent that drew a domain story of things that did not
  happen had read only the file format: the tool descriptions said format, lint said "0 notes", and it never met the
  start prompt. Now `design_draw` and `design_lint` (local and remote), the MCP content help and `unprose_help` say
  which diagram holds which content and what a domain story is (one case, no "not", told with the person, layout
  never changes the story); AGENTS.md's first step and the skill say the same; docs/diagrams.md §6b opens with what
  a domain story is for and not for.
- **A domain story's lint and draw results end with the story read back** ("did the person say this, or did you
  guess?") — the grammar check cannot see a wrong diagram or a guessed actor; an agent reading its own sentences can.

### Added
- **Three more reviewer's hints** for domain stories: most sentences about what does not happen (`negative-story`),
  several work objects whose names start with the same word (`work-objects-variants`), a date inside a verb
  (`date-in-verb`).

## [0.15.0] — 2026-10-05

### Added
- **A switch for trace wires** (docs/canvas.md → Wires): **Traces: All / Faded / Bundled / Selected / None**
  (Shift+W cycles; per viewer). *Selected* draws only the traces of the selected or hovered element,
  *Faded* draws the others faintly, *Bundled* draws one line per pair of diagrams with the number of traces it stands
  for (click to open it). *Counts* marks every element that has traces with a faint `↗ n`, and the four
  relations (來自 / 組成 / 畫面 / 相關) can be switched off.
- `canvas_snapshot` takes `traces: 'none'` (`?traces=none`) for a picture without trace wires.
- **Domain stories: the same work object lights up everywhere.** A work object is drawn once per sentence that
  touches it; selecting or pointing at one now puts the selection wash behind the others, and the Inspector lists the sentences
  ("Same work object, also in …"), so "is this the same one?" no longer needs asking.

### Changed
- **The line settings are one button in the bottom-right corner** (`Traces: selected · Wires: all`) that opens the
  trace view, the wire modes and the catch-all switch, instead of rows of buttons always on the board.
- **Traces are drawn for the selection only by default** — a board with several diagrams had too many dotted lines
  to read. Choose *All* to see them as before. The **Wires** modes no longer hide or show traces.

## [0.14.0] — 2026-10-05

### Added
- **A reviewer for domain stories: `/unprose:critique`** (the `critique` start prompt). An agent reads a story —
  the sentences, the picture, the lint hints — holds it against the method (scope and one level of detail, one
  concrete case, sentences read aloud, actors that act, work objects that are things and come back under the same
  name, intent instead of screens) and answers with questions and rewritten sentences, saying for each finding
  whether the method states it or it is the reviewer's judgment. It advises; it changes nothing.
  `docs/domain-story-review.md` has the rules with their sources (Hofer & Schwentner's book, the quick-start guide).
- **Reviewer's hints in `awd design lint` / `design_lint` for domain stories** (`info`: questions for the
  conversation): the scope does not state its granularity (coarse-, medium- or fine-grained), time or purity
  (`scope-missing`); `pure` with a software system among the actors (`scope-purity`, a warning); every sentence
  between one user and one system (`request-response`); "if" / "or" in a sentence (`conditional`); a work object
  that reads like an outcome, e.g. "check passed" (`work-object-outcome`); no work object in more than one sentence
  (`work-objects-never-repeat`); every work object drawn with the same icon (`work-objects-one-icon`); a kind with
  no icon (`icon-unknown`).
- **Icons of your own in a domain story**: `icons: { <name>: '<svg viewBox="0 0 24 24">…</svg>' }` in the file, used
  as an actor's or a work object's `kind` (docs/diagrams.md §6b). Only plain shapes are read out of the SVG —
  path, circle, ellipse, rect, line, polyline, polygon — and the board, the snapshot and the Egon.io export draw
  from that list; styles, scripts, images and links are ignored. An icon with nothing to draw is a lint warning
  (`icon-invalid`).

### Changed
- **The `domain-story` start prompt** settles the scope first (granularity, as-is / to-be, pure / digitalized; one
  level of detail per story) and names what to hold each sentence against: one concrete case, intent instead of a
  user-asks / system-answers flow, work objects named as things and never hidden in a verb, a small icon set that
  fits the domain.

## [0.13.0] — 2026-10-05

### Fixed
- **Domain stories no longer draw things on top of each other** (docs/diagrams.md §6b "No collisions"), from a real
  board an agent reported:
  - an actor that sends to itself (`actor: cl, to: cl`) used to put the actor and those work objects at the very same
    spot; the work object now sits beside the actor (on a free slot whose arrow passes no other pictogram) and the
    redundant return arrow is left out. No two pictograms ever share a spot: a final pass moves a work object to the
    nearest free place.
  - group outlines shrink-wrap their members; a group whose members all belong to another is drawn inside it, groups
    that would touch are trimmed apart, and groups that share members are marked (`data.overlaps`).
  - annotations are sized from their text (wrapped within 280 px, the height grows) instead of a fixed 200×64 box that
    cut long bilingual notes; the page, the snapshot and the layout check now measure them alike (12.5 px).
  - verbs and sequence-number circles are placed for the whole story (`planWires`, shared by the page, the snapshot
    and the layout check): circles at their arrow's start, moved along when taken; verbs off the pictograms, the
    circles, the group titles and each other.
  - a label the person dragged is measured whole (it used to count as a 10 px dot in the snapshot and the check).
- **`awd design lint` for domain stories** warns on sentences sent to their own actor (`self-receiver`), on groups that
  share members (`groups-overlap`) and on notes over 120 characters (`note-long`, CJK counting double).
- **`canvas_check_layout` sees wires and groups.** It now checks domain-story number circles (on a pictogram, on each
  other), labels on circles or other labels (every diagram kind), domain-story group outlines against each other
  (new kind `group`), and annotation text against its box, and says how many wires it checked ("… items and … wires
  checked") — it used to report "nothing overlaps" on a board full of collisions.

## [0.12.0] — 2026-10-03

### Added
- **`canvas_snapshot` returns a PNG on every install.** resvg (`@resvg/resvg-js`) is now an optional dependency of the
  canvas, so a checkout draws PNGs out of the box. The plugin, which ships a bundle without `node_modules`, downloads
  this platform's prebuilt resvg native (~2 MB) from the npm registry on the first PNG request, once, into
  `${CLAUDE_PLUGIN_DATA}/native/resvg/<version>/`:
  - pinned to the exact version and sha512 integrity in `package-lock.json` (baked into the build,
    `scripts/resvg-pins.mjs`); a tarball that does not match is never unpacked;
  - only the `.node` file is extracted — no install scripts run; a lock keeps two canvases from downloading at once;
  - offline, an unsupported platform or a mismatch → the SVG with a one-line reason, as before.
  - `UNPROSE_SNAPSHOT_PNG=never-download` never uses the network, `download` prefers the downloaded native, `0` turns
    PNG off; `UNPROSE_NPM_REGISTRY` sets a mirror.
- The snapshot says which renderer drew it (`renderer: resvg 2.6.2 (npm package …)`, `… (downloaded native, <path>)`
  or `svg`; HTTP: `renderer` in `x-unprose-snapshot`).
- **Project website** at https://river0825.github.io/unprose/ (English and 繁體中文): a static page in `site/`, deployed to
  GitHub Pages from the public repository by `.github/workflows/pages.yml`; linked from both READMEs.

### Fixed
- **Redrawing an unchanged kanban moves nothing.** The first redraw of a kanban frame used to shift every column
  and card 20 px up and left (`awd design draw --dry-run` listed "x, y" on each): a new frame grew out by its
  padding around content that starts at its corner, and the redraw then drew from the frame's corner. Content
  that starts closer to the frame's corner than its padding is now moved in by the difference on the first draw
  and every redraw alike, so a redraw of an unchanged file — also with a moved or locked column — changes nothing.
- **Requests for manage rights reach only pages that may manage.** The `/ws` socket sent them (the requester's
  name and address) to every page that may approve connect requests, including signed-in browsers without manage
  rights. Now only pages on the canvas machine and browsers with manage rights get them (also in the backlog sent
  when a page connects); connect requests still go to every page that may approve, and pages opened from
  elsewhere still get them without local paths.
- A snapshot whose notes held a non-ASCII character (a reason's dash) failed with "Invalid character in header
  content"; the `x-unprose-snapshot` header now escapes it.


## [0.11.0] — 2026-10-02

### Changed
- **Waiting on a board costs fewer tokens.** Every time `canvas_wait` returns, the agent's model re-reads its
  conversation; an idle agent woke about 30 times an hour.
  - `canvas_wait` blocks up to 30 minutes (`timeoutSec` ≤ 1800, default 300; also the remote `/mcp` and
    `GET /wait`, `timeout` ≤ 1 800 000 ms).
  - A wait with nothing for you returns one line — `nothing new on b_x (seq 93; 2 change(s) for others) — wait again
    with since: 93` — without the board context. The context comes with the first wait on a board and after it
    changes; over the stateless remote `/mcp` the canvas remembers per agent × board what it sent (15 minutes after
    the last wait; `GET /wait?context=changed`).
  - New `untilMention: true` (`GET /wait?until=mention`): wake only when you are addressed personally (an @mention,
    a reply in a thread you were mentioned or asked in, a proposal to files you hold), to idle on a busy board.
  - Long waits stay connected: `GET /wait` sends a space every 20 s before its JSON (proxies, and Node's `fetch`
    after 300 s, drop silent requests); `canvas_wait` reports MCP progress every 20 s when the client sends a progress
    token. When the client goes away the wait ends at once and the page stops showing "agent is watching".
  - Docs: "Watching cheaply" in docs/canvas.md (studio for always-on watching, client timeouts: Claude Code
    `MCP_TOOL_TIMEOUT`, Codex `tool_timeout_sec`); the skill and AGENTS.md say to wait long and not poll.
- **Domain stories are drawn roomier.** Every activity arrow gets room for its number circle and verb, measured with
  the snapshot's text metrics. A new file option `layout: { spacing: compact | normal | roomy, gapX?, gapY? }`
  (docs/diagrams.md §6b): `compact` keeps the earlier spacing. Egon.io import/export ignores it.

### Fixed
- **Wire labels never cover cards.** On a real board the label "updates · 更新視圖" sat over both cards it joined.
  A label is now 11 px (cards are 13 px; a domain-story verb 12 px) on a lighter backing, and it is placed where it
  covers no card: along the wire, then beside it; if it does not fit it wraps to two lines, then is cut with … (the
  whole text in the tooltip and while the wire is selected); with no room at all it becomes a small dot on the wire
  that shows the label on hover or selection. The page, the server snapshot and the layout check share one rule
  (`src/edgeLabel.ts`). `canvas_check_layout` reports `[label]` findings (cut, hidden as a dot, or dragged onto a
  card) with how far to move a card or what short form to give. Agents steer a label with the supported
  `data.label: { at: 0..1, short }` on the arrow (docs/canvas.md "Wires → Wire labels").
- **A wire or item the person deleted stays deleted on redraw.** Deleting a file-drawn wire or item in a diagram frame
  now marks it deleted (`data.pending: { kind: 'remove', deleted }`, drawn struck) instead of dropping it, so the next
  redraw cannot bring it back from the file. The panel offers **Ask AI to remove it from the file** and **Undo**.
  Deletions made earlier or over the API are found in the change log. The dry run lists these as "kept removed: you
  deleted it — the file still has it; propose the file change?". Once the file drops the item it is removed for good
  and the mark goes with it (docs/diagrams.md "What a redraw keeps").
- **EventStorming reads left → right only.** A retry or revision is drawn as a later occurrence of the sticky
  (`<id>.again`, `data.repeats`) instead of a wire looping back. A read model that informs a command sits on the row
  between its event and that command, so a sequence such as compose → cadences created → cadence library → configure
  → experiment configured stays on one row. Variant branches get their own row (docs/diagrams.md §3).


## [0.10.0] — 2026-10-02

### Added
- **Agents can read big boards.** Two agents told us `canvas_diff` returned 135 000 characters and
  `canvas_read_board` json 298 000, so they grepped saved files instead. Now every answer has a size cap: 40 000
  characters by default, `maxChars` up to 200 000. A capped answer ends with what was left out and the exact call for
  the next page (`cursor`).
  - `canvas_read_board`:
    - New filters: `frame` (a diagram key, or a frame / lane id), `types` (types or roles, e.g. `["comment"]` or
      `["hotspot"]`), `ids`, `text` and `fields`.
    - `format` is now `outline` | `json` | `summary`. `summary` gives counts per frame and the threads still waiting
      for an answer; start there on a big board.
    - Pages with `limit` and `cursor`.
    - `json` returns one item per line. Bulky `data` (UI mock trees, workflow details, proposal diffs) is summarised
      unless you ask for it in `fields`, and the board meta is listed by key only.
  - `canvas_diff` and `canvas_wait`:
    - New filters: `frame`, `from` (agent names, `person`, `studio`) and `kinds`
      (`add | update | remove | comment | move`).
    - `summary: true` returns counts by who × kind × frame and the last lines.
    - `canvas_diff` folds moves within a lane like `canvas_wait` does (`?moves=each` on HTTP lists every one) and
      takes `limit` / `cursor`.
  - The HTTP routes take the same query parameters: `GET /api/boards/:id/read`, `/outline`, `/diff`, `/changes`,
    `/wait`.
- **The outline groups by diagram frame.** It now reads diagram frame → lane / column / screen / group → items.
  - Before, a frame without a parent could be counted as sitting inside its own lane, so the frame was never printed
    and every item of a story map ended up under "(unplaced)".
  - Kanban columns show their card count and the cards in stacking order. Domain stories list their sentences in
    order. UI mock screens nest their cards and elements.
  - Each diagram lists its own wires. Items show `[proposed add by codex-b]`, threads show
    `[waiting for an answer]`, and frame headers name the holder of the files.
- **`canvas_snapshot`: agents can see the board.** It renders a frame, items or the whole board on the server, close
  to what the page draws:
  - stickies in the theme colours, with wrapped text and role labels;
  - kanban columns, with cards where they stack;
  - frames, lanes, wires with arrowheads and labels, UI mock elements, Domain Storytelling pictograms and comment
    badges;
  - light theme, or `theme: 'dark'`.

  The tool returns a PNG when the optional `@resvg/resvg-js` is installed next to the canvas, otherwise the SVG, and
  the answer says which. Over HTTP: `GET /api/boards/:id/snapshot?frame=&ids=&scale=&maxPx=&theme=&format=png|svg`.
- **`canvas_check_layout`.** Pure geometry, with a fix suggested in plain words for each finding:
  - items overlapping their siblings;
  - text likely cut off, using the page's text metrics;
  - items outside their frame or off their lane;
  - stickies and cards oversized against their siblings or the template size;
  - cards the page draws somewhere other than their stored coordinates (kanban stacking).

  The same findings show under **Layout** in the frame panel. Over HTTP: `GET /api/boards/:id/layout`.
- **`canvas_approve` for the agent on the canvas machine.** It approves a pairing code the person read out to it,
  replacing curl with a hand-made Origin header. The canvas accepts it only from loopback with no token, no session
  and no browser headers. It is never offered over the remote `/mcp`. It has the same limits as the page's "Enter a
  code", and each approval is logged in the change feed of the board you name, and in the canvas log. The security
  reasoning is in docs/canvas.md → "Who may approve and manage".
- **Redraw preview.** `awd design draw … --dry-run [--limit N]`, `awd graph <wf> --canvas --dry-run` and
  `design_draw { …, dryRun: true }` (local and remote MCP) print what a redraw would do, per frame, and write nothing
  (no board created, no project registered, no ops, no meta): counts, then up to N lines each for *added*, *updated*
  (with the fields), *removed*, *kept where the person moved it*, *kept: locked*, *proposals held / settled* and
  *not from this file (kept)* — with who added each foreign item.
- **Layout lock.** Right-click an item → **Lock position**, a frame → **Lock layout** (a lock badge shows; a locked item
  is not dragged or resized until **Unlock**). Agents lock with `canvas_apply` ops `{kind: 'lock', id | frame}` /
  `unlock` (they may unlock only what an agent locked). Redraws and the kanban auto-layout never move or resize a locked
  item; a locked frame keeps everything in it. Kanban: a kanban in a locked frame is shown exactly as stored; a locked
  column keeps its place and height while the others flow around it; a locked card keeps its place and the others
  stack around it.
- **"What a redraw keeps"** (docs/diagrams.md): one table for the file, the board's file snapshot, the person's layout,
  locks and items nobody drew from the file. Geometry follows **locked > moved by the person > the file**; content
  follows the file.
- **Change an agent's access in place.** Connected agents → *Change access* on a row switches read only ↔ read and draw
  and the projects / boards a token, OAuth client, device-code agent or browser session may use; the agent keeps its
  token and gets the new access on its next request (`PATCH /api/access/agents/:id { scope, projects, boards }`). Every
  change is written to an **access log** shown to pages that manage (who, when, "changed codex-b: access read only →
  read and draw; boards all → b_…"), with tokens made, renamed, revoked and forgotten, requests let in, and manage
  rights asked for and given.
- **"Why can't I change or revoke agents here?"** A page reached through the tunnel that may not manage agents says why
  next to its disabled buttons, and how to get the right: open it on the canvas machine (`http://localhost:4400/agents`,
  or `ssh -L 4400:localhost:4400 <host>`), or **Request manage rights** for this browser — a pairing code that the
  canvas machine (one click) or a browser that already manages agents (typing the code) allows from its
  *"… asks to manage agents"* card. Same limits as connecting: 10 minutes, five wrong codes lock it, 3 waiting per
  address; a browser never approves its own request, and pages that do not manage are not shown it.
- **What each surface can do**: a table in docs/canvas.md of what the web UI, the `awd` CLI, the local MCP and the remote
  `/mcp` can each do (draw from a path or from content, files, proposals, redraw preview, layout lock, images, pairing,
  tokens, upgrade, projects, replay); a short version in `unprose_help` and the skill.
- **Bilingual boards**: guidance in docs/diagrams.md, the start prompts and the content help — a short bilingual title on
  the card, the full text in `description` / `acceptance` / `note` / `definitions`, recommended maximum lengths per kind;
  never enlarge stickies to fit text.

### Changed
- **"Answered by" is the person's choice.** An agent that draws a new board (`awd design draw`, `awd graph --canvas`,
  `design_draw`) or calls `canvas_context { answeredBy }` no longer becomes the board's responder: it is recorded as a
  suggestion, and the board header shows *Suggested: codex-b · Confirm* (× dismisses it) — one click, logged as the
  person. Boards that already have a responder keep it. An agent can no longer put `responder` or `agentTurns` into a
  new board's meta. Docs: watching, answering, being mentioned and being allowed to apply are four separate things
  (docs/canvas.md → "Several agents on one board").
- **A redraw never removes what it did not draw.** An item with the frame's id prefix that the person added, or that
  another agent added by hand (not by a redraw), is kept like any other foreign item instead of being removed as stale.
  Redraws now read the whole change log (not only the person's changes) to tell who added what.
- Kanban alignment (with the layout lock) moved from the web into `src/shown.ts`, shared by the page, the snapshot,
  the outline and the layout check; locked items are never reported as "drawn elsewhere".

### Fixed
- Setting "Answered by" to the default when it already was the default no longer logs an empty change.

## [0.9.2] — 2026-10-02

### Fixed
- **The person's browser through the tunnel is the person.** Changes from a browser signed in from elsewhere (a
  pairing code or a pasted token) were signed "Chrome on macOS (ip)" and could be taken for an agent; agents waiting
  for the person timed out while they edited. Now they are the person's (`author: 'user'`, unnamed — `[7 user] …`),
  wake `canvas_wait` (default `from: 'person'`) and studio, and a browser can no longer write as an agent. Agent
  tokens stay agents. `canvas_wait` and `canvas_diff` describe `from` (`person` | `others`, `all` for the diff) in
  their schemas and descriptions.
- **One credential for every tool.** After pairing, the stdio MCP server's canvas tools worked but `design_draw` got
  HTTP 401: it read the token from a file the pairing could not always write. The MCP server now hands the token it
  holds to the design tools and to any `awd` it starts (`UNPROSE_TOKEN` in its environment), and every client — the
  canvas client, `awd design draw`, `awd graph --canvas`, `awd boards move` — uses `UNPROSE_TOKEN`, else the token a
  pairing code saved for that canvas (a board link or a trailing slash now name the same canvas).
- **No more last-writer overwrites of board meta.** `PATCH /api/boards/:id` merges: the keys given replace theirs,
  `meta.diagrams` merges per diagram key. `awd design draw`, `awd graph --canvas`, the remote `design_draw` and the web
  use it (PUT still replaces whole, for older clients). Each diagram keeps its own project root
  (`meta.diagrams[key].holder.root`); the board-level `meta.project.root` is set only when the board has none, so a
  second machine's draw no longer overwrites it. Studio also finds a board by its diagrams' roots.
- **No bogus projects, no duplicate boards.** Without a git repo, a design file's project was its own folder — a
  project named "design". Now: the nearest folder with `.git` or `.unprose`, else with a project file (`package.json`,
  `AGENTS.md`, …), else the working directory, else the folder above `design/`. Title lookups (`--board
  "title:…"`) find the board in the project, then the personal space, then any board you see, and the canvas
  finds-or-creates in one step (`POST /api/boards { reuse: 'title' }`), so two draws at once share one board; several
  boards with the title → the newest, with a warning naming them. `awd projects remove <dir | id> [--force]` (`DELETE
  /api/projects/:id`, this machine only) forgets a project; `--force` moves its boards to the personal space.
- **User-Agent.** Cloudflare (in front of most tunnels) answers requests with no User-Agent, or Python's default one,
  with a 403 the canvas never sees. Every Unprose client now sends `User-Agent: unprose/<version> (<component>)` (MCP
  servers, CLI, runtime, plugin scripts); a 403 that is not the canvas's own answer says so; the canvas's 401 mentions
  the User-Agent when a request had none or a script's default one; docs/agents-setup.md says to set one in scripts.
- **Mentionable handles.** Default device-flow names like "agent on Acme-Robins-MacBook-Pro" had spaces and could
  not be @mentioned. Every agent now has a handle — its name as one word (`@agent-on-acme-robins-macbook-pro`) —
  shown on Connected agents, in `canvas_context`, the @ autocomplete (which inserts it) and on chips; `@handle` and
  the exact name both work, also in `canvas_ask`, which now says exactly who the question was delivered to and
  whether they are watching. Names are unique by handle. New pairings are named `<client>-<short host>`
  (`codex-acme-robins-mbp`); existing names stay. A person's message shows who it went to (*You → @codex-b*).

## [0.9.1] — 2026-10-02

### Added
- **Check for updates, now.** The release-notes dialog (the version button at the bottom of the rail) has a **Check for
  updates** button: it asks GitHub again past the six-hour cache, shows "Checking…", then "You're on the latest
  version (vX, checked just now)", the new version with its notes and **Upgrade**, or why it could not check in plain
  words (a private repository says to set `GITHUB_TOKEN` or run `gh auth login`), with "last checked … ago". The
  server answers a refresh within 30 s of the previous check with that check, to spare GitHub's rate limit. A plugin
  canvas that follows `claude plugin update` says so in the dialog (docs/canvas.md → "Updating").

## [0.9.0] — 2026-10-02

### Added
- **Several agents on one board.** A board on one machine, Claude there, Codex on another machine with the files:
  now each comment reaches the agent it is for.
  - **Answered by** (board header): one agent by name, studio, any agent, or the default (as before). Comments wake
    only that agent's `canvas_wait` and studio; the others can still read them, and their wait says how many changes
    were for someone else. When the responder is not watching the page says *"codex-b is away — your comments wait
    for it"*. Changes are logged; read-only tokens cannot change it.
  - **@mentions**: `@codex-b` in a comment (autocomplete in the comment boxes; a chip in the thread) sends that thread
    to that agent, replies included, whoever answers the board.
  - **Agents talk to each other**: an agent's `@mention` wakes the other agent and its answer comes back (`canvas_ask`
    asks and waits for the answer). Threads show who talks to whom (*codex-b → claude-a*); the Chats tab filters
    *Agents talking*. A loop guard pauses a thread after 6 agent messages in a row without the person (*"Agents
    paused — reply to let them continue"*; board setting / `UNPROSE_AGENT_TURNS`), and agent-to-agent mentions are
    rate-limited. Another agent's reply is never the person's consent.
  - **Board context**: a short note on what the board is about (meeting, decisions, links to notes) at the top of the
    side panel, editable by the person and by agents (`canvas_context`), and given first to every agent — studio's
    brief, the first `canvas_wait` on a board, `canvas_read_board`.
  - **File holders**: `awd design draw`, `awd graph --canvas` and `design_draw` record who drew each diagram from
    which repo (machine and path shown only on the canvas machine; git remote for everyone). The frame panel says
    *Files: team-notes · held by codex-b · last applied …*. Proposals on a diagram go to its holder. A new board an
    agent draws from its files is answered by that agent; existing boards only get a suggestion.
  - **`--applied <thread>`** on `awd design draw` / `awd graph --canvas` / `design_draw`: answers "Applied to <file>"
    in the proposal's thread; with `UNPROSE_APPLY_COMMIT=1` in the holder's environment it commits the file (message
    links the thread), with `UNPROSE_APPLY_PUSH=1` it pushes. The recommended multi-machine setup: files in git, the
    holder commits and pushes, other machines pull.
  - **Naming agents**: rename on **Connected agents**; the `awd` CLI uses the token the MCP server paired for that
    canvas; docs suggest `codex-b`-style names.
  - **Feedback**: `unprose_feedback` lets any agent tell the owner what got in its way; kept in
    `~/.awd/feedback.ndjson`, shown on Connected agents, readable with `unprose_feedback_list` by a local agent.

## [0.8.2] — 2026-10-02

### Fixed
- **Drag inside a frame selects; the frame moves by its title or border.** Dragging the empty inside of a frame, lane,
  kanban column, wireframe or UI-mock screen now draws a selection box, as on empty paper, instead of moving the whole
  frame. A box drawn inside a frame selects the items it touches, never the frame around them (a frame is selected when
  the box holds all of it). Move a frame, lane or column by its title bar or its border; items still move when dragged.
  Shift-drag now adds to the selection instead of replacing it. See docs/canvas.md → "Moving and selecting inside frames".

### Added
- **Replay a domain story, sentence by sentence** (as Egon.io's Replay): **Play story** on a domain-story frame (its
  header, side panel or right-click menu) hides what is not told yet, steps one sequence number at a time (parallel
  activities together), highlights the current sentence and reads it out; restart / previous / next, "n / N",
  auto-play with a speed, a ghost mode, keys ← → Space Home End P Esc. Only your view changes — nothing is stored on
  the board (docs/diagrams.md §6b "Replay").

## [0.8.1] — 2026-10-02

### Added
- **Agents propose edits on the canvas; whoever has the files applies them.** An agent that cannot write the files
  behind a board — a remote agent through `/mcp`, or any other agent on it — reads them from the board with
  `canvas_files` (each with its base sha-1) and proposes a change with `canvas_propose_edit` (a unified diff or the
  whole new text). The canvas checks the diff applies cleanly to the board's snapshot and posts it as a proposal signed
  with the agent's name, threaded on the block or frame it changes: the Chat shows the file, the diff, who proposed it,
  and **Agree** / **Decline**. On a workflow board the agent may also draw the wires its edit adds or removes as dashed
  proposed wires. Nothing is written to disk by the canvas: studio's session on the canvas machine (or your own local
  agent) checks the file still matches, applies the edit after you agree in the thread, lints, tests and redraws.
  Read-only tokens can read the files but not propose; comments are signed with the caller's name by the server.

## [0.8.0] — 2026-10-02

> **Using the canvas through a tunnel? Read this first.** On its own machine (`http://localhost…`) nothing changes.
> Through a tunnel or the LAN, the canvas now answers only with credentials: your browser shows a sign-in page and
> agents pointed at the tunnel get `401`. To fix it:
> 1. **Your browser:** choose *Ask to be let in* and approve it once from a page on `http://localhost:4400` (away
>    from the machine: `ssh -L 4400:localhost:4400 <machine>` and open `http://localhost:4400` there), or paste a
>    token made on the *Connected agents* page.
> 2. **Your agents:** give them a token (`UNPROSE_TOKEN`), let the stdio MCP server show you a pairing code to type
>    on the canvas, or connect them to `https://<tunnel>/mcp` (OAuth, approved with a code).
> 3. **Set `UNPROSE_PUBLIC_URL=https://<tunnel>`** on the canvas so setup lines and OAuth use the tunnel address.
>
> Escape hatch: `UNPROSE_REMOTE_AUTH=off` restores the old open canvas (only behind your own access proxy).
> Details: docs/canvas.md → *Migrating a canvas you use through a tunnel*.

### Added
- **Remote agents — design with agents on other machines and in the cloud.** The canvas serves MCP itself at
  `https://<canvas>/mcp` (Streamable HTTP): claude.ai custom connectors, ChatGPT connectors, Claude Code
  (`claude mcp add --transport http unprose https://<canvas>/mcp`), Codex, Cursor. Connecting uses OAuth 2.1
  (discovery, dynamic registration, PKCE, refresh tokens): the agent's browser shows a one-time **pairing code**, every
  open canvas page shows *"<agent> wants to connect"* — type the code and press Allow (one click on the canvas's own
  machine). Agents without a browser get the same code through the device flow; the stdio MCP server pointed at a
  remote canvas asks for one by itself. Over remote MCP `design_lint` / `design_draw` / `design_propose_stories`
  take the file's text, and the start prompts are MCP prompts.
- **Connected agents page** (`/agents`, *Agents* on the board list): every agent and browser let in — how, scope,
  projects, created, last used, from where — make tokens (shown once, with setup lines for Claude Code, Codex,
  claude.ai and the stdio server), approve waiting requests or enter a code, revoke.
- **Who did what:** changes made with a token carry the agent's name (`[7 codex-laptop] …` in diffs and the change
  feed), the board header names the agents watching, read receipts are per agent, and `canvas_wait({ from: 'others' })`
  / `canvas_diff({ author: 'others' })` show the other agents' changes. A local agent can name itself with
  `UNPROSE_AGENT_NAME`.
- **Scopes:** read-only or read-and-draw, all or some projects or boards; a limited token sees only what it was given.
- **UI mock frames show their lint findings.** What `awd design lint` says about a `.ui.yaml` (unknown fields, a
  `goto` to no screen, a ragged table, an unknown icon …) is marked on the element it is about, counted on the frame
  ("N to check") and listed in the frame's panel; a click shows the element on the board.
- **Remove and add UI mock elements as proposals.** Delete on an element keeps it on the board, struck through, as
  a proposal to remove it from the file; the panel's *Add element* proposes a new button, input, text, heading … in
  the selected screen or container (or after the selected element), dashed, with its words editable. Each shows the
  diff to the file — only the element's lines change, comments and formatting stay — with Ask AI to apply and Undo.
- **Edit table cells and list items in place.** Double-click a cell, a list item, a tab or a navbar link on a UI
  mock to change its words: a text proposal whose diff touches only that value.
- **Wires: All / Selected / None.** A small control in the board's bottom-right corner (or **W**) picks which
  wires are drawn: every one, only those of the selected blocks, or none (a wire picked in the Inspector is still
  drawn). Remembered per viewer; nothing is stored on the board, and Copy as image follows what is shown.
- **Catch-all listeners become badges.** On workflow boards `*.failed` listeners, cron `tick` sweeps, a trigger's
  `resume: <event>` to every human step, and hubs (one event to 4+ blocks, or a block listening to 4+ blocks) are
  drawn as small badges on their blocks — `on *.failed`, `resume: card.moved`, `card.moved → 2 blocks` — instead of
  long wires across the graph. Click a badge to draw its wires, or tick *Show catch-all wires*. The rule is in
  docs/canvas.md → Wires.

### Changed
- **Requests from elsewhere need credentials.** On its own machine the canvas works as before, with no token. Through
  a tunnel or the LAN, the API, the board sockets and `/mcp` need a token or a browser signed in with a pairing code;
  without one they answer `401` saying how to connect. Using the canvas through a tunnel? Sign each browser in once
  (or set `UNPROSE_REMOTE_AUTH=off` to keep the old open canvas behind your own access proxy) — see
  docs/canvas.md → *Migrating a canvas you use through a tunnel*. Tokens are stored only as hashes in
  `~/.awd/agents.json`; the CLI and the stdio MCP server send `UNPROSE_TOKEN`.
- **Wires cross fewer boxes.** A wire whose sides nobody chose now tries every pair of sides (and a loop over or
  under) and takes the route that crosses the fewest boxes, then the shortest — e.g. `human-review.bounced` on
  card-pipeline no longer goes up into `review` through `qa`.
- The board's corner controls sit above a workflow board's folded run drawer instead of under it.

## [0.7.1] — 2026-10-02

### Changed
- **Kanban columns line up like their cards.** The columns of a kanban (in a frame, or a kanban board) stand side by
  side in left → right order on one row; drag a column to reorder it and it snaps into place. A column grows to hold
  all its cards — a long list no longer runs past its bottom — every column is as tall as the tallest, and the frame
  grows to hold them.

## [0.7.0] — 2026-10-01

### Added
- **UI mock frames — mock a screen and discuss it like a Figma frame.** `design/<name>.ui.yaml` holds real-looking
  screens (desktop, tablet or phone, light or dark) as a tree of components — navbar, sidebar, cards, tables, lists,
  forms, stats, tabs, badges, charts — that the agent writes and the canvas draws with its own small design system
  (no HTML, nothing runs). Every element can be selected, commented on and chatted about; words you edit on the
  board become a proposal with the diff to the file (Ask AI to apply, or Undo); `goto` draws the flow between
  screens. `awd design lint/draw`, the `design_*` tools and the new `/unprose:mockup <screen>` command know it.

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

[Unreleased]: https://github.com/river0825/unprose/compare/v0.30.1...HEAD
[0.30.1]: https://github.com/river0825/unprose/compare/v0.30.0...v0.30.1
[0.30.0]: https://github.com/river0825/unprose/compare/v0.29.0...v0.30.0
[0.29.0]: https://github.com/river0825/unprose/compare/v0.28.0...v0.29.0
[0.28.0]: https://github.com/river0825/unprose/compare/v0.27.1...v0.28.0
[0.27.1]: https://github.com/river0825/unprose/compare/v0.27.0...v0.27.1
[0.27.0]: https://github.com/river0825/unprose/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/river0825/unprose/compare/v0.25.0...v0.26.0
[0.25.0]: https://github.com/river0825/unprose/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/river0825/unprose/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/river0825/unprose/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/river0825/unprose/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/river0825/unprose/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/river0825/unprose/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/river0825/unprose/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/river0825/unprose/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/river0825/unprose/compare/v0.16.1...v0.17.0
[0.16.1]: https://github.com/river0825/unprose/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/river0825/unprose/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/river0825/unprose/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/river0825/unprose/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/river0825/unprose/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/river0825/unprose/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/river0825/unprose/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/river0825/unprose/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/river0825/unprose/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/river0825/unprose/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/river0825/unprose/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/river0825/unprose/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/river0825/unprose/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/river0825/unprose/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/river0825/unprose/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/river0825/unprose/compare/v0.6.7...v0.7.0
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
