# awd-canvas — a shared canvas for an agent and a human

The agent draws its thinking as a diagram; you move things and leave comments; the agent sees exactly what changed and reacts. One store, two authors (`agent` | `user`), an append-only change log.

```
packages/canvas/
  src/model.ts            the contract: Board · Item · Op · Change (shared with the web UI)
  src/ports/boardRepository.ts   the port; src/adapters/boards/{file,memory}.ts implement it
                          (file = boards/<id>.json snapshot + boards/<id>.changes.ndjson log); src/store.ts is a shim
  src/templates/          pure render(kind, content) → Item[]   (the agent never computes pixels) — seven kinds
  src/diff.ts             summarize(changes) → lines the agent reads · outline(board) → compact text · cardMoves(board, changes)
  src/place.ts · thumb.ts · docs.ts   auto-place agent comments · board thumbnails · the /docs site
  src/server.ts           HTTP + WebSocket API, serves web/dist and /docs
  src/mcp.ts              MCP stdio server (the agent's tools), thin over the HTTP API
  src/cli.ts              awd-canvas serve | mcp | render | demo | outline | diff | card add|move|moves
  web/                    the React UI (built separately); web/src/run/ is the live run overlay
```

## Run it

```bash
npm install
npm run build -w @awd/canvas          # → packages/canvas/dist
node packages/canvas/dist/cli.js serve --port 4400 --dir ./boards   # http://localhost:4400
node packages/canvas/dist/cli.js demo  # seven sample boards (one per kind) drawn from the card-pipeline example
```

`AWD_CANVAS_DIR` sets the board directory, `AWD_CANVAS_URL` tells the MCP server / CLI where the server is (default `http://localhost:4400`). If `packages/canvas/web/dist` exists it is served at `/` and `/b/:id`; otherwise a plain page lists the boards.

Claude Code in this repo gets the tools automatically through `.mcp.json` (`node packages/canvas/dist/cli.js mcp`). The MCP server needs the HTTP server running — it does not own a store of its own, so the browser and the agent always see the same board.

## The alignment loop

![Sequence: Claude Code → MCP → canvas server → browser, with the quiet-window / handoff alternative](diagrams/alignment-loop.svg)

```
agent  canvas_create_board(kind:'event-storming', content) → { id, url, seq: 1 }
agent  "I drew the pipeline as an event storm at <url>. Move things or comment; I'm watching."
agent  canvas_wait(id, since: 1)                      ← blocks up to 120 s; the UI shows "agent is watching"
user   drags 'Build claimed' into the Planning lane, adds a comment "this is where it gets stuck"
       …and stops for 2.5 s (or presses "Hand to agent") — the wait resolves only once the person is done
agent  ← "[3 user] event "Build claimed" [es.event.build-claimed-…]: moved from Build → Planning
          [3 user] added comment on event "Build claimed" [es.event.build-claimed-…]: "this is where it gets stuck""
agent  reasons; replies with canvas_add_items(kind:'freeform', { items:[{ type:'comment', text:'…', target:<id> }] })
       and/or redraws a hotspot + policy, and/or changes workflow.yaml
```

Always keep the last `seq` you saw and pass it as `since`. `canvas_diff` returns only the user's changes by default so your own drawing never comes back as noise.

## MCP tools

| Tool | Input | What it does |
|---|---|---|
| `canvas_list_boards` | – | id, kind, seq, item count, title, url per board |
| `canvas_create_board` | `title, kind, content, meta?` | render the template and create the board → id, url, seq |
| `canvas_read_board` | `id, format: outline\|json` | `outline` (default): compact text grouped by lane/frame with arrows and comments; `json`: raw items with ids and geometry |
| `canvas_apply` | `id, ops[], note?` | raw ops as the agent: `add {item}`, `update {id, patch}`, `remove {id}` |
| `canvas_add_items` | `id, kind?, content, at?, scope?, note?` | render a template onto an existing board; deterministic ids mean re-rendering the same content updates in place |
| `canvas_diff` | `id, since, author: user\|agent\|all` | human-readable lines for every change after `since` |
| `canvas_wait` | `id, since, timeoutSec ≤ 120, quietSec = 2.5, wake = meaningful` | block until the user has changed something **and stopped for `quietSec`** (or pressed "Hand to agent"); returns the diff lines and new seq. `wake: meaningful` (default) wakes on comments, adds, removals, renames, connections, recolours and handoff; pure moves / resizes / reroutes and read receipts neither wake nor restart the quiet window and come back folded into one `moved N items: …` line. `any` wakes on every change (one line each); `handoff` waits for the button only. While pending the board shows "agent is watching" |
| `canvas_open` | `id` | print the URL (and `open` it on macOS) |

## HTTP API

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/boards` | | `{ boards: [{ id, title, kind, seq, items, … }] }` |
| POST | `/api/boards` | `{ title, kind, content? \| items?, meta?, author? }` | `201 { board }` — `content` is rendered with the kind's template |
| GET | `/api/boards/:id` | | `{ board }` |
| PUT | `/api/boards/:id` | `{ title?, meta? }` | `{ board }` |
| DELETE | `/api/boards/:id` | | `{ deleted }` |
| POST | `/api/boards/:id/ops` | `{ author: 'agent'\|'user', ops: Op[], note? }` | `{ seq, change }` (atomic batch) |
| GET | `/api/boards/:id/changes` | `?since=N&author=` | `{ changes: Change[], seq }` |
| GET | `/api/boards/:id/diff` | `?since=N&author=` | `{ lines: string[], count, seq }` |
| GET | `/api/boards/:id/wait` | `?since=N&timeout=ms&author=&quiet=ms&wake=meaningful\|any\|handoff` | long-poll; resolves `quiet` ms (default 2500) after the last waking change (see `canvas_wait`), or at once on a change whose `note` is `handoff`; `{ timedOut, changes, lines, seq }`. `diff` and `wait` record `data.seenBy: ['agent']` on the user comments they return |
| GET | `/api/boards/:id/thumb.svg` | | SVG thumbnail of the board (used by the board list) |
| GET | `/api/boards/:id/outline` | | `text/plain` outline |
| POST | `/api/boards/:id/template` | `{ kind?, content, at?, scope?, frame?: { key, title?, source?, level?, at? } }` | `{ items, ops }` — rendered but **not** applied. With `frame`, drawn inside the diagram frame `diagram.<key>` (created if missing; an existing frame keeps its geometry), ids `<key>.<role>.<element id>`; trace links become dotted `trace` wires when their target is on the board |
| GET | `/api/boards/:id/studio` | | `{ capable, running, pid?, since?, exitedAt?, exitCode?, log: string[] (last 50), sessions?: { open, max, queued } }` — `capable: false` unless the board's `meta.workflow.file` is one of the server's `--studio` files |
| POST | `/api/boards/:id/studio` | `{ action: 'start' \| 'stop' }` | same shape; `403` for a board that is not studio-capable, `400` for another action. Start is idempotent; one child per workflow; no auto-restart |
| GET | `/api/kinds` | | `{ kinds }` |
| WS | `/ws/:id` | | `{ type:'hello', board }` then `{ type:'change', change }` per change |

Every `Change` carries `before` — a snapshot of each touched item before the change — so diffs never need a second read. CORS is open.

### Model (from `src/model.ts`)

```ts
Item   { id, type: sticky|text|frame|lane|arrow|comment|wireframe|card, x, y, w, h,
         text?, color?: orange|blue|yellow|pale-yellow|lilac|green|pink|red|purple|grey|white,
         role?, parent?, from?, to?, label?, target?, order?, data?,
         createdBy, updatedBy: 'agent'|'user', updatedAt }
Op     { kind:'add', item } | { kind:'update', id, patch } | { kind:'remove', id }
Change { seq, ts, author, boardId, ops, before: { [id]: Item|null }, note? }
```

Coordinates are absolute even for items with a `parent`. Containment for diffs is `parent` when set, else whichever lane/frame geometrically contains the item's centre — so a plain drag into another lane still reads as "moved from A → B".

### Diagram frames (docs/diagrams.md §1)

A board can hold several diagrams. A **diagram frame** is a `frame` item (id `diagram.<key>`, `role: 'diagram'`) with `data.diagram = { kind, key, source?, level? }`; its content items are its children and their ids start with `<key>.`. `diagramOf(board, item)` (in `model.ts`, also exported from `@awd/canvas/diagrams`) answers "which diagram is this in?" — the nearest diagram frame up the `parent` chain (an arrow asks for its `from` end), else, on a board whose `kind` is not `freeform`, the whole board as one diagram of that kind with key = the kind. Legacy boards need no migration. A redraw into an existing frame never moves or resizes the frame.

## Templates — content shapes

All ids are deterministic (`<scope>.<role>.<element id>` for event-storming and story maps, `<scope>.<role>.<slug>-<hash>` elsewhere), so re-rendering the same content produces update ops, not duplicates. Pass `scope` to keep two renders of the same kind apart, `at: {x, y}` to place a render next to existing items.

### `event-storming` (docs/diagrams.md §3 — *Introducing EventStorming*)

```json
{ "level": "process",                         // big-picture | process | software (p.24-25)
  "lanes": ["Ask", "Work"],                   // optional swimlanes, top → bottom
  "people":  ["Designer"],
  "systems": [{ "id": "canvas", "text": "Canvas" }, { "id": "herdr", "text": "herdr", "external": true, "raises": ["pane-opened"] }],
  "events":  [{ "id": "ask-sent", "text": "Ask AI sent", "phase": "ask" },
              { "id": "request-picked", "text": "Request picked up", "pivotal": true },
              { "text": "Idle pane closed", "time": "after 30 min" }],
  "commands": [{ "id": "send-ask", "text": "Send Ask AI", "by": "Designer", "system": "canvas", "produces": ["ask-sent"] }],
  "policies": [{ "text": "Whenever an ask is sent, pick it up", "when": "ask-sent", "then": "pick-request" }],
  "readModels": [{ "id": "thread", "text": "Chat thread", "updatedBy": ["reply-posted"], "informs": ["Designer", "send-ask"] }],
  "hotspots": [{ "text": "Too many sessions?", "on": "pick-request", "kind": "question" }],
  "opportunities": [{ "text": "Warm session", "on": "pick-request" }],
  "values":  [{ "text": "no copy-paste", "on": "reply-posted", "sign": "+", "currency": "time" }],
  "votes":   [{ "on": "too-many-sessions", "count": 2 }],
  "milestones": [{ "text": "first chat", "before": "ask-sent" }],
  "phases":  [{ "id": "ask", "text": "Ask" }, { "text": "Work", "from": "pane-opened" }],
  "definitions": [{ "term": "brief", "text": "the file studio writes for the session" }],
  "aggregates": ["Session"],                  // software level: frames *instead of* the timeline (p.21)
  "legend": true }
```

Every element has an `id` (default: the slug of its text) and references use ids or texts. The older shape still works: `events[].actor`, `commands[].event` / `actor`, `readModels[].for`, `externals[{ text, event }]`, `hotspots[].near`.

Colours are the book's (p.314): event orange · command blue · policy lilac · read model green · person small yellow · system pink (role `system`, or `external` when outside our boundary) · hotspot **purple** (rotated; red is not a sticky colour, p.307) · opportunity green · value green (+) / red (−) · vote and milestone blue · aggregate pale yellow · definition white. A legend of the kinds in use is drawn below the diagram (`legend: false` hides it).

Layout: one column per event; per swimlane the rows milestone · person · read model · command · system · **event** · policy · notes (hotspots, opportunities, values, votes), so the grammar reads top → bottom (p.201-202). Wires: command → system (`handles`) → event (`produces`; no system: command → event), event → policy (`whenever`) → command (`then`), event → read model (`updates`), read model → command / person (`informs`), external system → event (`raises`). A command producing several events gets one `produces` wire per outcome (`data.branch` 1, 2 … for the alternatives). Pivotal events are larger with a marker line; phases run as `phase` bars above the timeline; definitions and the legend sit below. `big-picture` shows events, people, systems and notes; `process` and `software` add commands, policies and read models.

Item roles the UI can style: `event` `command` `policy` `read-model` `person` `system` `external` `aggregate` `hotspot` `opportunity` `value` `vote` `milestone` `phase` (text bar) `pivotal` (marker) `definition` `legend` `legend-title`; wires `handles` `produces` `triggers` `updates` `informs` `raises`; `trace` for links to other diagrams. Every item has `data.element` (its element id); repeated person/system stickies have `data.occurrence: true`.

The grammar check (`checkEventStorming` in `@awd/canvas/diagrams`) reports: unresolved references, command without system / event / trigger, policy without event / command, event without a source, unused read model, pivotal events on a process board, idle aggregates, and the open-hotspot count — each with the element id and the book page.

### `user-story-map` (docs/diagrams.md §5)

```json
{ "releases": ["Release 1", "Later"],
  "activities": [{ "id": "ask", "text": "Ask", "steps": [
      { "id": "send", "text": "Send Ask AI", "stories": [
          { "id": "chat", "text": "Chat with the selection", "release": "Release 1",
            "acceptance": ["Event: Ask AI sent", "Shows: Chat thread"],
            "traces": [{ "from": "studio-es/send-ask", "rel": "derived-from" }] } ] } ] }] }
```

Backbone row (blue activities spanning their steps), yellow steps, white story cards under their step inside one horizontal lane per release, with a `release-cut` line between releases (above the first line is Release 1). Stories without a known release fall into a trailing `Later` lane. Ids are `<scope>.<activity|step|story>.<element id>`; `acceptance` and `traces` ride in the story's `data`. `proposeStories(es, { esKey, existing? })` in `@awd/canvas/diagrams` turns an EventStorming into story candidates (docs/diagrams.md §4).

### `user-journey`

```json
{ "persona": "River, the human reviewer",
  "stages": [{ "text": "Confirm & start", "actions": ["Read spec"], "touchpoints": ["Design hub"], "emotion": -1,
               "pains": ["Spec drifts"], "opportunities": ["Spec as projection"] }] }
```

Stages as columns; rows Actions, Touchpoints, an Emotion lane (−2…2 drawn as a curve of face stickies connected by arrows), Pain points (red), Opportunities (green).

### `wireframe`

```json
{ "screens": [{ "name": "Dashboard", "w": 960, "elements": [
    { "role": "nav", "text": "awd · runs · events", "x": 0, "y": 0, "w": 12 },
    { "role": "box", "text": "Planning (3)", "x": 0, "y": 2, "w": 3, "h": 6, "note": "shown to the human" },
    { "role": "button", "text": "Emit event", "x": 9, "y": 1, "w": 3 } ] }] }
```

12-column grid, 40 px rows; `x` 0–11, `w` 1–12, `y`/`h` in rows. Roles: `box button input heading paragraph image nav list table label`. A `note` becomes a comment bubble on that element. Screens are laid out side by side.

### `workflow`

The JSON `awd graph --json` emits: `{ name?, nodes: [{ id, kind: trigger|script|ai|gate|human|outcome, label?, config? }], edges: [{ from, to, label?, condition? }] }`. Triggers form the leftmost column; every other node sits one column right of its furthest predecessor; edge labels show the outcome and `if <condition>`.

`awd graph --json` also emits `agents: [{ id, description?, model?, runner?, tools?, effort?, delegates?, steps: [<ai step ids>], legacy? }]` (a `role:`-only step yields a `legacy: true` entry). When present, the template draws an **Agents** frame above the graph: one lilac `card` per agent (`role: agent`, id `wf.agent.<id>`, text `@<id>` + `<model> · <runner>`, `data: { agent, model, runner, tools, effort, steps, delegates, description }`), a dotted `owns` arrow (`role: owns`) to each step it runs, and a dashed `delegates` arrow between agents. The graph starts below the frame, so nothing overlaps, and ids are deterministic, so re-running `awd graph --canvas` after editing `agents:` updates the same cards. The run overlay badges these cards by `data.agent` (busy / idle).

Nodes and agents may carry a `detail` object; the template copies it to `item.data.detail`. `awd graph --canvas` fills it from the files around the workflow (persona and frontmatter of `agents/<id>.md`, the prompt an ai step really sends, a gate's rules in plain sentences, a script's source, `source: { workflow, line }`, `listens`, `emits`) — shape in [studio.md §1](studio.md). It is a snapshot refreshed on every redraw, not something the canvas writes back; `awd graph --json` stays detail-free.

### `freeform`

`{ items: [{ type?, text?, x?, y?, w?, h?, color?, role?, parent?, from?, to?, target?, id? }] }` — missing geometry is filled on a grid. This is also how the agent replies to a comment: `{ items: [{ type: 'comment', text: '…', target: '<item id>' }] }`.

### `kanban`

```json
{ "columns": [{ "name": "Backlog" }, { "name": "In Progress", "wip": 3 }, { "name": "Done" }],
  "cards": [
    { "id": "c-happy", "title": "Upload contacts CSV", "column": "Backlog", "size": "M", "labels": ["ST:ReadyForAgent"], "assignee": "@planner" },
    { "title": "Flaky date parsing", "column": "In Progress", "size": "S", "description": "…" } ] }
```

Columns are vertical `lane` items (`role: column`, `data.wip` optional) side by side; cards are `card` items (`role: card`, `data.{labels,size,assignee,description}`) stacked inside, `parent` = the column. Ids are `kb.column.<slug>-<hash>` and `kb.card.<id or title>`; a card with an explicit `id` keeps a stable item id across renders. The web UI shows each column's card count against its WIP limit (`4/3 over` — text, not colour alone) and stacks cards top → bottom by their `y`, so a dropped card snaps into the pile.

## Kanban as an event source

A kanban board can stand in for Trello: **a card's column is its `parent`**, and moving a card is an ordinary change in the log. Three ways to read it:

| Where | What you get |
|---|---|
| `canvas_diff` / `canvas_wait` / `GET /diff` | the line `[<seq> user] card "<title>" [<id>]: moved from <ColA> → <ColB>` (a drag that never set `parent` is resolved by geometry, so it reads the same) |
| `GET /api/boards/:id/cards?since=N` | `{ moves: [{ cardId, title, from, to, seq, author, ts }], seq }` — the structured form, from `cardMoves()` in `diff.ts`; this is what a workflow trigger polls |
| `awd-canvas card moves <boardId> [since]` | the same, on the CLI |

Writing back (the runtime advancing a card, like it did with Trello):

| Call | Effect |
|---|---|
| `POST /api/boards/:id/cards` `{ title, column, labels?, size?, assignee?, description?, id?, author?, note? }` | new card at the bottom of `column` (name or lane id); the lane grows if it must |
| `POST /api/boards/:id/cards/:cardId/move` `{ column, author?, note? }` | re-parents and drops the card at the bottom of the target column; logged as one change, so `cards?since` and the diff both report it |
| `awd-canvas card add <boardId> <column> "<title>" [--size S] [--label L]…` · `awd-canvas card move <boardId> <cardId> <column>` | the same, on the CLI |

Semantics the trigger can rely on: one change = at most one move per card; `from`/`to` are column **names** (what the person sees); `author` says whether a human dragged it (`user`) or the runtime moved it (`agent`); a same-column nudge is never a move; `since` is the board `seq`, so a poller keeps the last `seq` it saw exactly like `canvas_wait`.

## Diff lines the agent gets

```
[7 user] event "Card qualified": moved from Build → Review & merge
[7 user] event "Spec written": moved by (+20, +5), now before event "Card handed off"
[8 user] added comment on command "Qualify card": "what if size is unset?"
[8 user] command "Qualify card": renamed "Qualify card" → "Qualify card (deterministic)"
[8 user] policy "Retry": recoloured lilac → orange
[9 user] removed external "Trello"
[9 user] connected event "Build claimed" → event "PR marked ready" ("then")
[9 user] added policy "Retry policy" in Build
```

## CLI

```
awd-canvas serve [--port 4400] [--dir ./boards] [--store file|memory] [--open]
                 [--studio <workflow.yaml>]... [--studio-cmd "<command with {file}>"]
awd-canvas mcp
awd-canvas render <kind> <content.json>      # print the items a template produces (no server needed)
awd-canvas demo [--url http://localhost:4400]
awd-canvas outline <boardId>
awd-canvas diff <boardId> <since>
awd-canvas card add <boardId> <column> "<title>" [--size S] [--label L]…
awd-canvas card move <boardId> <cardId> <column>
awd-canvas card moves <boardId> [since]
```

`--studio` (repeatable) lists the workflows the web may start `awd studio` for (docs/studio.md §8b); the
paths are resolved at startup and a board's `meta.workflow.file` only selects among them. `--studio-cmd` is
split on whitespace and run without a shell, `{file}` being the only substitution (default:
`<this node> packages/cli/bin/awd.js studio {file}`, relative to the workflow's repo root, which is also the
child's cwd). The child gets `AWD_CANVAS_URL` for this server; its output goes to the panel's log tail and to
`~/Library/Logs/awd/studio-<dir>.log` (`AWD_LOG_DIR` overrides). Children are stopped with the server.

The workflow board a runtime draws (`awd graph … --canvas`) also shows **live runs**: the web UI's run overlay reads the runtime's `/api/stream` (SSE) and badges step and agent cards — see `docs/workflow.md` §7.

## Tests

`npm test -w @awd/canvas` — templates (determinism, level filtering, lane containment, no overlaps), the board repository (log + snapshot + rebuild, wait, memory adapter), kanban (`cardMoves`, `/cards` round trip), diff summaries, thumbnails, comment placement, the HTTP/WS server on a random port, and the architecture rule (ports / adapters).
