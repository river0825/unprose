# card-pipeline — the coordinator skill as data

The original was a Claude Code skill (not included here):
a 37 KB `SKILL.md`, a 100 KB `reference.md`, and ~7 000 lines of Python that
drifted apart one incident at a time. This folder is the same pipeline as a
**19-step `workflow.yaml`** with **four agents** you can lint, draw, replay and
test — without a model in the loop.

```
Backlog ─[human]→ Agent Planning ─[agent]→ Agent Planned ─[human]→ Ready
  → In Progress → AI Agent Review → Human Review ─[human]→ Human Review Passed ─[agent]→ Ready for Staging
```

| Step | Kind | What the prose used to say |
|---|---|---|
| `plan` | ai `@planner` (opus) | "author the spec and review it here… ST:ReadyForAgent or ST:ReadyForHuman" |
| `handoff` | script | "the planning worker moves the card to Agent Planned" |
| `confirm` | human | "never move an Agent-Planned card to Ready — that's the human's gate" |
| `qualify` | script (`qualify.py`) | hands-off labels · RFA · CardSize · Risk |
| `size-gate` | gate | "size decides routing" · "a shrug takes the guarded path" |
| `guard-check` | script (`check_risk.py`) | "a hard-to-reverse card owes a rollback plan and a tripwire test" |
| `build` | ai `@builder` (opus) | writes the code — the first round and every fix round (findings / architect guidance) |
| `push` | script, retry ×1 | "adopt planning's branch + draft PR… gate.py" |
| `review` ∥ `qa` | ai `@reviewer` (sonnet) ∥ ai `@qa` (sonnet) | code review and black-box QA run side by side (`concurrency: 2`) |
| `architect-review` | ai `@architect` (opus, `agents/architect.md`) | delegation: the reviewer's `needs-architect` outcome is the event this step listens to |
| `fix-round` → `build` | script (`round.sh`) | "feedback wins" — the builder fixes, but bounded: 3 rounds then `escalate` |
| `ready-gate` → `park` → `human-review` | gate / script / human | both agents must agree (latest review clean, QA passed) before "a person tests the running feature" |
| `merge` | script | "merge only on the human's move" |
| `sweep` | script, on cron | "reconcile — orphans are listed, never deleted" |

The scripts here are **fakes**: they read `board.json` instead of Trello and
narrate what the real ones would do on stderr. Swap them for the real
`trello_card_ops.py` / `gh` calls and nothing in the yaml changes.

## Try it

```bash
npm install && npm run build            # once, at the repo root

cd examples/card-pipeline
npm run lint                            # schema + graph rules
npm run graph                           # mermaid — paste into a markdown preview
npm run demo                            # 15 golden tests, fake worker, no LLM
```

Run it for real (fake model, real event loop):

```bash
npm run run                             # webhook on :4311, cron every 30m
# in another shell:
npx awd emit workflow.yaml card.moved --data '{"card":"c-happy","name":"Upload contacts CSV","to":"Agent Planning"}'
npx awd status workflow.yaml            # c-happy waiting confirm(card.moved)
npx awd emit workflow.yaml card.moved --data '{"card":"c-happy","to":"Ready"}'
npx awd status workflow.yaml            # … → build.done → review.clean → park.done, waiting human-review
npx awd replay workflow.yaml            # every event and the commands it produced
```

Or POST what Trello would:

```bash
curl -X POST localhost:4311/hooks/trello -H 'content-type: application/json' -d '{
  "action": { "type": "updateCard",
    "data": { "card": { "shortLink": "c-happy", "name": "Upload contacts CSV" },
              "listBefore": { "name": "Human Review" }, "listAfter": { "name": "Human Review Passed" } } } }'
```

## The agents

```bash
npx awd agents workflow.yaml            # who does what: runner · model · tools · steps · delegates
```

| agent | model | runner (default) | why it exists |
|---|---|---|---|
| `@planner` | opus, effort high | claude-code | writes the plan; `roles/planner.md` is its prompt |
| `@builder` | opus | claude-code | writes the code, first build and every fix round |
| `@reviewer` | sonnet | claude-code | reviews the PR; `delegates: [architect]` |
| `@architect` | opus, effort xhigh | claude-code | only reached by delegation; defined in `agents/architect.md` (frontmatter + prompt, the Claude Code agent-file shape) |
| `@qa` | sonnet | claude-code | black-box QA of the preview, in parallel with the review |

`@reviewer → @architect` is not a hidden tool call: the reviewer *finishes* with
`needs-architect`, the architect's step listens to that event, answers with
`guidance`, and the builder's next round follows it. `11-delegation.golden.yaml` proves the whole
round trip with fixtures; `awd graph` draws the hand-off as an ordinary edge.

### Memory

An agent's answer may carry two extra fields whatever its schema says:
`remember: {…}` (kept for the rest of **this run**, merged per agent, visible
as `state.memory.short`) and `learn: [{ note, tags }]` (kept for **future runs**
of this project). Each `learn` becomes a `memory.learned` event; on the next
call the runtime recalls the agent's notes (`agents.<id>.memory.recall`, default
20; key-matching notes first) and puts them in its system prompt.

```bash
npx awd memory workflow.yaml            # what every agent has learned so far
npx awd memory workflow.yaml planner --forget <id>
```

`13-memory.golden.yaml` shows both: the planner learns on one card and is
reminded on the next; the reviewer's `remember` is in state, not in `vars`.

### Reflection

A third extra field, `reflect: [{ note, kind, tags }]` (`kind`: friction | bug |
idea | rule), is for the **people**, not the model: each item becomes a
`reflection.noted` event. Scripts can send the same field next to their
`outcome`. Every `<step>.failed` / `<step>.timeout` counts as a signal too, with
no one writing anything. `awd reflect` groups the signals into patterns and,
with `--to-board`, opens one kanban card per repeated pattern — with the guard
it asks for (a golden, a lint rule, a gate). The `reflect-failure` step listens
to `*.failed` (any step) and does that automatically when a canvas is reachable.

```bash
npx awd reflect workflow.yaml --since 7d
npx awd reflect workflow.yaml --to-board "title:Card pipeline — Kanban"   # idempotent
```

`14-reflection` proves the wildcard fires on another step's failure;
`15-reflection-signal` proves the reviewer's `reflect` reaches the log and
stays out of `vars`. See `docs/reflection.md`.

### Switching a stage to another tool (codex, opencode, …)

Every agent may name its own `runner`; `--worker` is only the default. Two
alternatives are already written in `workflow.yaml` as comments:

```yaml
agents:
  reviewer:
    runner: cli
    cli: { preset: codex }            # headless: codex exec --json -s read-only -, prompt on stdin
  qa:
    runner: herdr
    herdr: { kind: opencode }         # interactive: an opencode session in a herdr pane, driven by prompts
```

Uncomment one, then `npm run run:claude` (the other agents keep using the
default). `npm run demo` still passes: `--worker fake` overrides every runner,
so goldens never need codex or herdr. How the `cli` and `herdr` runners work —
the JSON contract, the mailbox files, what happens when a pane is `blocked` —
is in [`docs/agents.md`](../../docs/agents.md).

## Kanban instead of Trello

`workflow.yaml` carries a commented `kanban:` trigger (`on: board`). With the canvas server running and a
kanban board titled "Card pipeline — Kanban" (`node packages/canvas/dist/cli.js demo` creates one), uncomment
it and the person's drags between columns become `card.moved` events — no Trello, no webhook. The other
direction is `scripts/board_move.sh <boardId> <cardId> "<column>"`: a script step calls it to push the card on
when a stage finishes. See `docs/workflow.md` → "Board trigger".

## With a real model

```bash
npm run run:claude          # = awd run workflow.yaml --worker claude-code
```

`claude-code` runs each `ai` step through the local `claude -p` CLI with
`--json-schema` set to the step's `output`, so the answer is validated before
it becomes an event. Uses your existing login. `--worker anthropic` does the
same through the API (`ANTHROPIC_API_KEY` or an `ant auth login` profile).
Model aliases in the yaml (`opus`, `sonnet`) are resolved by the worker.

## The tests

`tests/*.golden.yaml` come in two modes (15 files; `11-delegation` and
`12-qa-fails` cover the multi-agent paths, `13`–`15` memory and reflection):

- **`mode: run`** — you give only the outside events (card moves); the engine
  runs the fake scripts and the fake worker (`fixtures/ai/…`) and you assert on
  the sequence of outcomes. `05-review-loop` proves the bounded review loop;
  `03-build-retry` proves `retry`.
- **`mode: replay`** — you give *every* event, including step outcomes, and
  only the reducer runs. `10-reducer-only` pins the exact commands each event
  must produce. This is the test to write after an incident: record the event
  stream, assert the decision, keep it forever.

Every incident from the original pipeline's post-mortems becomes one of
these instead of another paragraph.
