# Studio — understand and change a workflow, one block at a time

The workflow board is a projection of `workflow.yaml` (+ `agents/*.md`, + the scripts a step runs).
Studio makes every block on it *readable* (what does this agent believe, what exactly is it prompted with,
when does this gate let a run through, what does this script do) and *discussable*: the person selects one item
or several, chats about them, and a Claude Code session opened for that selection in a herdr tab does the edit.

**The AI is the main editor; the person directs.** The person can still edit the files by hand — the board
simply redraws. Nothing on the canvas writes to `workflow.yaml` by itself: files stay the only truth, and
every change shows up in `git diff`.

```
 canvas (browser)                 awd studio (local)                 herdr tab
 ─────────────────                ──────────────────                 ─────────
 select items → Inspector / Chat
 "Ask AI" → comment on 1st item ─▶ sees data.discuss in the diff ──▶ claude --model <m>, briefed on the block
   data.discuss = {model, about}   opens / reuses a session           edits files, awd lint, tests
                                   acks on the board                  awd graph --canvas (board redraws)
 reads replies in the thread ◀──────────────────────────────────── replies in the same thread (unprose MCP)
```

## 1. Block detail (the projection)

`awd graph <wf> --canvas` (and `awd studio`) attach a `detail` object to every graph node and agent.
The workflow template copies it to the board item as `item.data.detail`. It is a *snapshot*, refreshed on
every redraw; the Inspector renders it, the studio briefing quotes it.

```ts
type BlockDetail =
  | { kind: 'agent'; file?: string; persona?: string; frontmatter: Record<string, unknown>; steps: string[] }
  | { kind: 'ai'; agent?: string; role?: string; model?: string; file?: string; prompt: string;
      input: Record<string, unknown>; output: Record<string, unknown>; outcomes: string[] }
  | { kind: 'script'; run: string; file?: string; code?: string; truncated?: boolean }
  | { kind: 'gate' | 'human'; rules: Array<{ outcome: string; when: string; terminal: boolean }>;
      resumeOn?: string[]; timeout?: string; plain: string[] }
  | { kind: 'trigger'; on: string; emit: string; config: Record<string, unknown> }

// every variant also carries:
//   source: { workflow: string /* repo-relative path */; line?: number /* 1-based line of the step/agent key */ }
//   listens: string[]  // events it runs on (with `if`), in words
//   emits:   string[]  // events it produces: <id>.<outcome>, <id>.failed, <id>.timeout
```

- **Paths** are relative to the repo root (the git top level of the workflow file, else its directory).
- `persona` = the agent file's markdown body (frontmatter stripped); `frontmatter` = the parsed header
  (model, effort, tools, memory, claudeCode, delegates …).
- `prompt` (ai) = the system prompt the worker would get, before `{{ }}` rendering — the persona (or role
  file) plus the output-schema instruction, as `application/prompting.ts` builds it.
- `file` (script) = the first token of `run` that resolves to an existing file under the workflow dir;
  `code` = its text, cut at 20 000 chars (`truncated: true`). (Not `source` — that name is the location.)
- `plain` (gate/human) = one sentence per rule, e.g. `Goes on as "approved" when event.data.to == 'Ready'`,
  `Stops the run as "timeout" after 7d`.

Resolution reads files, so it lives in the runtime (`application/blockDetails.ts` pure over a
`readFile` function; the CLI passes the fs one). `toGraph` in core stays pure and unchanged in meaning.

## 2. A discussion request is a comment

"Discuss with AI" in the Inspector adds an ordinary canvas comment on the block, marked:

```ts
{ type: 'comment', target: '<block item id>', text: '<what the person wants>', createdBy: 'user',
  data: { discuss: { model: 'opus' | 'sonnet' | 'fable' | 'haiku' } } }
```

**While studio runs, every new comment of the person's on a watched board reaches the agent** — Ask AI or
not:

- A **plain root comment** (no `data.discuss`, on a board item) is a chat request about its target with the
  default model (`--model`), handled exactly like Ask AI: the board session (a fork when it is busy, the
  queue when every pane is), `seenBy += agent` and `agentState` on it.
- A **reply** in a chat (to its root or to any message under it) goes to that chat's session: prompted with a
  fresh brief (section *New message in this chat*) as soon as the session is idle; held — in order, per
  chat, never forked — while it is working; the parked session is resumed first when its pane was closed.
  The reply is marked read at once. Studio drives the session; it does not watch the board itself.
- A reply on a thread that was **never a chat** (a plain comment written before studio ran) opens a chat on
  that thread's root, with the reply as its message.
- Agent comments (studio's acks, the session's answers) are never requests. An empty comment waits until it
  has text: the first change that gives it text is the request; editing a comment that already had text is
  not a new one.

Without studio, comments are just comments — an agent sees them only through `canvas_wait` / `canvas_diff`.

### 2b. Chat with the selection

Any selection — one item or many, blocks or not (stickies, frames, cards, arrows) — can be chatted with.
The request is the same comment, anchored on the first selected item, listing the whole selection:

```ts
{ type: 'comment', target: '<first selected id>', text, createdBy: 'user',
  data: { discuss: { model, about: ['<id>', '<id>', …] } } }   // about: the selection, in selection order
```

- `about` absent → `[target]` (a §2 single-block request is a one-item chat).
- The request comment is the **chat root**; every later comment targeting the root (the person's follow-ups,
  the studio ack, the session's answers) is a message of that chat. Follow-ups carry no `data.discuss` —
  studio hands each one to the chat's session (§2).
- Session: one item → `awd-studio-<block or item slug>` as before; several → `awd-studio-sel-<6-char hash of
  the sorted ids>`, so choosing the same set again reopens the same conversation. Tab label
  `studio: <first> +N`.
- The brief lists every item in `about`: its type/role/text, `data.detail` when it is a block (else `data`),
  the arrows between them, and the files behind the blocks.

**Board chats.** With nothing selected, the Chat tab talks about the whole board: "New chat" adds a
**loose** comment (no `target`) with `data.discuss = { model, about: [] }`, placed near the top-left of the
view. Studio treats any loose user comment as a board chat (`kind: 'board'`, `about: []`), sent to the
board's session like every other chat; its brief lists every diagram frame (kind, key, title, source,
grammar), loose items, and the files behind the board (`meta.diagrams[*].source`, `meta.workflow.file`).
Replies under it are follow-ups as usual.

The web **Chat** tab shows for any selection (and, with nothing selected, for the board): chips for the selected items, the chats whose
`about` overlaps the selection (newest first, bubbles: you right, agent left), a reply box for an open
chat (plain comment on its root), and "New chat" (model picker + text → the request above).

## 3. `awd studio --project <dir>` (or `awd studio <workflow.yaml>`)

```
awd studio (--project <dir> | <workflow.yaml>) [--canvas http://localhost:4400] [--model opus]
           [--permission-mode auto] [--max-sessions 3] [--idle-close 30m] [--interval 2s]
           [--runtime http://localhost:4311] [--herdr-bin herdr] [--warm]
```

> Since §8a: one process per project, one Claude session per board (a fork while it is busy). The steps
> below describe what happens to one request; where they say "the session for the selection", read "the
> board's session" — §8a has the current rules and file layout.

1. Draws / refreshes the workflow board with details (same as `graph --canvas`).
2. Follows the board's changes. For each **new** `user` comment with `data.discuss` anchored on any
   non-comment item (§2, §2b):
   - the selection is `data.discuss.about` minus ids no longer on the board (or that are comments); empty →
     the anchor alone.
   - session name: `awd-<scope>-<key>`, ≤32 chars, where `<scope>` = the workflow's `name:` sanitised, ≤12
     chars (`awd-dev`, `card-pipelin`) so two workflows in one repo never share a session, and `<key>` = one
     workflow block → the block (`plan`; `@planner` → `agent-planner`); one other item → a slug of its text
     (≤20, else its id); several → `sel-<6-char FNV hash of the sorted ids>`. Example: `awd-awd-dev-plan`.
   - every request goes through the **queue** (§8a): an open idle session gets the prompt; a session that is
     working/blocked keeps it waiting (the chat shows `queued`); a new or parked conversation gets a pane in
     the workflow's one studio tab — `herdr tab create --label "studio: <workflow name>"` for the first pane,
     `herdr pane split <first pane> --direction right --no-focus` for the next — then `herdr agent start
     <session> --kind claude --pane <id> -- --model <model> --permission-mode <mode> (--session-id <uuid> |
     --resume <uuid>) -n "<selection>"`, then the prompt.
   - before the first prompt it waits like the herdr worker does: `agent wait --until idle --until done`,
     then `agent get` until `interactive_ready`, then 1.5 s for the TUI to settle.
   - the prompt is one line pointing at a brief file `.awd/studio/<scope>/<key>.md` (`plan.md`,
     `agent-planner.md`, `sel-1x9k2a.md`; the herdr worker's rule: no newlines in pasted prompts), written
     fresh from the board each time. The request text itself only goes into the brief.
   - the model comes from `data.discuss.model` only if it is one of `opus | sonnet | fable | haiku`;
     anything else falls back to `--model` (the value comes from the board, so it is never passed through).
   - an **agent** comment replies under the request comment: `Opened Claude (<model>) in pane N of herdr tab
     "studio: <workflow>"` / `Resumed the earlier conversation…` / `Sent to the open Claude session (pane N…)`
     / `Queued: …` (once per request) / `Could not open…`.
3. Keeps `{ board, seq, sessions, queue }` in `<repo>/.awd/studio/<scope>/state.json` (`sessions`: session
   name → `{ sessionId, root, roots, pane?, openedAt?, lastUsed, state, req }`, §8a; `queue`: the waiting
   requests, oldest first), so a restart neither reopens old requests nor forgets waiting ones; a first run
   starts at the board's current seq, not its history. Writes `<repo>/.awd/studio/<scope>/status.json` —
   `{ workflow, open, max, queued, updatedAt }` — every tick, for the canvas server (§8b).
4. Waits with the canvas long-poll (`/wait?author=user&wake=meaningful`), so moves do not wake it — 25 s at a
   time, or `--interval` while some session is not idle, so the §6 receipts keep up with herdr.

The brief tells the session: the person's request and the chat root to reply under; every selected item
(type/role/text; for a block, where it is defined and its `detail` — long text such as persona, prompt and
script code left out, the session reads the files — else its `data`); the arrows whose both ends are in
the selection; the files behind the blocks; **Look here** — for a request written on some lines (§5), the
`file:line–endLine` and the quoted lines, right after the request; the chat so far and earlier comments on
these items; **Open notes on these files** (§5); the board id; and the rules — you are the editor, the person directs; edit the source files, never the board items
(non-block items are context); run `awd lint <wf>` and the relevant tests; redraw with
`awd graph <wf> --canvas`; reply in the chat (unprose MCP `canvas_add_items`, a comment targeting the
root) — the person's next messages come from studio as new prompts, so no `canvas_wait`; ask before
changes that reach items outside the selection.

**Ports.** herdr is reached only through `AgentChannel` (`ports/agentChannel.ts`), extended with
`openTab(cwd, label)`, `splitPane(paneId, cwd)`, `closePane(paneId)` (an already-gone pane is fine) and
`start(name, kind, paneId, args?)`; the fake channel records calls for tests. The
canvas is reached through `ports/canvasBoard.ts` (board · changes since seq · wait · add items / patch items
(receipts) as the agent;
HTTP adapter `adapters/canvas/board.ts`, fake `adapters/canvas/fake.ts`), the brief/cursor files through
`ports/studioStore.ts` (state, briefs, status; `adapters/fs/studioStore.ts`, plus a memory one). The use case
is `Studio` in `application/studioLoop.ts`; the pure rules (which comments are requests, session names, the
brief) are in `application/studio.ts`, the pane pool's (pane numbers, which pane to evict or close) in
`application/pool.ts`; `packages/cli/src/studio.ts` is the composition root (it passes `crypto.randomUUID`
for session ids).

**Safety.** Studio turns board writes into a local agent session. Until the canvas is behind Cloudflare
Access, anyone who can reach the board can write a request. Sessions start in Claude Code's `auto` mode (the
AI is the editor: it edits and runs checks without asking, while its classifier still stops risky actions);
pass `--permission-mode manual` to approve every step in the pane. Studio only answers `user`-authored
comments, the mode comes from the command line (never the board), and every change is in `git diff`.

### Try it

```bash
npm run build                                     # runtime, cli, canvas (the canvas server must be this build: it keeps data.detail)
node packages/canvas/dist/cli.js serve --port 4400 &
node packages/cli/bin/awd.js studio --project .           # inside a herdr session
```

Open the printed board, select a block (e.g. `plan`), and add a comment with `data.discuss` — the Inspector's
**Discuss with AI** does that; without the UI:

```bash
curl -s -XPOST localhost:4400/api/boards/<board>/ops -H 'content-type: application/json' -d '{"author":"user","ops":[{"kind":"add","item":{
  "id":"req1","type":"comment","x":0,"y":0,"w":160,"h":80,"text":"What can go wrong here?","target":"wf.node.plan",
  "data":{"discuss":{"model":"sonnet"}},"createdBy":"user","updatedBy":"user","updatedAt":"2026-09-23T00:00:00Z"}}]}'
```

Studio logs `plan: opened (awd-awd-dev-plan, sonnet)`, a herdr tab `studio: awd-dev` starts Claude, and the
ack appears under the comment. `.awd/studio/awd-dev/plan.md` is the brief it was given. Dry run without herdr:
`--herdr-bin` accepts any executable that answers herdr's JSON (the smoke test used a shell script).

## 4. Inspector (web)

Selecting a workflow block (an item with `data.detail`) turns the Selected tab into an Inspector:

| block | sections |
|---|---|
| agent | Persona (rendered markdown), Model · effort · runner, Tools / skills, Memory, Delegates, Runs these steps |
| ai | Agent (link to its card), Prompt (collapsible, monospace), Input mapping, Output schema → outcomes |
| gate / human | "When does it go on?" — the `plain` sentences first, rules table second, timeout, resume on |
| script | Command, Source (monospace, collapsible, "truncated" note), Retry / timeout |
| trigger | On · emits · data mapping |

Every block also shows **Listens to / Emits** (in words), the source location (`design/runner-example.workflow.yaml:42`,
copyable), and at the bottom a **Discuss with AI** composer: model picker (default opus), a textarea, and
suggested asks per kind (agent: "Sharpen this persona", gate: "Explain when this blocks", script: "What can
go wrong here?"). Sending posts the §2 comment. The block's thread (requests, the studio ack, the
session's replies) is listed under it.

## 5. Read and comment on any text — files, prompts, personas, scripts

Everything the Inspector shows as text can be read in full and commented on **by line**, like a code review.

**Files snapshot.** Every redraw (`graph --canvas`, `studio`) also puts the files behind the workflow on the
board: `board.meta.workflow.files = { '<repo-relative path>': '<text>' }` — the workflow yaml, every agent
file, every role/prompt file, every script a step runs. Each file is cut at 100 000 chars (listed in
`meta.workflow.truncated: string[]`). Each block's detail also gets `detail.yaml = { start, end }`: the
1-based line range of that step/agent/trigger in the workflow file.

**Views.** Text shown with line numbers and comment gutters:
- a file (`file: 'examples/card-pipeline/agents/architect.md'`) — the **Files** view: file list + viewer, opened from any path
  link in the Inspector (persona file, script file, `design/runner-example.workflow.yaml:42` jumps to that line, "view yaml"
  shows the block's range);
- a derived text (`doc: 'prompt'`) — the ai step's assembled prompt, which is not a file.

**An anchored comment** is an ordinary comment with an anchor:

```ts
{ type: 'comment', target: '<owning block item id>', text, createdBy,
  data: { anchor: { file?: string; doc?: 'prompt'; line: number; endLine?: number; quote: string },
          discuss?: { model, about } } }   // discuss → it is also a chat request (§2b)
```

- `target` = the block the text belongs to (the block whose `detail.file`, `detail.source.workflow` range or
  prompt it is); a file no block owns (e.g. a shared script) targets the board's title item `wf.title`.
- `quote` = the selected lines' text at the time of writing. When the file changes, the viewer re-finds the
  quote (nearest match to `line`); not found → the comment shows as **outdated** with its quote, never lost.
- Select lines (click a line number, shift-click to extend) → composer: **Comment** or **Ask AI** (model).
- Replies target the anchored comment, as any thread.
- On the canvas they are ordinary comments on the block, so they also appear in the Chat tab and the
  thread lists; the anchor shows as `planner.md:12–14 "quote…"`.

**Studio** treats `anchor + discuss` as a chat request about the owning block, and the brief quotes the
anchor (`file:line–endLine` + quote) as the thing to look at. Every brief also lists the **open anchored
comments** behind the selection, so notes left without asking are picked up by the next session:
- *open* = no agent-authored comment targets it; the brief asks the session to reply under a note it acts on;
- *behind the selection* = the note targets a selected item (this covers `doc: 'prompt'`), or its `file` is
  one of the selection's files — except the workflow yaml, where it counts only when its lines overlap a
  selected block's `detail.yaml` range (a note on another step is not this chat's business).

The files snapshot is written by `pushGraphToCanvas` (`packages/cli/src/graphCanvas.ts`) from
`workflowFiles()` in `runtime/src/application/blockDetails.ts`: the workflow yaml plus every `detail.file`
(agent files, role/prompt files, script files). `meta` is replaced on each redraw, not merged. For
`examples/card-pipeline/workflow.yaml` that is its yaml plus every agent, role and script file.

## 6. "The agent has read this / is working on it"

Every comment the person writes shows where it is:

| sign | when |
|---|---|
| **Sent** | the comment exists; no agent has read it (`data.seenBy` lacks `agent`) |
| **Seen by agent** ✓✓ | `data.seenBy` includes `agent` — set by the canvas when an agent is shown it (`canvas_wait` / `canvas_diff`), and by studio when it picks up a request |
| **Agent is working…** (animated) | the chat root's `data.agentState.state` is `starting` or `working` |
| **Needs you in herdr tab "studio: plan"** | `agentState.state == 'blocked'` (a permission dialog or question in the pane) |
| **Could not start** | `failed` (the ack comment says why) |
| — | `idle` after an agent reply: nothing shown; the reply is the answer |

`data.agentState = { state, session?, tab?, at }` lives on the **chat root** (the request comment). Like
`seenBy` it is a receipt, not meaning (`RECEIPTS` in `canvas/src/model.ts`): a change made only of receipts
is bookkeeping, so it never wakes a `canvas_wait` and never shows in a diff.

Studio writes it: on pickup `seenBy += agent` and `starting`; after the prompt `working`; then on every tick
it asks herdr (`AgentChannel.get`) for each session that has an open chat and mirrors
`working | idle | blocked` onto that session's latest chat root when it changes. A follow-up in a thread
makes the session work again, so the sign comes back without a new request.

## 7. Wires are events — and can be dragged, then discussed

On a workflow board every flow wire **is one event subscription**: "when A emits `E` (and `if` holds), B runs".

**Projection.**
- `toGraph` edges carry the full event: `{ from, to, label, condition?, event, resume? }` (`event` = the
  `on:` name as written, e.g. `card-info.done`, `*.failed`; `resume: true` for a human step's `resume_on`).
- The template draws one arrow **per event** (id = hash of `from->to:event`, so `plan.ready` and
  `plan.needs-human` into `move-planned` are two wires, not one), `role: 'flow'`, label = the event name
  (`resume: <event>` for a `resume_on`, + ` if …`), `data.event = { event, condition?, resume?, from: <nodeId>,
  to: <nodeId> }` (node ids are workflow ids: `plan`, not `wf.node.plan`; `pending` ends accept either).
  Boards drawn before this had one wire per block pair; the first redraw replaces them with per-event wires.
- `owns` / `delegates` wires are agent relations, not events: drawn faint, full strength only while their
  agent (or step) is selected.
- Catch-all subscriptions (`*` patterns, `resume_on`, cron ticks, fan-outs / hubs of 4+ blocks) are drawn as
  badges on their blocks instead of long wires — click a badge or tick *Show catch-all wires* to draw them; the
  Wiring section still lists them. The rule and the *Wires: All / Selected / None* view: [canvas.md → Wires](canvas.md#wires).
- **A redraw is complete**: `wf.*` items the new drawing no longer has are removed (a step deleted from the
  yaml disappears from the board) — except wires holding a pending edit (below). Comments and hand-drawn
  items are never removed. An updated item keeps its presentation data (`seenBy`, `agentState`,
  `fromSide`, `toSide`, `bend`) and, if the person ever moved it, its geometry (`planRedraw` in
  `packages/cli/src/graphCanvas.ts`).

**Wiring ↔ wires.** Clicking an event in the Inspector's Wiring selects that wire (it comes to the front);
selecting a wire shows its event, condition, from → to, and a link to the `on:` line in the yaml.

**Editing a wire = proposing a change.** On a workflow board flow wires stay fully editable — drag an end
to another block, draw a new wire, delete one, edit its label — but the file does not change. The wire
records what the person meant:

```ts
data.pending = {
  kind: 'rewire' | 'add' | 'remove' | 'relabel',
  before?: { from: string; to: string; event: string; condition?: string },   // node ids; absent for add
  after?:  { from: string; to: string; event?: string; condition?: string },  // absent for remove
  by: 'user', at: string,
}
```

- rewire: the end moves on the board; `before` keeps the original. add: a new wire between two blocks; the
  panel asks which event of the source it is (a picker of the source's `emits`, or free text). remove:
  Delete does not remove a flow wire — it marks it `remove` (drawn struck-through / faded) until resolved.
  relabel: editing the label (e.g. adding `if …`) proposes a new event/condition.
- Pending wires are drawn dashed with a "proposed" tag; the panel shows **before → after** in words
  ("`plan` would run on `card-info.done` from `review` instead of `card-info`"), with **Ask AI to review**
  (model picker + optional note → a chat request, §2b, `about: [wire, from, to, before.from, before.to]`,
  `data.discuss.proposal = data.pending`) and **Undo** (restore `before`, clear `pending`).
- Studio's brief opens with **Proposed wire change**: the proposal in words and as yaml intent
  (`in plan.on, replace card-info.done with …`; `human.resume_on` for a resume wire; an end whose event is
  not picked yet lists what the source emits), and asks the session to review it with the person before
  editing files (`describeProposal` in `runtime/src/application/studio.ts`). A malformed `proposal` is
  ignored (the request is then an ordinary chat).
- Resolution happens on redraw: a pending wire whose `after` now exists in the drawing (same from/to/event),
  or whose `remove` is now gone from it, is replaced by the drawn state and loses `pending`; a pending wire
  the drawing does not explain yet is kept exactly as the person left it.

## 8. One studio per project, one session per board, and starting studio from the web

(Since docs/diagrams.md: a board holds several diagrams, so studio serves a project, not a workflow.)

### 8a. Sessions: one tab, a board session, forks while it is busy

- `awd studio --project <dir>` serves **every board of the project**: a board joins when its
  `meta.project.root` or `meta.workflow.file` is inside `<dir>` (boards are listed each pass; one that is
  not in the project is looked at again every 10 passes, so a board drawn later joins without a restart).
  `awd studio <workflow.yaml>` draws that board first and serves its repo. A board joins at its current seq —
  requests written before are history.
- **One Claude Code session per board**, named `awd-<board-scope>` (`boardScope` = the title's slug, ≤ 12
  chars, plus 4 chars of the board id). Every chat on the board goes to it while it is idle, so it keeps what
  it read and what was said — "where does this story come from?" does not start from zero.
- **A chat that arrives while the board session is working or blocked runs in a fork of it**:
  `claude --resume <board session id> --fork-session --session-id <new uuid>` in its own pane, named
  `awd-<scope>-f<n>`. The fork starts from the board's conversation (and its prompt cache), answers that
  chat, and is never given another one; its pane closes when idle like any other. Follow-ups in that chat
  come back to the fork (resumed by its own id when its pane was closed).
- **One herdr tab per project** (`studio: <project folder name>`); sessions are panes in it — the first is the
  tab's root pane, the rest are splits. At most `--max-sessions` panes (default 3) **across all boards of the
  project**. When full, a new session takes the place of the **least recently used idle** pane (never a
  `working` or `blocked` one); if none is idle the request **queues** (`agentState.state = 'queued'`,
  `position`), first in line first — a request that cannot get a pane holds back the ones behind it; a
  follow-up waiting on its own busy session does not.
- Every session is bound to a Claude Code session id at first open (`--session-id`); a session whose pane was
  closed (idle for `--idle-close`, default 30m, evicted, or closed by hand) is **parked** and reopened with
  `--resume <id>` by the next chat on its board (board session) or the next follow-up in its chat (fork).
- **New session**: the Studio control's "new session" (`POST /api/boards/:id/studio { action: 'new-session' }`)
  makes the canvas server stamp `meta.studio.newSessionAt`; studio sees a stamp it has not acted on, retires
  the board session (it finishes its chats, takes no new ones) and names the next one `awd-<scope>-g<n>`,
  started fresh. The canvas stays free of awd code: the stamp is the whole protocol. A stamp older than
  studio's first look at the board is ignored.
- `--warm` (off by default): when a board joins, open its session and prompt it once to read the board's
  design sources (`meta.workflow.file`, `meta.diagrams[*].source`, every frame's `data.diagram.source`) and
  reply READY — the first chat then starts informed.
- Receipts as §6: `starting → working → idle | blocked`, `queued` with `position`, `parked`; `pane` (1-based
  in the tab) for open sessions; `session` names the herdr agent answering the chat.
- Every follow-up goes through studio (§2): prompted to the chat's session when it is idle, held (per chat,
  in order, never forked) while it works, its session resumed first when parked.
- Order of a pass: find the project's boards → per board: a "new session" stamp, then requests and
  follow-ups → notice panes the person closed (gone from `herdr agent list` → parked) → mirror each open
  session's state (fresh states first, so an idle pane can make room) → close panes idle past
  `--idle-close` → give the queue panes → show queue positions → write `status.json`. A session prompted
  less than 10 s ago still counts as working (herdr can say idle before Claude has read the prompt).
- The model: the board session runs with the model of the chat that opened it; a later chat asking another
  model is still answered by it (a fork takes the model its chat asked for).
- Files, per project: `<repo>/.awd/studio/state.json` (`{ project, boards: { <id>: { seq, scope, gen, forks,
  resetAt?, warmed? } }, sessions, chats: { <root comment>: { session, req } }, queue }`) and `status.json`
  (`{ project, boards, open, max, queued, updatedAt }`); briefs per board under `<board-scope>/<key>.md`.
  A state file of another project (or of the older per-workflow layout) is ignored.
- The brief names the diagram(s) the selection is in — kind, key, level, source file and that kind's grammar —
  and the trace wires (`role: 'trace'`) between the selection and other diagrams; a board drawn from no
  workflow gets no workflow line, and each diagram source gets its own lint/redraw line (`awd design …`).
- herdr closes a tab with its last pane, so studio never closes tabs itself; the next session opens a new one.

### 8b. Starting studio from the web (the canvas server supervises)

The canvas server already runs on the owner's machine, so it starts and stops studio — but only for
projects **it was configured with**, never for a path taken from a board or a request:

```
canvas serve --port 4400 --dir boards \
  --studio-project /path/to/repo \
  --studio-cmd "node /path/to/awd/packages/cli/bin/awd.js studio --project {project}"
```

- `--studio-project` is repeatable; `--studio <workflow.yaml>` is still accepted and means that file's repo.
  Without `--studio-cmd` the command is this checkout's CLI by absolute path, so any project can use it.
- A `ProcessSupervisor` port in the canvas package (adapter: `child_process.spawn`, fake for tests), wired
  only in the canvas CLI composition root. The canvas never imports awd; `{project}` is the only substitution
  (`{file}` is accepted as its old spelling).
- A board is **studio-capable** when its `meta.project.root` or `meta.workflow.file` (absolute, real path)
  is inside one of the configured projects — a sibling folder with the same prefix is not. Anything else
  answers 403. Any board of the project shows the control, workflow or design board alike.
- API: `GET /api/boards/:id/studio` → `{ capable, project?, running, pid?, since?, log: string[] (last 50
  lines), sessions?: { open, max, queued, boards } }`; `POST /api/boards/:id/studio { action: 'start' |
  'stop' | 'new-session' }`. **One process per project**, whichever board pressed Start; start is idempotent;
  the child is stopped when the server stops; an exit is logged and shown (no auto-restart loop).
- `sessions` comes from `<project>/.awd/studio/status.json` (ignored when its `project` is another one).
- Web: the header of a studio-capable board shows a **Studio** control — `Off · Start` / `Starting…` /
  `On · 2/3 chats · Stop` / `Stopped: <last log line> · Start` — and a "new session" action.

## 9. Source dialog: a large view with syntax highlighting, edits become proposals

Every text view (Files tab, persona, prompt, script, a block's yaml range) has an **Expand** button that
opens a large dialog (≈ 90vw × 85vh) with a code editor (CodeMirror 6, loaded on demand): line numbers,
syntax highlighting by file type (`.yaml/.yml`, `.md`, `.sh`, `.py`, `.json`, `.ts/.js`; the prompt as
markdown), search (⌘F), light/dark themes from the app tokens.

**Script blocks** open it directly: the block on the canvas carries a `‹/› <file>` button (a double-click on
the block does the same), and the Inspector's Source section has **View** and **Edit** (Edit opens the dialog
in Edit mode). A step whose command names no file in the repo gets View / Edit on its Command instead: they
open the workflow yaml at the step's lines, so the command itself is what gets edited.

- **Read mode** (default): the same line comments as the panel — gutter markers, select lines (click /
  shift-click the gutter, or select text) → Comment / Ask AI; threads shown beside or under the line.
- **Edit mode**: the text becomes editable. Nothing is saved to disk from the web. **Ask AI to apply** posts
  a chat request whose `data.discuss.edit = { file | doc, base: <sha-1 of the snapshot text>, diff: <unified
  diff> }` (+ an optional note), `about: [<owning block>]`. Studio's brief shows the diff first and asks the
  session to review it with the person, apply it to the file (checking the file still matches `base`), lint,
  test and redraw. **Discard** drops the draft; the draft survives closing the dialog (per viewer, local
  storage) until sent or discarded.
- The dialog is keyboard accessible (focus trapped, Esc closes, ⌘Enter sends from a composer).

## 10. Proposals from other agents (remote agents)

An agent that cannot touch this repo — a cloud or laptop agent connected to the canvas through `/mcp` — proposes edits
on the board with `canvas_propose_edit` (docs/canvas.md → *Proposals and saving*): a comment carrying
`data.discuss.edit = { file, base, diff, by }`, checked by the canvas against the board's snapshot and signed with the
agent's name. Studio, which runs where the files are, is the default way such a proposal gets saved:

- **Pickup.** A new comment with `data.discuss.edit` added by a **named** agent (the change's `by`, from its token or
  `UNPROSE_AGENT_NAME`) whose name matches `edit.by` is a chat request (`agentProposals` in
  `runtime/src/application/studio.ts`), routed like the person's (board session, fork, queue). The default local agent
  signs nothing, so studio's own sessions never trigger themselves; a reply in a thread is talk, not a proposal. Studio
  now long-polls with `author=others`, so a remote agent's proposal wakes it at once.
- **The brief** opens with *Proposed edit — from <agent>, another agent*: who proposed it, the diff, and the steps —
  check the file still has the base (`shasum -a 1 <file>`; if not, `git apply --check`, else rebase by hand or ask the
  agent to propose again from the redrawn board); reply in the thread first (who proposed it, what it changes, what it
  touches) and ask the person; **apply only after the person agrees** — a reply from that agent or any other is not
  consent; then lint, test, redraw (clearing any dashed wire it drew) and answer "Applied to <file>". The agent's note
  appears as *<agent>'s note*; chat lines name agents (`codex-laptop (agent): …`).
- The person's answer (the **Agree** / **Decline** buttons post one) is a follow-up to the same chat (§2).

**Without studio** the person's own agent does the same: the unprose skill / AGENTS.md loop — `canvas_wait({ from:
'others' })` shows `[n <agent>] proposed an edit to <file> …`; read the diff from the comment (`canvas_read_board`,
`format: json`), discuss, and after the person agrees check the base, apply, lint, test, redraw and reply.

