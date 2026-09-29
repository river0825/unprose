# `awd` — workflow guide

`awd` runs small, event-driven agent workflows. A workflow is one YAML file:
**triggers** turn outside events into domain events, **steps** react to events
and emit `<step>.<outcome>` events, and a pure **reducer** decides what runs.
There are exactly four kinds of step — `script`, `ai`, `gate`, `human` — and
integrations are your own scripts.

```
awd lint    workflow.yaml                      schema + graph rules (exit 1 on error)
awd graph   workflow.yaml [--mermaid|--json|--canvas [url] [--runtime url]]   the diagram is a projection of the file; --canvas draws it on the canvas (§7)
awd run     workflow.yaml [--port 4311] [--worker fake|claude-code|anthropic|cli|herdr] [--store file|memory] [--store-dir DIR]
awd agents  workflow.yaml                      who does what: runner · model · tools · steps · delegates
awd memory  workflow.yaml [agent] [--forget <id>]                 long-term notes agents learned (docs/agents.md §7)
awd reflect workflow.yaml [--since 7d] [--to-board <id|title:…>]  failures + reflect notes → patterns → kanban cards (docs/reflection.md)
awd emit    workflow.yaml <event.type> --data '{"card":"abc"}'
awd status  workflow.yaml [key] [--json]
awd replay  workflow.yaml [events.ndjson] [--key KEY]
awd test    workflow.yaml [tests/ | file.golden.yaml…]
```

A worked example: [`examples/card-pipeline`](../examples/card-pipeline/README.md).

---

## 1. The YAML

```yaml
name: card-pipeline                  # required
key: "{{ event.data.card }}"         # aggregate id → one run per card. Omit: each trigger event is its own run.
concurrency: 1                       # max active script/ai steps per key (default 1). 0 = unlimited.

triggers:
  <id>:
    on: webhook | cron | cli | manual | board   # board: a kanban board on the canvas (§6)
    emit: card.moved                 # event type (default: the trigger id)
    path: /hooks/trello              # webhook: POST path (default /hooks/<id>)
    every: 30m                       # cron: interval        (ms|s|m|h|d|w)
    at: "09:00"                      # cron: daily, local time
    if: "body.action.type == 'updateCard'"     # webhook: drop the request when false
    data:                            # webhook: normalize the payload; scope = { body, query, headers, env, now }
      card: "{{ body.action.data.card.shortLink }}"

steps:
  <id>:
    description: …                   # shows up in graphs / the canvas
    on: card.moved                   # string | list; each entry may be { event, if }; "*.failed" / "*.timeout" = any other step's
    if: "event.data.to == 'Ready'"   # sugar: applies to every listener above
    outcomes: [pick, skip]           # what this step can emit (script: default [done])
    terminal: [skip]                 # outcomes nobody needs to consume (or `true` for all)
    timeout: 2h                      # → <step>.timeout
    retry: { max: 2, backoff: 5m }   # on failed/timeout, re-run up to `max` more times
    # exactly one of:
    run:   python3 scripts/qualify.py --card {{ key }}
    ai:    { agent, prompt, model, input, output }   # agent from `agents:` (legacy: role)
    gate:  { outcomes: { name: expr, … }, default: name }
    human: { resume_on: [event…], outcomes: { name: expr, … } }
```

### Event names

- a trigger's `emit` — `card.moved`, `tick`
- a step's outcome — `qualify.pick`, `plan.done`
- implicit for every step — `<step>.failed`, `<step>.timeout`, `<step>.retry`
- wildcards a step may listen to — `*.failed`, `*.timeout` (any **other** step's; the graph shows one `any step / failed` node)
- written by the runtime, never listened to — `timer.set` / `timer.cancel`, `memory.learned`, `reflection.noted`

`awd lint` refuses an `on:` that nothing produces, and warns about an outcome
nothing consumes (declare it `terminal` if that is intended).

### `script`

```yaml
qualify:
  on: card.moved
  run: python3 scripts/qualify.py --card {{ key }}
  outcomes: [pick, skip]
  cwd: .            # default: the workflow file's directory
  env: { BOARD: "{{ env.TRELLO_BOARD }}" }
```

Contract with the script:

| Channel | Content |
|---|---|
| env | `AWD_EVENT` (the event as JSON) · `AWD_KEY` · `AWD_STEP` · `AWD_ATTEMPT` (+ your `env:`) |
| stdin | `{ "event", "vars", "key", "step", "attempt" }` |
| stdout | the **last line that parses as JSON** → `{ "outcome": "pick", "data": {…}, "reflect"?: [{ note, kind, tags }] }`. No JSON, exit 0 → `done`. Any JSON without `outcome` → `done` with that JSON as data. `reflect` items become `reflection.noted` events (docs/reflection.md). |
| exit ≠ 0 | `<step>.failed` with the stderr tail in `data.error` |
| stderr | free narration, kept in the event's `meta.stderr` |

Use stderr for logging and stdout only for the answer — the runtime only
looks at the last JSON line, so earlier chatter on stdout is harmless but
wasteful.

### `ai`

```yaml
agents:                              # who — personas, declared once (see docs/agents.md)
  planner:
    description: Turns a card into an executable plan.
    file: roles/planner.md           # system prompt (or `system: |` inline, or agents/planner.md)
    model: opus
    tools: [Read, Grep, Glob]
    effort: high
    delegates: [architect]           # who it may hand work to (documentation + lint)
    runner: claude-code              # claude-code | anthropic | fake | cli | herdr (default: --worker)
    memory: { longTerm: true, recall: 20, shortTerm: true }   # default; `false` turns both off (docs/agents.md §7)
    claudeCode: { permissionMode: acceptEdits, cwd: "{{ vars.worktree.path }}", addDirs: [] }   # claude-code runner only

plan:                                # what
  on: qualify.pick
  ai:
    agent: planner                   # preferred. Legacy: `role: planner` → roles/planner.md
    prompt: "…"                      # inline override; templates allowed
    model: opus                      # overrides the agent's model for this step
    input:                           # what the model sees (templated)
      card: "{{ key }}"
      size: "{{ vars.qualify.size }}"
    output:                          # JSON schema the answer must satisfy
      type: object
      required: [outcome, summary]
      properties:
        outcome: { enum: [done, needs-human] }   # ← required: the enum IS the step's outcomes
        summary: { type: string }
```

The model gets the system prompt, the `input` as a JSON block and the schema.
The answer is validated (ajv) before it becomes an event; a violation is
`<step>.failed` — so `retry` applies. `outcome` is stripped from the data; the
rest becomes `vars.<step>` — except three fields every schema implicitly
allows: `remember` (kept in `state.memory.short[agent]` for this run), `learn`
(→ `memory.learned` events, recalled into the agent's next prompt) and
`reflect` (→ `reflection.noted` events). Before each call the runtime puts the
agent's recalled notes and this run's earlier outcomes at the top of the
system prompt.

Workers / runners (`--worker` sets the default; each agent may pick its own `runner:`; `--worker fake` overrides all):

| name | how | needs |
|---|---|---|
| `fake` (default) | `fixtures/ai/<agent>/<key>.json` → `<agent>.json` → `<role>…` → `<step>.json`; arrays are consumed in order | nothing |
| `claude-code` | `claude -p --output-format json --json-schema … --model <alias> --append-system-prompt … --allowedTools … --effort … [--permission-mode … --add-dir …]`, spawned in `claudeCode.cwd` | the `claude` CLI logged in |
| `anthropic` | `@anthropic-ai/sdk` structured outputs, adaptive thinking, `output_config.effort`, `web_search` server tool when listed | `ANTHROPIC_API_KEY` or `ant auth login` |
| `cli` | any headless CLI agent: `cli: { preset: codex \| opencode }` or `cli: { command: "… -" }`; prompt on stdin, last JSON in stdout is the answer | that CLI installed |
| `herdr` | an interactive agent in a herdr pane, driven by one prompt + a mailbox file — for agents with no A2A | herdr running |

Delegation between agents is an **event**: the reviewer finishes with `needs-architect`, the
architect's step listens to it. See [agents.md](agents.md).

### `gate`

A decision with no IO. Outcomes are tried in order; the first true wins;
`default` catches the rest (without one an unmatched gate emits `<step>.failed`).

```yaml
size-gate:
  on: qualify.pick
  gate:
    outcomes:
      guarded: "vars.qualify.riskClass == 'hard-to-reverse'"
      build:   "vars.qualify.size in ['XS','S','M','L']"
    default: split
```

Gates never take a concurrency slot and appear in the run's history like any step.

### `human`

Pauses the run. A later event on the **same key** whose type is in `resume_on`
is tested against each outcome expression; the first match resumes the run
with `<step>.<outcome>` (carrying that event's data).

```yaml
confirm:
  on: handoff.done
  timeout: 7d                        # → confirm.timeout
  human:
    resume_on: card.moved
    outcomes:
      approved: "event.data.to == 'Ready'"
      shelved:  "event.data.to == 'Backlog'"
```

The resuming event still fires every other listener it matches — so a human
step and a `script` step can both react to the same move. Use `if`
conditions (e.g. `!('plan' in vars)`) to tell "already planned" from "not".
`awd emit workflow.yaml card.moved --data '{…}'` is how you resume from a shell.

### Timeouts and retries

`timeout` schedules `<step>.timeout` when the step starts and cancels it when
the step finishes. Timers are **durable**: they are written to the event log
(`timer.set` / `timer.cancel`) and re-armed on restart. `retry` re-runs the
step after `failed` or `timeout` up to `max` more times, waiting `backoff`
between attempts; `AWD_ATTEMPT` tells the script which try it is. When the
budget is exhausted the run is `failed` and `<step>.failed` is emitted for a
downstream step to handle (`on: build.failed`).

---

## 2. Expressions and templates

A tiny, safe language (no `eval`, no prototype access):

```
literals    'str' "str" 12 1.5 true false null [a, b]
access      event.data.to   vars['qualify'].size   list[0]
operators   ! -   * /   + -   < <= > >=   == !=   in   && ||   c ? a : b
functions   len lower upper trim startsWith endsWith includes json default split join keys number string
```

`==` is loose across primitives (`'3' == 3`), deep for objects. `in` works on
arrays, strings and object keys. Unknown names are `undefined`, not errors.

Scopes:

| where | names |
|---|---|
| step `if`, gate/human outcomes, templates in `run`/`env`/`ai.input`/`ai.prompt` | `event` `vars` `key` `env` `now` `history` |
| trigger `if` / `data` | `body` `query` `headers` `env` `now` |
| workflow `key` | `event` `env` `now` |

Templates are `{{ expr }}` inside strings. A string that is **exactly one**
template keeps the value's type (`n: "{{ body.count }}"` → a number); anything
else is stringified (objects as JSON).

`vars.<step>` is the `data` of that step's most recent non-failure outcome.

---

## 3. What the reducer does

`reduce(def, state, event) → { state, commands }` — pure, no clock, no IO.

1. If the event is `<step>.<outcome>` of one of our steps: record it in
   `history`, store `vars[step]`, free the slot; on `failed`/`timeout` decide
   retry vs. terminal failure.
2. If a `human` step is waiting on this event type and an outcome matches:
   emit `<step>.<outcome>`.
3. For every step whose `on` (and `if`) matches: activate it — `run_script`,
   `call_ai`, `wait_human`, or for a gate an immediate `emit`. If the step is
   already active for this key, or `concurrency` is reached, it is queued in
   `pending` and released when a slot frees (FIFO).
4. `timeout` → a `schedule` command; finishing → `cancel_schedule`.

Command ids are derived from `(event.id, step, attempt)`, so replaying the
same log always yields the same commands. The engine uses that to be
idempotent: on restart it replays the log, and any command whose answer is
already in the log is not re-executed.

Run state (`awd status --json`):

```
status    idle | running | waiting | done | failed
active    { step: { commandId, since, attempt } }     executor in flight
waiting   { step: { since, resumeOn } }               human steps
pending   [ { step, event } ]                         blocked by concurrency
retrying  { step: { at, attempt } }                   backoff timer armed
vars      { step: data }
history   [ { step, outcome, at, attempt } ]
```

---

## 4. Golden tests

`tests/*.golden.yaml`, run with `awd test`:

```yaml
mode: run                # run (default replay): only outside events are given; scripts + fake worker execute
key: c-happy
fixtures:                # optional inline fake-worker answers, by role (or role/key, or step)
  planner: { outcome: ready-for-agent, summary: ok, size: M }
events:
  - { type: card.moved, data: { card: c-happy, to: Agent Planning } }
  - { type: card.moved, data: { card: c-happy, to: Ready } }
expect:
  status: waiting
  outcomes: [plan.ready-for-agent, handoff.done, confirm.approved, qualify.pick, …]   # exact sequence
  vars: { qualify: { size: M } }                                                   # partial match
  commands:                                                                        # ordered subsequence, partial match
    - { kind: call_ai, step: plan, input: { card: c-happy } }
    - { kind: run_script, step: qualify, cmd: "~qualify.py" }                      # "~x" = contains x
```

- **`mode: replay`** gives *every* event by hand (including step outcomes)
  and runs only the reducer — no scripts, no model, milliseconds. Use it to
  pin decisions: "given these events, this command must be produced".
- **`mode: run`** injects the events one at a time into a real engine with an
  in-memory log, real `script` steps and the `fake` worker, waiting for the
  engine to go idle between events. Use it for end-to-end paths.

After an incident, record the events (`awd replay` prints them) and turn them
into a golden file. That is the rule-that-cannot-drift.

---

## 5. Running

```bash
awd run workflow.yaml --worker claude-code --port 4311
```

- Webhooks: `POST http://localhost:4311<path>` per webhook trigger → `202 { event }` or `200 { accepted: false, reason }`.
- Read-only: `/api/status` (runs + timers), `/api/events?since=N[&key=]`, `/api/graph`, `/api/runs/:key`, `/api/stream` (SSE) — see §7.
- Cron triggers fire in-process. `awd emit` appends to the same log from another shell; the running engine picks it up within 500 ms.
- The log lives in `.awd/<name>/events.ndjson` next to the workflow (or `--store-dir`). Delete it to start over; it is the only state.
- `SIGINT` stops cleanly; on the next start unanswered commands are re-issued and pending timers re-armed.

Scripts run with `cwd` = the workflow's folder and inherit the environment, so
`env.TRELLO_TOKEN` in an expression and `$TRELLO_TOKEN` in a script are the same thing.

## 6. Board trigger — a kanban board as the event source

Instead of a Trello webhook, let a kanban board on the canvas feed the workflow. A person drags a card into another column; the runtime turns that into a domain event.

```yaml
triggers:
  kanban:
    on: board
    board: "title:Card pipeline — Kanban"   # a board id, or `title:<exact board title>`
    canvas: http://localhost:4400           # default: AWD_CANVAS_URL
    author: user                            # whose drags count: user (default) | agent | all
    emit: card.moved
    if: "to == 'Ready'"                     # optional
    data:                                   # templates over { card, from, to, author, seq, env, now }
      card: "{{ card.id }}"
      name: "{{ card.title }}"
      from: "{{ from }}"
      to:   "{{ to }}"
```

`card` is `{ id, title, labels, size, assignee, description }`; `from` / `to` are column names. Lint requires `board`, and `data` templates may only reference those names.

How it works: the adapter (`packages/runtime/src/adapters/triggers/canvasTrigger.ts`) long-polls `GET /api/boards/:id/wait` on the canvas, then reads the moves (the kanban `GET /cards?since` endpoint when the server has it, otherwise `GET /changes` and the ops' `before` snapshots). Every emitted event carries `meta.boardSeq`; on restart the newest one is the resume point, so nothing replays. A brand-new trigger starts from the board's current seq — old history is not turned into events.

The other direction — the workflow pushing the card on when a stage finishes — is a plain script step:

```yaml
advance-card:
  on: qualify.pick
  run: bash scripts/board_move.sh <boardId> {{ key }} "In Progress"
```

`examples/card-pipeline/scripts/board_move.sh` calls `POST /api/boards/:id/cards/:cardId/move` (falls back to an ops POST that re-parents the card). Because the workflow's own moves are `author: agent`, they do not come back as new events.

## 7. Watching runs live (the n8n view)

`awd run` serves, next to the webhooks:

| Endpoint | Returns |
|---|---|
| `GET /api/status` | `{ workflow, runs: RunState[], timers, events }` |
| `GET /api/events?since=N&key=` | the event log |
| `GET /api/runs/:key` | one run's state + all its events (with data) |
| `GET /api/stream` | **Server-Sent Events**: a `snapshot` (runs + last 200 events), then `event` and `state` frames for every appended event; `ping` every 15 s |
| `GET /api/graph` | the graph `awd graph --json` prints |

All `/api/*` responses carry `Access-Control-Allow-Origin: *`, so a browser page anywhere can watch.

The canvas uses this: `awd graph workflow.yaml --canvas [--runtime http://localhost:4311]` draws (or updates) the workflow board and stores `meta.workflow.statusUrl` on it. Open that board and the **run overlay** appears: a badge on every step card — `● running`, `⧗ waiting for a person`, `✓ done`, `✕ failed`, `×N` when several runs sit on the same step — a badge on every agent card (working / idle, with the run and step it is on), and a bottom drawer with **Runs** (click one to filter the badges to that key) and **Events** (live feed; click a row to see its data). Nothing is written to the board; the overlay is a projection of the runtime's event log. `?run=<url>` on the board URL overrides the stored status URL.
