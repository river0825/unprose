# Design — agent-workflow-diagram

Two products in one monorepo, sharing one idea: **the process is data, the agent and the human look at the same picture.**

1. **`awd` workflow runtime** — an event-driven runtime where a *skill* is a small graph you can draw, not a 1,500-line SKILL.md. External event in → deterministic script, or AI call, or wait-for-human → event out.
2. **`awd-canvas`** — a Miro-like board where an agent lays out its thinking as diagrams (Event Storming, user story map, user journey, wireframe, the workflow graph itself), the human moves/annotates, and the agent sees the diff and reacts.

The examples in `example/` are the *before* picture. `card-pipeline-coordinator/SKILL.md` is 37 KB of prose plus 7 K lines of Python that drifted apart; `workflow-issue-in-skill/` is the diagnosis (rules with no compiler, invariants smeared across five copies, review as the only oracle). This repo is the *after*: the same pipeline expressed as `workflow.yaml` + a reducer + golden tests.

---

## Part 1 — Workflow runtime

### Vocabulary (EventStorming grammar, kept tiny)

| Word | Meaning here |
|---|---|
| **Event** | A fact that happened, `{ type, key, data, ts, id, causationId? }`. Append-only. Named `dotted.lowercase`. |
| **Trigger** | Where events come from: `webhook`, `cron`, `cli`, `manual`. A trigger *normalizes* an outside payload into a domain event. |
| **Step** | A unit of work that reacts to events and emits `<step>.<outcome>` events. Kinds: `script`, `ai`, `gate`, `human`. |
| **Outcome** | The label a step finishes with: `done`, `pick`, `skip`, `approved`, `failed`… Each outcome is an edge on the diagram. |
| **Key** | The aggregate id. `key: "{{ event.data.card }}"` on the workflow makes each card its own stream. The engine enforces **one active step per key** unless `concurrency` says otherwise. |
| **Run** | The state of one key: which steps are active/waiting/done, collected outputs (`vars`). Purely derived from events (replayable). |
| **Command** | What the reducer *asks* the runtime to do: `run_script`, `call_ai`, `wait_human`, `emit`. Executors turn commands into events. |

Everything the engine decides is `reduce(state, event) → { state, commands }` — a pure function with zero IO. That is what makes golden tests possible: feed recorded events, assert commands, never call an LLM.

### `workflow.yaml`

```yaml
name: card-pipeline
key: "{{ event.data.card }}"        # aggregate id; omit → every trigger event is its own run
concurrency: 1                       # max active steps per key (default 1)

triggers:
  trello:                            # id → event type `trello`
    on: webhook                      # webhook | cron | cli | manual
    path: /hooks/trello              # webhook only
    emit: card.moved                 # event type produced (default: trigger id)
    data:                            # normalize the raw payload (templates over `body`, `query`, `headers`)
      card: "{{ body.action.data.card.shortLink }}"
      to:   "{{ body.action.data.listAfter.name }}"
    if: "body.action.type == 'updateCard' && body.action.data.listAfter"   # drop otherwise
  reconcile:
    on: cron
    every: 30m
    emit: tick
  kanban:                            # a kanban board on the canvas as the event source (replaces the webhook)
    on: board
    board: "title:Card pipeline — Kanban"   # or a board id
    canvas: http://localhost:4400           # default AWD_CANVAS_URL
    author: user                            # whose drags count: user | agent | all
    emit: card.moved
    data: { card: "{{ card.id }}", to: "{{ to }}" }   # scope: { card, from, to, author, seq, env, now }

agents:                              # who — personas, declared once (docs/agents.md)
  planner:
    file: roles/planner.md           # or system: | inline, or agents/planner.md (frontmatter + prompt)
    model: opus
    tools: [Read, Grep, Glob]
    runner: claude-code              # claude-code | anthropic | fake | cli | herdr
    memory: { recall: 20 }           # short-term (this run) + long-term (this project), default on
    claudeCode: { permissionMode: acceptEdits, cwd: "{{ vars.worktree.path }}" }   # claude-code only

steps:
  qualify:
    on: card.moved                   # string | string[]; each may carry an `if`
    if: "event.data.to == 'Ready'"
    run: python3 scripts/qualify.py --card {{ event.data.card }}
    outcomes: [pick, skip]           # stdout JSON: { "outcome": "pick", "data": {...} } ; non-zero exit → failed

  plan:
    on: qualify.pick
    ai:
      agent: planner                 # who runs it (legacy: `role: planner` → roles/planner.md)
      model: opus                    # overrides the agent's model for this step
      input:                         # what the model sees (templated)
        card: "{{ event.data.card }}"
        size: "{{ vars.qualify.size }}"
      output:                        # JSON schema the model must satisfy; `outcome` is required
        type: object
        required: [outcome, summary]
        properties:
          outcome: { enum: [done, needs-human] }
          summary: { type: string }
          tasks: { type: array, items: { type: string } }
      # the answer may also carry, whatever the schema says:
      #   remember: {…}                      kept for this run (state.memory.short[agent])
      #   learn: [{ note, tags }]            → memory.learned events, recalled next time
      #   reflect: [{ note, kind, tags }]    → reflection.noted events (awd reflect)

  confirm:
    on: plan.done
    human:                           # pauses the run; resumes when a later event on the same key matches
      resume_on: card.moved
      outcomes:
        approved: "event.data.to == 'Ready'"
        rejected: "event.data.to == 'Backlog'"
      timeout: 7d                    # → confirm.timeout

  size-ok:
    on: confirm.approved
    gate:                            # pure decision inside the reducer, no IO
      outcomes:
        build: "vars.qualify.size in ['XS','S','M','L']"
        split: "vars.qualify.size == 'XL'"
      default: split

  build:
    on: size-ok.build
    run: bash scripts/build.sh {{ key }}
    outcomes: [done]
    timeout: 2h
    retry: { max: 2, backoff: 5m }

  reflect-failure:
    on: "*.failed"                   # wildcard: any other step's failed (also "*.timeout")
    run: bash scripts/reflect_to_board.sh {{ key }} {{ event.type }}
    terminal: true
```

Rules the linter enforces (`awd lint`):

- every `on:` references a trigger event, a `<step>.<outcome>` that exists, `<step>.failed`, `<step>.timeout`, or the wildcards `*.failed` / `*.timeout` (a step never matches its own outcome);
- `agent:` names a declared agent (or `agents/<id>.md`), `delegates` exist, `memory.recall` is 0–200, a `board` trigger has `board:`;
- every declared outcome of a step is consumed by something, or the step is explicitly `terminal: true` for it (warning);
- step ids and trigger ids are unique and `kebab-case`; event types are `dotted.lowercase`;
- `ai` steps have an `output` schema with `outcome` enum; `gate` and `human` steps have ≥1 outcome;
- templates only reference `event`, `vars`, `key`, `env`, `now`, `body/query/headers` (triggers);
- no unreachable steps; no cycles without a `human` or `gate` in them (warning — loops are fine, infinite loops are not).

### Expressions and templates

A deliberately small, safe language (no `eval`): literals, `.` member access, `[]` index, `== != < <= > >= && || ! in`, `+ - * /`, parentheses, and a handful of functions (`len`, `lower`, `upper`, `startsWith`, `includes`, `json`, `default`). Templates are `{{ expr }}` inside strings; a string that is exactly one template keeps the expression's type (so `data: { n: "{{ body.count }}" }` yields a number).

### Reducer

```ts
type RunState = {
  key: string
  status: 'idle' | 'running' | 'waiting' | 'done' | 'failed'
  active: Record<stepId, { commandId, since, attempt }>   // steps with an executor in flight
  waiting: Record<stepId, { since, resumeOn }>            // human steps
  vars: Record<stepId, unknown>                           // last output data per step
  history: Array<{ step, outcome, at }>
  memory: { trail: [...], short: Record<agentId, object> } // this run's ai outcomes + `remember` values
}
reduce(def, state, event) → { state, commands: Command[] }
```

`vars.<step>` = the `data` of that step's last outcome event. Events produced by executors carry `causationId` (the command id) so replays can be checked.

Command kinds: `run_script { step, key, cmd, env, stdin, timeout }`, `call_ai { step, key, agent, model, system, tools, effort, runner, runnerConfig, memory, input, outputSchema, timeout }`, `wait_human { step, key, resumeOn, timeout }`, `emit { event }`, `schedule { at, event }`.

System events written by the runtime, never by the reducer: `timer.set` / `timer.cancel` (durable timers), `memory.learned` (an agent's `learn` note), `reflection.noted` (a `reflect` note from an agent or a script).

### Runtime

```
triggers ──▶ EventStore (events.ndjson, append-only, per workflow) ──▶ Engine
                                                                       │ reduce
                                                                       ▼
                                           Executors: script · ai(WorkerRuntime) · human · timer
                                                                       │ emit <step>.<outcome>
                                                                       ▼
                                                                    EventStore  (loop)
```

- **EventStore** — `append(ev)`, `read({ since, key })`, `subscribe(fn)`. File-backed NDJSON (`.awd/<workflow>/events.ndjson`). One file per workflow. State snapshots are throwaway (`.awd/<workflow>/state.json`).
- **WorkerRuntime port** — `run({ agent, model, system, tools, effort, runner, runnerConfig, memory, input, outputSchema, timeout, key, step }) → { output, usage, raw }`; a `RunnerRegistry` routes each command to the adapter named by the agent's `runner:` (`--worker` is the default; `--worker fake` forces all). Adapters:
  - `claude-code` — spawns `claude -p --output-format json --json-schema <schema> --model <alias> --append-system-prompt … --allowedTools … --permission-mode … [--add-dir …]` in `claudeCode.cwd`; default on this machine (uses the user's login, no API key).
  - `anthropic` — `@anthropic-ai/sdk`, structured output (`output_config.format`), adaptive thinking.
  - `cli` — any headless CLI agent (`preset: codex | opencode` or a command); prompt on stdin, last JSON on stdout.
  - `herdr` — an interactive agent in a herdr pane: one prompt + a mailbox file (`<store>/mail/<cmd>.{in,out}.json`); the answer file is the contract.
  - `fake` — returns fixtures from `fixtures/ai/<agent>/<key>.json` → `<agent>.json` → `<step>.json`; used by tests.
- **MemoryStore port** — `record / recall({ key, limit }) / list / forget`; `FileMemoryStore` (`<store-dir>/memory/<agent>.ndjson`, a projection of `memory.learned` events rebuilt on start) and `MemoryMemoryStore`. The ai executor recalls before every call and puts the notes in the system prompt.
- **Board trigger** (`on: board`) — `canvasTrigger.ts` long-polls the canvas (`/wait`, then `/cards?since`), emits one event per column move with `meta.boardSeq` as the resume cursor; `author: user` by default so the workflow's own `board_move.sh` moves do not echo back.
- **Script executor** — `spawn(sh -c cmd)` with `AWD_EVENT` (JSON) + `AWD_KEY` env and the event JSON on stdin; parses the **last JSON line** of stdout as `{ outcome, data }`; plain exit 0 with no JSON = `done`.
- **Human executor** — nothing to execute; the reducer itself matches later events. From a shell, `awd emit <workflow> <event.type> --data '{…}'` is how a person resumes a run by hand; from a kanban board, dragging the card is.
- **Timer** — `schedule` commands (timeouts, retries) persist in the store as `timer.set` events and fire as `<step>.timeout` when due (checked every tick + on startup).

### CLI

```
awd lint    workflow.yaml                 # schema + graph rules; exit 1 on error
awd graph   workflow.yaml [--mermaid|--json|--canvas [url] [--runtime url]]   # diagram export; --canvas draws/updates the board and stores the runtime url
awd run     workflow.yaml [--port 4311] [--worker fake|claude-code|anthropic|cli|herdr] [--store file|memory] [--store-dir DIR]
awd agents  workflow.yaml                 # who does what: runner · model · tools · steps · delegates
awd memory  workflow.yaml [agent] [--forget <id>]                 # long-term notes (memory.learned projection)
awd reflect workflow.yaml [--since 7d] [--to-board <id|title:…>]  # signals → patterns → one kanban card per pattern
awd emit    workflow.yaml <event.type> --data '{"card":"abc"}'   # inject an event (cli trigger)
awd status  workflow.yaml [key]           # runs & their state, from the event log
awd replay  workflow.yaml events.ndjson   # rebuild state, print the commands each event produced
awd test    workflow.yaml [tests/]        # golden tests: *.golden.yaml = { events: [...], expect: { outcomes|vars|commands|events|status } }
```

The runtime also serves, next to the webhooks: `GET /api/status`, `GET /api/events?since=N`, `GET /api/graph`, `GET /api/runs/:key`, and `GET /api/stream` (Server-Sent Events: `snapshot`, then `event` + `state` per appended event) — what the canvas overlay watches.

### Why this is not n8n

- No node palette with 400 integrations. Four step kinds. Integrations are *your scripts*.
- The file is the source of truth; the diagram is a projection (`awd graph`), never the other way round.
- Deterministic parts are testable without an LLM; the LLM only ever sees `input` and must return `output`.
- Humans are a first-class step, not a "wait" node bolted on.

---

## Part 2 — Canvas

### Board model

```ts
type Board = {
  id: string; title: string; kind: DiagramKind; seq: number; createdAt: string; updatedAt: string
  items: Record<string, Item>
  meta?: Record<string, unknown>                // e.g. { level: 'big-picture' } for event storming
}
type DiagramKind = 'event-storming' | 'user-story-map' | 'user-journey' | 'wireframe' | 'workflow' | 'kanban' | 'freeform'

type ItemType =
  | 'sticky' | 'text' | 'frame' | 'lane' | 'arrow' | 'comment' | 'wireframe' | 'card'
type Item = {
  id: string; type: ItemType
  x: number; y: number; w: number; h: number
  text?: string
  color?: string            // semantic token, not hex: 'orange'|'blue'|'yellow'|'pale-yellow'|'lilac'|'green'|'pink'|'red'|'grey'|'white'
  role?: string             // domain role: for event-storming 'event'|'command'|'actor'|'aggregate'|'policy'|'read-model'|'external'|'hotspot'|'opportunity'
                            // user-story-map 'activity'|'step'|'story'|'release'; user-journey 'stage'|'action'|'touchpoint'|'emotion'|'pain'|'opportunity'
                            // wireframe 'screen'|'box'|'button'|'input'|'heading'|'paragraph'|'image'|'nav'|'list'
                            // workflow 'trigger'|'script'|'ai'|'gate'|'human'|'outcome'|'agent'|'owns'|'delegates'
                            // kanban 'column'|'card'
  parent?: string           // containment (frame / lane / screen)
  from?: string; to?: string; label?: string   // arrows
  target?: string           // comments: the item this comment is about
  order?: number            // stable ordering inside a parent
  data?: Record<string, unknown>   // free structured payload (e.g. workflow step config, emotion score)
  createdBy: Author; updatedBy: Author; updatedAt: string
}
type Author = 'agent' | 'user'

type Op =
  | { kind: 'add'; item: Item }
  | { kind: 'update'; id: string; patch: Partial<Item> }
  | { kind: 'remove'; id: string }
type Change = { seq: number; ts: string; author: Author; boardId: string; ops: Op[]; before: Record<string, Item | null>; note?: string }
```

Persistence mirrors Part 1: `boards/<id>.json` (snapshot) + `boards/<id>.changes.ndjson` (append-only log). Every change carries `before` so diffs are cheap.

### Server (`awd-canvas serve`, default :4400)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/boards` | list |
| POST | `/api/boards` | `{ title, kind, meta?, items?: Item[] }` (or `{ title, kind, content }` to render a template) → `{ board }` |
| GET | `/api/boards/:id` | snapshot |
| POST | `/api/boards/:id/ops` | `{ author, ops, note? }` → `{ seq }` (atomic batch) |
| GET | `/api/boards/:id/changes?since=N&author=user` | change log |
| GET | `/api/boards/:id/diff?since=N` | *summarized* human-readable diff (what the agent reads) |
| GET | `/api/boards/:id/wait?since=N&timeout=30000&quiet=2500` | long-poll; resolves once the person has stopped for `quiet` ms, or at once on a `note: 'handoff'` change |
| GET | `/api/boards/:id/thumb.svg` | SVG thumbnail (board list) |
| GET | `/api/boards/:id/cards?since=N` | kanban: `{ moves: [{ cardId, title, from, to, seq, author, ts }] }` — what the `on: board` trigger polls |
| POST | `/api/boards/:id/cards` | kanban: `{ title, column, labels?, size?, … }` → new card at the bottom of the column |
| POST | `/api/boards/:id/cards/:cardId/move` | kanban: `{ column, author?, note? }` → re-parent + drop at the bottom (one logged change) |
| POST | `/api/boards/:id/template` | `{ kind, content }` → ops (render a template, does not apply) |
| WS | `/ws/:id` | broadcast `{ type:'change', change }` |
| GET | `/` , `/b/:id` | the web UI |

### MCP server (`awd-canvas mcp`, stdio) — the agent's hands

Tools, thin over the HTTP API:

- `canvas_list_boards()`
- `canvas_create_board({ title, kind, content })` — `content` is the structured input of that kind's template (below); returns `{ id, url, seq }`
- `canvas_read_board({ id, format: 'outline' | 'json' })` — `outline` is a compact text rendering (lanes → items, arrows, comments) that fits in context
- `canvas_apply({ id, ops, note })` — raw ops, author=`agent`
- `canvas_add_items({ id, kind, content, at? })` — template-render + apply in one call
- `canvas_diff({ id, since })` — user changes since `seq`, summarized: *"moved 'Card qualified' from lane Planning → Build"*, *"added comment on 'Qualify': 'what if size is unset?'"*
- `canvas_wait({ id, since, timeoutSec })` — blocks until the user changes something (or timeout) and returns the diff
- `canvas_open({ id })` — prints the URL (and opens the browser on macOS)

### Templates (structured content → items)

Each `DiagramKind` has a pure layout function `render(kind, content) → Item[]` in `packages/canvas/src/templates/`. The agent never computes pixels.

- **event-storming** — `{ level: 'big-picture'|'process'|'software', lanes?: string[], events: [{ text, lane?, actor?, pivotal? }], commands: [{ text, event, actor?, aggregate? }], policies: [{ text, when: eventText, then: commandText }], readModels, externals, aggregates, hotspots: [{ text, near }] }`. Timeline left→right, orange events on the spine; big-picture = events + actors + hotspots only; process adds commands/policies/read models; software groups by aggregate.
- **user-story-map** — `{ activities: [{ text, steps: [{ text, stories: [{ text, release? }] }] }], releases: string[] }`. Backbone row, steps row, story cells under each step grouped into release lanes.
- **user-journey** — `{ persona, stages: [{ text, actions, touchpoints, emotion: -2..2, pains, opportunities }] }`. Stages as columns, rows for each facet, emotion drawn as a curve of stickies.
- **wireframe** — `{ screens: [{ name, w?, h?, elements: [{ role, text?, x, y, w, h }] }] }` on a 12-column grid; low-fi grey boxes.
- **workflow** — the JSON from `awd graph --json`; triggers left, steps in topological columns, outcome edges labelled; when `agents` is present, an **Agents** frame above the graph (one card per agent, dotted `owns` links to its steps, dashed `delegates` links) that the run overlay badges busy / idle.
- **kanban** — `{ columns: [{ name, wip? }], cards: [{ id?, title, column, labels?, size?, assignee?, description? }] }`. Vertical column lanes, cards stacked inside; a card's column is its `parent`, so a drag is an ordinary change the runtime can read as an event.
- **freeform** — `{ items: Item-ish[] }` passthrough.

### Web UI (`packages/canvas/web`, Vite + React + @xyflow/react)

- Pan/zoom/drag/multi-select; frames & lanes are group nodes (children move with them, `extent: 'parent'`).
- Double-click edits text; toolbar adds sticky / comment / arrow / frame; colour swatches by semantic token; `Delete` removes.
- Every user edit → one `POST /ops` with `author: 'user'`; the board applies optimistically and reconciles from the WS stream.
- Right panel: **change feed** (agent vs user, newest first) and a per-item **comment thread**.
- Light and dark theme; sticky colours are tokens so both themes work.
- **Run overlay** (`web/src/run/`): on a workflow board with `meta.workflow.statusUrl`, subscribes to the runtime's SSE stream and badges step / agent cards with running · waiting · done · failed, plus a Runs / Events drawer — a projection, nothing is written to the board.

### The loop that makes it "alignment"

```
agent: canvas_create_board(kind:'event-storming', content) → url
agent: "I drew the pipeline as an event storm at <url>. Move things or add comments, I'm watching."
agent: canvas_wait(id, since)                       ← blocks
user : drags 'Card planned' before 'Human confirmed', adds comment "this is where it gets stuck"
agent: canvas_diff → "moved …; comment on … 'this is where it gets stuck'"
agent: reasons, replies with canvas_add_items (a hotspot + a policy), and/or updates workflow.yaml
```

---

## Repo layout

```
packages/core      @awd/core      domain + application: schema · expressions · lint · reducer · graph   (no IO — test/architecture.test.ts)
packages/runtime   @awd/runtime   hexagonal:
  src/ports/                      EventStore · WorkerRuntime · ScriptRunner · Clock · AgentChannel · Mailbox · TriggerSource · MemoryStore
  src/application/                engine · timer · runnerRegistry · executors/ai · agents (merge) · keys · prompting · memory · reflection
  src/adapters/                   store/{file,memory} · workers/{fake,claudeCode,anthropic,cli,herdr} · channels/{herdr,fake}
                                  mailbox/{file,memory} · memory/{file,memory} · triggers/{webhook,cron,canvasTrigger} · canvas/cards · process/script · clock/{system,fake} · fs/workflowLoader
  src/index.ts                    composition root: createRuntime({ workflow, store, worker, port })
  src/{engine,eventStore,load,timer,workers/*,executors/*,triggers/*}.ts   compatibility shims (re-exports only)
packages/cli       @awd/cli       `awd` — a driving adapter over createRuntime
packages/canvas    @awd/canvas    board model · templates · diff · thumb (pure) · ports/BoardRepository ·
                                  adapters/boards/{file,memory} · server (HTTP/WS) · MCP · docs · web UI (`awd-canvas`)
examples/card-pipeline            the coordinator, rewritten as workflow.yaml + agents + fake scripts + golden tests (15)
examples/herdr-smoke              two herdr-pane agents (codex → opencode) in one workflow
dev/                              this repository's own development process (kanban → plan → worktree → build → test → review → merge), run by awd
docs/                             this file, MANUAL + ARCHITECTURE + ROADMAP (繁中), agents, reflection, workflow, canvas
```

The dependency rule — ports import nothing, application imports only ports, adapters import ports + application, only the composition root wires adapters together — is enforced by `test/architecture.test.ts` in each package.
