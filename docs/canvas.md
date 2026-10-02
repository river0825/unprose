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
  src/remoteMcp.ts · designTools.ts   the same tools at /mcp for remote agents (design files as text)
  src/access*.ts · accessRoutes.ts    remote agents: tokens, OAuth 2.1, pairing codes, scopes (Remote agents below)
  src/proposals.ts · patch.ts         agents' edit proposals: the files snapshot, unified diffs checked against it (Proposals and saving)
  src/routing.ts                      several agents on one board: responder, @mentions, loop guard, context, file holders
  src/ports/feedbackStore.ts · adapters/feedback   what agents tell the owner about Unprose (unprose_feedback)
  src/cli.ts              awd-canvas serve | mcp | render | demo | outline | diff | card add|move|moves
  web/                    the React UI (built separately); web/src/run/ is the live run overlay
```

## Run it

```bash
npm install
npm run build -w @awd/canvas          # → packages/canvas/dist
node packages/canvas/dist/cli.js serve --port 4400   # http://localhost:4400 · boards in ~/.awd/boards
node packages/canvas/dist/cli.js demo  # seven sample boards (one per kind) drawn from the card-pipeline example
```

**Boards live in the project they belong to** (see [Projects](#projects)): a board made from a session or a design file of a project is stored in `<project>/.unprose/boards/`. Boards of no project — the **personal** space — are stored in `--dir`, else `$AWD_BOARDS_DIR` (the older `AWD_CANVAS_DIR` also works), else `$XDG_DATA_HOME/awd/boards`, else `~/.awd/boards` — never inside a checkout or plugin install by default, because a plugin reinstall replaces its directory (the server warns if `--dir` points into a `plugins/cache` folder, and a board whose save fails shows "Changes are not being saved" in the page). `AWD_CANVAS_URL` tells the MCP server / CLI where the server is (default `http://localhost:4400`). If `packages/canvas/web/dist` exists it is served at `/` and `/b/:id`; otherwise a plain page lists the boards.

Claude Code in a checkout of this repo gets the tools through the dev-only project `.mcp.json` (`node scripts/mcp.mjs`); the plugin declares the same server in `.claude-plugin/plugin.json`. The MCP server needs the HTTP server running — it does not own a store of its own, so the browser and the agent always see the same board.

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

The MCP server is called `unprose` (`node scripts/mcp.mjs`, which runs `awd mcp`; `awd-canvas mcp` serves the
canvas tools alone). Its instructions open with what Unprose is for, so an agent can explain it.

| Tool | Input | What it does |
|---|---|---|
| `unprose_help` | – | what Unprose can do — the diagrams, the tools, the comment loop, the ways to start — for the agent to pass on in the person's language; also the canvas URL and version |
| `canvas_list_boards` | – | id, kind, seq, item count, title, url per board |
| `canvas_create_board` | `title, kind, content, meta?` | render the template and create the board → id, url, seq |
| `canvas_read_board` | `id, format: outline\|json` | `outline` (default): compact text grouped by lane/frame with arrows and comments; `json`: raw items with ids and geometry |
| `canvas_apply` | `id, ops[], note?` | raw ops as the agent: `add {item}`, `update {id, patch}`, `remove {id}` |
| `canvas_add_items` | `id, kind?, content, at?, scope?, note?` | render a template onto an existing board; deterministic ids mean re-rendering the same content updates in place |
| `canvas_diff` | `id, since, from: person\|others\|all` (older spelling `author: user\|others\|agent\|all`) | human-readable lines for every change after `since` (`person`, the default: the person's changes from any of their pages; `others`: the person and the other agents, never you) |
| `canvas_wait` | `id, since, timeoutSec ≤ 120, quietSec = 2.5, wake = meaningful, from = person\|others, listen = mine\|all` | `from: person` (default) wakes on the person's changes — from any of their pages, a browser signed in through the tunnel included — and on another agent asking you; `from: others` also on the other agents' changes (never yours). Block until the user has changed something **and stopped for `quietSec`** (or pressed "Hand to agent"); returns the diff lines and new seq. Only what is for you wakes you — the board's responder, @mentions of you, another agent asking you, proposals to files you hold (`listen: 'all'`: everything); the first wait on a board starts with its context note ([Several agents on one board](#several-agents-on-one-board)). `wake: meaningful` (default) wakes on comments, adds, removals, renames, connections, recolours and handoff; pure moves / resizes / reroutes and read receipts neither wake nor restart the quiet window and come back folded into one `moved N items: …` line. `any` wakes on every change (one line each); `handoff` waits for the button only. While pending the board shows "agent is watching" |
| `canvas_focus` | `id, ids?, frame?, note?` | **"look here"**: use it whenever you ask the person to look at something. Their open page shows "Agent wants to show you …" with **Go** (or jumps at once with *Follow agent* on) and fits the view to the items / the diagram frame. Nothing is stored on the board. Returns how many pages got it and a link that opens right there (`?focus=` / `?frame=`) |
| `canvas_files` | `id, path?` | the files behind a board (a workflow's yaml, agents, prompts, scripts; a diagram frame's design file), as the last redraw put them on the board: each with its sha-1 `base`, line count and source; with `path`, that file's exact text. See [Proposals and saving](#proposals-and-saving) |
| `canvas_propose_edit` | `id, file, base, diff \| newText, note, about?, wires?` | propose a change to one of those files: checked against the snapshot whose sha-1 is `base`, then posted as a proposal signed with your name, threaded on the block / frame the first changed line belongs to (or `about`). `wires` (workflow boards): dashed hints for the wires the edit adds or removes. Nothing is written to disk |
| `canvas_context` | `id, text?, answeredBy?` | the board's context note (what it is about, links to notes), who answers it, who holds which files, the agents here; `text` writes the note, `answeredBy` (`me` \| a name \| `studio` \| `any`) sets the responder — both logged |
| `canvas_ask` | `id, agent, question, about?, timeoutSec ≤ 120` | ask another agent on the board (`agent`: its @handle or its name): posts an `@handle` thread (on `about[0]`, else loose) and blocks until it answers in the thread; the result says exactly who it was delivered to (*Delivered to @codex-b — watching this board now*, or that it is not watching / never seen); on timeout returns the thread id — the answer comes back to you with `canvas_wait` |
| `unprose_feedback` | `text, board?, about?` | tell the owner what was hard or missing in Unprose itself; kept on the canvas machine ([Feedback](#feedback-about-unprose)) |
| `unprose_feedback_list` | `limit?` | read that feedback — a local agent only |
| `canvas_open` | `id` | print the URL (and `open` it on macOS) |
| `design_lint` | `file` | `awd design lint`: schema, unknown fields, the EventStorming / Domain Storytelling grammar (with book pages) |
| `design_draw` | `file, board, at?, applied?` | `awd design draw`: draw or refresh the file's frame, keeping the person's layout; refuses a file with lint errors; returns the `?frame=` link; records you as the holder of the file; `applied` = the proposal thread this redraw applies ([Applying](#applying---applied-and-committing)) |
| `design_propose_stories` | `from, into, board` | `awd design propose-stories`: story candidates from EventStorming / a domain story as dashed proposals; the story-map file is not written |
| `design_egon` | `action: import\|export, file, out` | `awd design import-egon` / `export-egon` (Egon.io) |

Paths are relative to the session's project. The `design_*` tools are served by `awd mcp` (not by
`awd-canvas mcp`); the canvas's remote endpoint `/mcp` serves `design_lint` / `design_draw` / `design_propose_stories`
taking the file's text instead (see [Remote agents](#remote-agents)).

### Start prompts and slash commands

Eight ways to start a conversation, written once in `packages/cli/src/prompts.ts`: `help`, `eventstorm <topic>`,
`storymap`, `kanban`, `wireframe <page>`, `mockup <screen>`, `domain-story <topic>`, `review`. MCP clients (Codex and others) get
them as MCP prompts. The Claude Code plugin gets them as slash commands `/unprose:<name>` (`commands/*.md`,
written by `npm run gen:commands`; a test fails when they drift) and turns the MCP prompts off
(`UNPROSE_MCP_PROMPTS=0`) so the menu does not list them twice.

## Projects

One canvas server serves several projects — same port, same URL, same tunnel. A project is a directory
on the canvas's machine; its boards are stored in `<project>/.unprose/boards/`:

```
<project>/.unprose/
  .gitignore            # written once: boards/*.changes.ndjson, boards/*.tmp
  boards/<id>.json      # the board snapshot — commit it with the project
  boards/<id>.changes.ndjson   # the change log — local history, not committed
```

- **Registering a project:** `awd-canvas serve --project <dir>` (repeatable); the Claude Code plugin
  registers the session's project (`CLAUDE_PROJECT_DIR`, else the working directory, lifted to its git
  top level) at session start and when the MCP server starts; `awd design draw` / `awd graph --canvas`
  register the design or workflow file's project. The registry is kept in `<personal dir>/.projects.json`;
  a project's id is the slug of its directory name (`-2`, `-3` … on a clash).
- **Which folder is a file's project** (`repoRoot`, `packages/cli/src/graphCanvas.ts`): the nearest folder above
  the file with `.git` or `.unprose/boards`; else the nearest with a project file (`package.json`, `AGENTS.md`,
  `CLAUDE.md`, `pyproject.toml`, `go.mod`, `Cargo.toml`) below the home folder; else the working directory when the
  file is inside it; else the folder above `design/` (`designs/`, `diagrams/`); else the file's folder. A folder of
  design files alone (`~/meeting/design`) is never registered as a project called "design".
- **Removing a project:** `awd projects remove <dir | id>` (`DELETE /api/projects/:id`, this machine only, like
  registering) forgets it — its directory and files stay. Refused (`409`) while the project still stores boards;
  `--force` (`?force=1`) first moves them to the personal space (URLs unchanged). `awd projects list` shows them.
- **Boards by title** (`--board "title:…"`, `design_draw { board: "title:…" }`): the board with that title in the
  file's project, else in the personal space, else any board you can see (made on another machine, or before
  projects); an exact title before one differing only in case or spaces. Several equally good: the most recently
  changed, and a warning naming them all (pass the id to pick another). Only when there is none is a board created —
  by the canvas in the same step (`POST /api/boards { reuse: 'title' }`), so two draws at once share one board.
- **Only from this machine:** anything that names a directory — `POST /api/projects`, `projectRoot`, moving
  a board — is accepted only from a loopback caller without proxy/tunnel forwarding headers (the canvas
  names a directory only for the machine it runs on; a tunnel such as cloudflared connects from localhost but adds
  them, and a request with a token is never local). Creating and reading boards in an already registered project
  works from anywhere, like every other board operation — with credentials ([Remote agents](#remote-agents)).
- **Board ids and URLs never change** (`/b/<id>`); the server knows which project stores which board. The
  board list groups boards by project, with a filter that remembers your last choice.
- **The agent's defaults:** `canvas_create_board` stores new boards in the session's project
  (`project: 'personal'` for none); `canvas_list_boards` lists the session's project (`all: true` for every
  project). A remote canvas (`AWD_CANVAS_URL` on another machine) cannot write into your project, so boards
  made through it stay in its personal space.
- **Committing boards:** the snapshots are pretty-printed JSON with a final newline, so they diff well.
  A clone has the snapshots but not the logs: the board opens and keeps working (its history starts over).
  Two people editing the same board in different clones will merge-conflict on the snapshot like on any
  file — the design files (`design/*.yaml`) stay the source of truth, the board adds layout and discussion.
- **Migrating older boards:** boards made before projects stay in the personal space and keep working
  (a title lookup still finds them). Move one into a project with
  `awd boards move <board id | title:…> --to <project dir>` — the snapshot and the log are copied first,
  and the old files are removed only after the copy is in place.

## Remote agents

Agents on other machines (Claude Code, Codex or Cursor on a laptop) and cloud agents (claude.ai custom
connectors, ChatGPT connectors, cloud Codex / Claude Code) can design with you on this canvas. The canvas serves
MCP itself at **`<canvas>/mcp`** (Streamable HTTP), so an agent needs nothing installed — just the address,
e.g. `https://canvas.example.com/mcp` through your tunnel. How each client connects: [agents-setup.md →
Remote agents](agents-setup.md#remote-agents-another-machine-or-the-cloud).

### Who gets in

| Caller | Needs | Gets |
|---|---|---|
| this machine — loopback, no forwarding headers (`X-Forwarded-For`, `CF-Connecting-IP` …), no token | nothing (unchanged) | everything, including the local-only actions (registering projects, moving boards, upgrading) |
| an agent with a token (`Authorization: Bearer …`), from anywhere — **also from this machine** | a token: made on the **Connected agents** page, or issued by OAuth / a pairing code | what the token allows (read or write, all or some projects / boards); writes are signed with its name; never the local-only actions |
| a browser elsewhere (the tunnel, the LAN) | signing in once: a pairing code approved on the canvas, or a pasted token | a session cookie (`HttpOnly`, `SameSite=Strict`, `Secure` on https) with the scope it was given. It is **the person**: its changes are the person's (`author: 'user'`, unnamed), so they wake agents waiting for the person |
| anyone else from elsewhere | — | `401` with `WWW-Authenticate: Bearer resource_metadata=…` and a sentence saying how to connect |

A cloudflared tunnel connects from loopback but adds its headers, so it is **not** local. The rule for "local" is
`isLocalRequest()` in `src/projectsApi.ts` (loopback address, no forwarding headers, no `Authorization`).
Public without credentials: the web UI's files, `/docs`, `GET /api/version`, `GET /api/kinds`, the OAuth
endpoints and the sign-in endpoints below.

`UNPROSE_REMOTE_AUTH=off` brings back the old open canvas (anyone who reaches it reads and writes) — only for a
canvas that already sits behind an access proxy that does the job. Local-only actions stay local either way.

### Connecting an agent

- **OAuth 2.1 (claude.ai, Claude Code `--transport http`, most remote MCP clients).** The client calls `/mcp`, gets
  `401`, reads `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`, registers
  itself (`POST /register`, dynamic client registration, public client + PKCE S256) and opens `/authorize` in the
  person's browser. That page names the client and where it returns to, and shows a **one-time pairing code**
  (`ABCD-EFGH`). At the same moment **every open canvas page that may approve** (below) shows
  **“<client> wants to connect”** with a box for the code, **Allow** and **Deny**. Typing the code proves the person
  is looking at that agent. On a page opened on the canvas machine (`http://localhost…`), Allow works with one
  click (no code needed). After Allow, the authorize page sends the browser back to the client with a single-use
  authorization code (10 minutes); `POST /token` exchanges it (`authorization_code` + PKCE verifier) for an access
  token (1 hour) and a refresh token (rotated on every use). The agent appears in **Connected agents**, revocable.
- **An agent without a browser** (the stdio MCP server pointed at the tunnel, a headless cloud agent): the device
  flow, RFC 8628. `POST /device_authorization` (`client_name=<name>`) returns a `user_code` (the pairing code) and a
  `device_code`; the agent tells the person the code; the person types it on the canvas (the notification, or
  **Connected agents → Enter a code**); the agent polls `POST /token` with
  `grant_type=urn:ietf:params:oauth:grant-type:device_code` and gets a token (no expiry, revocable). The stdio MCP
  server (`scripts/mcp.mjs`) does this by itself when `AWD_CANVAS_URL` answers `401` and it has no token: every tool
  result says *“Ask the person to type the code ABCD-EFGH on the canvas …”* until it is approved, then it keeps the
  token in `~/.awd/tokens.json` (0600; `UNPROSE_TOKENS_FILE` moves it) for next time.
- **A token made on the page** (clients that can send a header): **Connected agents → New token** — a name, read or
  read-and-draw, optionally only some projects or boards. The secret is shown **once**, with ready-to-paste setup
  for Claude Code, Codex, a JSON config and the stdio server.

### Who may approve and manage

- **Approve a connect request:** a page on the canvas machine (opened as `localhost`, same origin) — one click; or a
  **signed-in** page anywhere (a browser session) — only with the requester's pairing code. A session can grant at
  most its own scope and projects. **Five wrong codes lock the request** (the agent has to start again); codes typed
  without picking a request are limited to ten wrong ones per ten minutes per approver.
- **Create and revoke tokens:** a page on the canvas machine, or a browser session that a page on the canvas machine
  approved with *“may also manage agents and tokens”*. A page that can merely load through the tunnel can do none of
  this; agent tokens can neither approve nor list agents.
- **Signing a browser in from elsewhere:** the page shows *“Ask to be let in”* — it gets a pairing code; type it on a
  page on the canvas machine or on a page that is already signed in (one click on the canvas machine works too).
  Or paste a token made on the agents page. A person who only ever reaches the canvas through the tunnel makes one
  token (or approves the first browser) while at the machine, once.

### Safety details

- Tokens, refresh tokens, session secrets and authorization codes are random 256-bit secrets; only their sha-256 is
  stored, in **`~/.awd/agents.json`** (mode 0600, directory 0700; `--agents-file` / `UNPROSE_AGENTS_FILE` moves it,
  `XDG_DATA_HOME` is honoured) — never in a board, a project or a log. Lookups compare hashes in constant time.
  Pages never receive a hash; a secret is shown once, when it is made.
- Pending requests expire after 10 minutes; at most 3 waiting per address and 20 in all; client registrations are
  limited to 20 per address per hour. Approving pages never receive the pairing code.
- Cross-site protection: the approve / manage API refuses requests whose `Origin` is not the canvas itself or whose
  `Sec-Fetch-Site` is cross-site; one-click approval also requires a loopback `Host` (no DNS rebinding). The
  authorize page sends `X-Frame-Options: DENY` and a nonce-based Content-Security-Policy.
- Redirect URIs must be `https`, or `http` to `localhost` (native apps). Only `response_type=code` with
  `code_challenge_method=S256`.
- `UNPROSE_PUBLIC_URL=https://canvas.example.com` fixes the address the canvas tells agents (OAuth issuer, metadata,
  board links); without it the request's `X-Forwarded-Proto` / `X-Forwarded-Host` / `Host` are used.

### What a remote agent sees

The same tools as the stdio server (`canvas_*`, `unprose_help`) plus `design_lint`, `design_draw` and
`design_propose_stories` that take the file's text (`content`) and its file name (`name`, e.g. `checkout.es.yaml`)
instead of a path — the canvas cannot read the agent's files; the agent keeps the file as the truth on its side.
`design_egon` (writes files) and workflow files (`awd graph`) stay with the local tools. To change a file behind a board (a workflow's yaml, a design file drawn from the person's machine) a remote agent proposes: `canvas_files` → `canvas_propose_edit` ([Proposals and saving](#proposals-and-saving)). The start prompts
(`eventstorm`, `storymap` …) are MCP prompts. New boards are not opened in a browser on the canvas machine: the
tool returns the link to give the person. `/mcp` is stateless (each POST stands alone; nothing is lost on a restart)
and streams with keep-alives, so a `canvas_wait` of up to 120 s survives proxies.

### Identity: who did what

- Every change made with a token carries `by: <agent name>` (`Change.by`); diff lines read `[7 codex-laptop] …`,
  and the change feed shows the name. A token always writes as `author: 'agent'` — it cannot pose as the person.
- A signed-in browser (a pairing code, or a pasted token, let it in) is the person, wherever it is: its changes are
  `author: 'user'` without a name (`[7 user] …`), exactly like a page on the canvas machine — they wake
  `canvas_wait({ from: 'person' })` and studio, and count as the person's word. It cannot write as an agent.
- A local agent stays the default `agent`; set **`UNPROSE_AGENT_NAME=<name>`** for its MCP server or CLI to sign
  its changes (sent as `X-Unprose-Agent`, honoured only from this machine).
- Presence names who is waiting: the board header says *“codex-laptop is watching”* (`presence.agents`).
- Read receipts are per agent: `data.seenByAgents` lists the agents that read a comment (`data.seenBy` keeps the
  roles). `canvas_wait` and `canvas_diff` work from each agent's own `since`, so two agents never consume each
  other's events; `canvas_wait({ from: 'others' })` / `canvas_diff({ author: 'others' })` / `?author=others` also
  return the other agents' changes — never your own.

### Scopes

A token limited to projects sees only those projects' boards in `canvas_list_boards` / `GET /api/boards` /
`GET /api/projects`, gets `403` on any other board (HTTP and WebSocket), and creates new boards in its first
project; a token limited to boards sees only those and cannot create boards. A read-only token reads, waits and
diffs but gets `403` on every write (ops, cards, focus, board create / update / delete). Agent tokens never start or
stop Studio.

### Migrating a canvas you use through a tunnel

After updating, requests through the tunnel need credentials; on the canvas machine nothing changes.

1. **Your browser through the tunnel** shows a sign-in page. Choose *Ask to be let in* and type the code on a page
   at `http://localhost:4400` (or click Allow there) — once per browser. Away from the machine: make a token on
   `http://localhost:4400/agents` beforehand and paste it into *Use an access token*.
2. **Agents that used `AWD_CANVAS_URL=https://<tunnel>`** without a token now get `401`. The stdio MCP server asks
   for a pairing code by itself (the code shows in its tool results); or make a token and set `UNPROSE_TOKEN`; or
   switch the agent to the remote endpoint `https://<tunnel>/mcp` (OAuth). `awd design draw --canvas https://…` and
   the other CLI commands send `UNPROSE_TOKEN` too.
3. **Scripts of your own** (curl, Python …) calling the canvas through a Cloudflare tunnel must send a `User-Agent`:
   Cloudflare answers requests without one, or with a script's default one (`Python-urllib/3.x`), with a `403` before
   they reach the canvas. Every Unprose client sends `User-Agent: unprose/<version> (<component>)`; the canvas's own
   `401` says so when a request had no User-Agent or a script's default one.
4. **Cloudflare Access in front?** Keep it if you like; add bypass rules for the paths agents use (`/mcp`,
   `/.well-known/*`, `/register`, `/authorize*`, `/token`, `/revoke`, `/device_authorization`) — agents cannot do a
   Cloudflare login — and let the canvas's own tokens protect them. Or keep only Cloudflare Access and set
   `UNPROSE_REMOTE_AUTH=off` (the old behaviour; remote agents then connect without approval).
5. Set `UNPROSE_PUBLIC_URL=https://<tunnel>` on the canvas so the setup lines on the agents page and the OAuth
   metadata use the tunnel address even when you open the page on `localhost`.

## Proposals and saving

Files are the truth; the board is their projection, and **the canvas never writes a file**. An agent that cannot write
the files behind a board — a remote agent through `/mcp` (the canvas is not on its machine), or any other agent on the
board — changes them by **proposing**; the agent that has the files saves them.

**Who can propose.** Any caller with write access to the board: an agent token with the *read and draw* scope (limited
to its projects / boards), a local agent, the person. A read-only token reads the files (`canvas_files`) but gets `403`
on a proposal. A proposal made with a token is signed with the token's name — the server stamps `data.by` and
`data.discuss.edit.by` on every new comment, from the credentials, so no caller can sign with another's name.

**What a proposal is.** `canvas_propose_edit` (`POST /api/boards/:id/proposals`) takes one file of the snapshot
(`meta.workflow.files`, `meta.diagrams[key].files`), its sha-1 `base`, and either a unified diff or the whole new text.
The canvas checks, without parsing yaml:

- the file is in the board's snapshot, and not cut short there (`meta.workflow.truncated`);
- `base` is the sha-1 of the snapshot text (else `409`: the file was redrawn since — read it again);
- the diff names that file (if it names one), every hunk's context and removed lines are in the text exactly (a hunk
  may sit some lines from where its header says, like `patch`; no fuzz), and it changes something (else `422` with
  the hunk that failed). The pure diff code is `src/patch.ts` (shared with the web's source dialog).

It then adds the same chat request the person's source-dialog edit makes (docs/studio.md §9): a comment with
`data.discuss.edit = { file, base, diff, by }` (the diff normalised against the snapshot), `data.anchor` on the first
changed line, threaded on the item that owns that line (the block whose file it is, the step whose yaml lines hold it,
the diagram frame drawn from the file, else the title) or on `about`. Optional `wires` (workflow boards, between
blocks already drawn) add dashed proposed wires — `data.pending = { kind: 'add' | 'remove', …, by: <agent>, proposal:
<comment id> }`, the mechanism of docs/studio.md §7 — which the next redraw resolves once the applied file has them;
the yaml change itself must be in the diff. The Chat shows the proposal: file, `+n −m`, who proposed it, the diff,
**Agree** / **Decline** (they post a reply in the thread).

**Saving: whoever has the files applies it, after the person agrees.**

1. The person discusses it in the thread (the proposing agent can follow with `canvas_wait({ from: 'person' })` and
   answer there).
2. The agent on the machine with the repo applies it: **studio's session** when studio runs for the project (a named
   agent's proposal opens a chat like the person's request — docs/studio.md §10), otherwise **the person's own local
   agent** (Claude Code with the unprose tools sees it with `canvas_wait({ from: 'others' })` / `canvas_diff({ author:
   'others' })`: `[12 codex-laptop] proposed an edit to workflow.yaml (+1 −1 lines) on …`; the diff is in the comment's
   `data.discuss.edit`, `canvas_read_board` with `format: json`).
3. It applies only after the **person** says yes in the thread (another agent's reply is not consent), checks the file
   still has the `base` sha-1 (`shasum -a 1 <file>`; if not, `git apply --check`, else rebase by hand or ask the
   proposer to propose again), applies, lints, tests, redraws with `--applied <thread id>` (`awd graph … --canvas` /
   `awd design draw`), which answers "Applied to <file>" in the thread. Nothing is committed unless the holder's own
   environment says `UNPROSE_APPLY_COMMIT=1` ([Applying](#applying---applied-and-committing)).

With several agents on the board the proposal goes to the **holder** of the file — the agent that drew it from its
files — and wakes it, whoever answers the board ([Several agents on one board](#several-agents-on-one-board)).

A later option, not built: proposals as a git branch / pull request.

## Several agents on one board

One board, several agents: Claude on the canvas machine (studio, or a local session), Codex on a laptop with the
files in its own repo, a cloud agent. Without rules every agent would pick up every comment — including the ones
meant for another agent that has the context. Four things sort it out, all kept on the board (pure rules in
`src/routing.ts`, shared by the server, the MCP tools and the web UI):

| | What | Where it lives |
|---|---|---|
| **Answered by** | who answers the person's comments on this board: one agent by name, *studio* (this machine's default agent), *any agent*, or the default (as before: studio and any agent) | `meta.responder = { mode: 'agent' \| 'studio' \| 'any', agent?, by, at }` |
| **@mentions** | `@codex-b` in a comment sends that thread to that agent, whoever answers the board | `data.mention` on the comment |
| **Context** | a short markdown note on what the board is about — the meeting, decisions, links to the notes — that every agent gets first | `meta.context = { text, by, at }` |
| **File holder** | who drew each diagram from which files: agent, machine, repo, git remote; proposals on a diagram go to its holder | `meta.diagrams[key].holder`, `meta.workflow.holder` |

### Names

An agent is known by its name: a token's or OAuth client's name, or `UNPROSE_AGENT_NAME` for a local agent (sent as
`X-Unprose-Agent`, honoured only from this machine). The default local agent — studio, or a local session without a
name — is `agent`; people write it `@studio` and the UI shows *studio*. Pick short names that say which agent on
which machine: **`codex-b`**, **`claude-a`**, `cursor-laptop`.

- **Rename** an agent on **Connected agents → Rename** (`PATCH /api/access/agents/:id { name }`, a page on the canvas
  machine or one allowed to manage agents). Its changes are signed with the new name from then on (earlier ones keep
  the old one); boards whose *Answered by* or file holders named it follow (logged as `renamed agent A → B`). Names
  are unique; `agent`, `user`, `studio`, `any`, `me` are taken.
- **Handles.** Every agent is mentioned by its handle: its name as one word — lower case, spaces and signs as `-`
  (`agent on Acme-Robins-MacBook-Pro` → `@agent-on-acme-robins-macbook-pro`; studio is `@studio`).
  `@handle` and the exact name both work in comments and in `canvas_ask`; the handle shows in the agents list
  (**Connected agents**, `canvas_context`, `GET …/settings` → `agents[].handle`), in the @ autocomplete (which inserts
  it) and on chips. Names are unique by handle (a second "codex b" next to "codex-b" becomes "codex b-2"). The person's
  message says who it went to (*You → @codex-b*).
- The device flow names the token after `UNPROSE_AGENT_NAME`, else `<client>-<short host>` — the MCP client and
  this machine, one word (`codex-acme-robins-mbp`; tokens paired before keep their `agent on <hostname>` name).
  Rename it, or set `UNPROSE_AGENT_NAME=codex-b` before the first pairing. A token always writes as its own name (it
  cannot take another); `UNPROSE_AGENT_NAME` names a local agent that has no token.
- **One credential for every tool.** The stdio MCP server, the design tools it runs (`design_draw` …) and the `awd`
  CLI (`design draw`, `graph --canvas`, `boards move`, `projects`) all send the same token for the same canvas:
  `UNPROSE_TOKEN`, else the token a pairing code got for that canvas (`~/.awd/tokens.json`, `UNPROSE_TOKENS_FILE`;
  a board link or a trailing slash names the same canvas), else `UNPROSE_AGENT_NAME` for a local canvas. The MCP
  server puts the token it holds (also one it just paired) into its own `UNPROSE_TOKEN`, so the design tools and any
  `awd` it starts use it even when `~/.awd` cannot be written (a sandbox).

### Who a comment is for

The canvas stamps every new comment (and a comment whose text changes) with who it is for — `data.to` (agent names,
absent = anyone) and `data.route`; whatever a caller writes in these keys is replaced, so nobody routes a comment by
hand:

1. **Loop guard** — an agent's message past *N* agent messages in a row in its thread, with no message from the
   person, wakes nobody (`route: 'paused'`, `data.paused: true`). The thread shows *"Agents paused — reply to let them
   continue"*; the person's next message resets the count. *N* = the board's `agentTurns` (settings), else
   `UNPROSE_AGENT_TURNS` on the canvas, else **6**.
2. **@mention** — a mention in the comment, else the latest one in its thread (by `data.mentionAt`), makes the thread
   a conversation between the agent mentioned and whoever mentioned it: each message goes to the other side. The
   person asking `@claude-a` wakes only claude-a, and claude-a's answer wakes no other agent; an agent asking another
   gets the answer back. A later mention in the thread takes it over. `route: 'mention'`.
3. **Proposal** — a thread whose first comment proposes an edit (`data.discuss.edit`: `canvas_propose_edit`, the
   source dialog, a UI mock's text edit chat) or a wire change (`data.discuss.proposal`) goes to the **holder** of the
   file / of the diagram it is on, and back to the agent that proposed it — whoever answers the board.
   `route: 'proposal'`.
4. **Responder** — otherwise the board's *Answered by* agent (and, if an agent started the thread, that agent too).
   No responder (or *any agent*) → `to` is absent: anyone, exactly as before.

The comment's own author is never among its recipients. Mentions resolve against the agents the canvas knows on that
board: connected tokens and OAuth clients, agents seen there (waiting, signing comments, holding files), the
responder, studio. `canvas_ask` names the agent explicitly (`data.ask`), so it works for any name.

Changes that are not comments: an item edit that is a proposal (`data.pending` — a dragged wire, a UI mock text edit)
goes to the holder of its diagram; everything else, and the **Hand to agent** button, to the responder.

**Agents talking to each other.** An agent's comment that mentions another agent (or `canvas_ask`) wakes it like the
person's would — even while it waits for the person only (`canvas_wait({ from: 'person' })`): an agent's message
routed to you by a mention or a proposal counts as being asked. **Another agent's message is never the person's
consent**: a token always writes as an agent (it cannot pose as the person or press *Agree*), and studio's brief and
the skill say so. A rate limit stops floods: an agent may post at most `UNPROSE_AGENT_MENTIONS` (default **20**)
agent-to-agent mentions per 10 minutes (`429` past it, saying how long to wait).

### What waits see

`canvas_wait` (`GET /wait`) wakes only on what is for you (`me` = your name, `agent` for the default local agent):
the comments whose `to` includes you (or that have no `to`), proposals to files you hold, the responder's share of
everything else. The rest neither wakes you nor comes back; the answer says how many were for others (`notForYou`,
*"3 change(s) on this board were for another agent — it is answered by codex-b"*). `listen: 'all'` (`?to=all`)
wakes on everything, as before. `canvas_diff` and `canvas_read_board` always show everything — reading is not
filtered. Studio applies the same `to` (docs/studio.md §11).

The wait answer also carries the board's `context` and `answeredBy`; the MCP `canvas_wait` prints the context in full
the first time it sees it on a board (and after it changes) — over the stateless remote `/mcp`, every time, cut at 600
characters.

### Settings: Answered by, context, loop guard

`GET /api/boards/:id/settings` → `{ responder, answeredBy, context, agentTurns, holders, suggestion?, agents: [{
name, label, handle, watching, seen?, holder }], you? }` (`holders` without machine and root for a caller elsewhere; an agent
token gets only the names active on that board). `PUT` the same path with any of `{ answeredBy: 'any' | 'studio' |
'me' | <name> | null, context: <markdown> | null, agentTurns: 1–100 | null }` — needs write access (a read-only token
gets `403`). Each change is **logged**: a change with no ops, `note` (*set "Answered by" to codex-b; updated the board
context*) and `meta` (the keys set), so it shows in the change feed and the diff, and open pages update at once. A
`PUT` / `PATCH /api/boards/:id` of the meta (a redraw) never changes them. The context is at most 4 000 characters — link
to longer notes.

In the UI: the board header's **Answered by** menu (studio & any agent · any agent · studio · each known agent, marked
*holds files* / *here*), a **Use codex-b?** suggestion when no responder is set and one agent holds every diagram's
files (a suggestion only — existing boards keep their behaviour), and, when the responder has not waited on the board
for a minute, **"codex-b is away — your comments wait for it"** (from `presence.seen`). The **Context** note is at the
top of the side panel (collapsible per viewer, links clickable, *Edit*). Agents read and write it with
`canvas_context { id, text?, answeredBy? }`; it opens studio's briefs and `canvas_read_board`'s outline.

### File holders

`awd design draw`, `awd graph --canvas` and `design_draw` (local, with a path) send, with the files snapshot, where
the files live: `{ machine: <hostname>, root: <repo root>, repo: <folder name>, remote: <git remote get-url origin,
credentials removed> }` — so each diagram carries its own project root (`meta.diagrams[key].holder.root`). The
board-level `meta.project.root` is only the default for a board drawn from one machine: `awd design draw` sets it
when the board has none and never overwrites another machine's. Every writer merges its keys with `PATCH
/api/boards/:id` (one diagram's entry, or `workflow`), so two machines drawing in turn keep each other's entries. The canvas stamps `agent` (the caller's name, from its credentials) and `at`; a holder sent
unchanged from what the caller read (same `agent` and `at`) keeps the stored one, so nobody can record another agent
as a holder. The remote `design_draw` (file text) records the caller with no paths. **Machine and root are shown only
to callers on the canvas machine** (`GET /api/boards…`, the board socket, settings) — like other paths.

The frame panel shows **"Files: team-notes · held by codex-b · last applied 3 min ago"** and, below, the git
remote and (on the canvas machine) *on mbp-b (…/src/team-notes)*. `canvas_read_board`'s outline lists each
diagram's holder (no paths).

**A board an agent draws from its files is answered by it**: when `awd design draw` / `graph --canvas` / `design_draw`
create the board (`POST /api/boards { answeredBy: 'me' }`), a *named* agent becomes its responder. The default local
agent leaves the default. Boards that exist are never changed — the UI only suggests.

### Applying: `--applied`, and committing

The holder applies a proposal after the **person** agrees in the thread (the brief / skill rules: check the base
sha-1, apply, lint, test), then redraws with **`--applied <thread id>`**:

```bash
awd design draw design/signup.es.yaml --board <board> --applied prop_8k2…    # MCP: design_draw { …, applied }
awd graph workflow.yaml --canvas --applied prop_8k2…
```

It redraws, records `holder.applied` / `appliedAt` (*last applied …*), and answers **"Applied to
design/signup.es.yaml"** in the thread. Only when the holder's **own environment** says so — never from the canvas —
it also commits:

| Env (on the holder's machine) | Effect |
|---|---|
| `UNPROSE_APPLY_COMMIT=1` | `git commit -- <the file>` in the file's repo, message `Apply canvas proposal to <file>`, the proposal's first line, *Proposed by <agent>; agreed by the person in <board link ?focus=thread>*; the reply says `committed <sha>` |
| `UNPROSE_APPLY_PUSH=1` (with the above) | then `git push`; a failure is reported in the output, not fatal |

**Recommended multi-machine setup**: keep the design files in a git repo; the agent that drew them holds them; it
applies agreed proposals with `--applied` and `UNPROSE_APPLY_COMMIT=1 UNPROSE_APPLY_PUSH=1`; other machines pull.
Worked example: [agents-setup.md → Two machines, one board](agents-setup.md#two-machines-one-board).

### Feedback about Unprose

Agents tell the owner what got in their way: `unprose_feedback { text, board?, about? }` (`POST /api/feedback`, any
caller with credentials, also read-only; at most 30 per 10 minutes per name) appends `{ id, at, by, via, text, board?,
about? }` to `feedback.ndjson` next to the agents file (`~/.awd/feedback.ndjson`, 0600; `UNPROSE_FEEDBACK_FILE`
moves it) — never into a project or a board. Read it on **Connected agents → Feedback from agents** (a page on the
canvas machine or one allowed to manage agents; `GET /api/access/feedback`), or with `unprose_feedback_list` /
`GET /api/feedback` from a local agent (tokens get `403`).

## HTTP API

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/boards` | `?project=<id>` | `{ boards: [{ id, title, kind, seq, items, project, … }] }` — only that project's boards with `project` |
| POST | `/api/boards` | `{ title, kind, content? \| items?, meta?, author?, project?, projectRoot?, answeredBy?, reuse? }` | `201 { board, project }` — `content` is rendered with the kind's template; stored in `project` (an id; `personal` by default) or, from this machine, `projectRoot` (registered on the fly). `reuse: 'title'` (or `'title+kind'`): when a board with that title is visible (the project, then personal, then any), `200 { board, project, reused: true, where, ambiguous? }` instead of a new one |
| GET | `/api/projects` | | `{ projects: [{ id, name, personal, boards, root? }] }` — `root` only for a caller on this machine |
| POST | `/api/projects` | `{ root }` | `{ project }` — register (or find) a project; this machine only (`403` otherwise) |
| DELETE | `/api/projects/:id` | `?force=1` | `{ removed, moved }` — forget a project (its files stay); `409` while it stores boards unless `force` (they move to personal); this machine only |
| POST | `/api/boards/:id/move` | `{ project } \| { projectRoot }` | `{ board, project }` — move the snapshot and log into that project; this machine only |
| GET | `/api/boards/:id` | | `{ board }` |
| PUT | `/api/boards/:id` | `{ title?, meta? }` | `{ board }` — replaces meta whole (older clients; prefer PATCH) |
| PATCH | `/api/boards/:id` | `{ title?, meta? }` | `{ board }` — merges: each top-level meta key given replaces that key (`null` removes it); `meta.diagrams` merges per diagram key (an entry replaces that diagram's, `null` removes it). Settings keys are ignored (they change through `/settings`); holders are stamped from the caller |
| DELETE | `/api/boards/:id` | | `{ deleted }` |
| POST | `/api/boards/:id/ops` | `{ author: 'agent'\|'user', ops: Op[], note? }` | `{ seq, change }` (atomic batch) |
| GET | `/api/boards/:id/changes` | `?since=N&author=` | `{ changes: Change[], seq }` |
| GET | `/api/boards/:id/diff` | `?since=N&author=` | `{ lines: string[], count, seq }` |
| POST | `/api/boards/:id/focus` | `{ ids?: string[], frame?: <diagram key>, note?, author? = 'agent' }` | broadcasts `{ type: 'focus', ids, frame?, note?, author, at }` to the board's open pages (a frame key resolves to its frame item; a legacy board's own kind means the whole board). Not a board change: nothing is stored or diffed. `{ ok, viewers, focus }`; 404 for unknown items / frames |
| GET | `/api/boards/:id/wait` | `?since=N&timeout=ms&author=&quiet=ms&wake=meaningful\|any\|handoff&to=all` | long-poll; resolves `quiet` ms (default 2500) after the last waking change (see `canvas_wait`), or at once on a change whose `note` is `handoff`; `{ timedOut, changes, lines, seq, notForYou, answeredBy, responder, context }` — only changes for the caller unless `to=all` ([Several agents on one board](#what-waits-see)). `diff` and `wait` record `data.seenBy: ['agent']` on the user comments they return |
| GET/PUT | `/api/boards/:id/settings` | PUT `{ answeredBy?, context?, agentTurns?, author? }` | `{ responder, answeredBy, context, agentTurns, holders, suggestion?, agents: [{ name, label, handle, watching, seen?, holder }], you?, seq? }`; a PUT is a logged change (`403` read-only) |
| POST/GET | `/api/feedback` | `{ text, board?, about? }` | `201 { ok, id }` · `{ feedback }` (GET: this machine or a manage page only) |
| GET | `/api/boards/:id/files` | `?path=` | `{ files: [{ path, sha, truncated, from, size, lines }] }`; with `path`: `{ file: { path, sha, truncated, from, text } }` — the files snapshot ([Proposals and saving](#proposals-and-saving)) |
| POST | `/api/boards/:id/proposals` | `{ file, base, diff? \| newText?, note, about?: string[], wires?: [{ from, to, event, condition?, remove? }], author? }` | `201 { seq, comment, file, diff, about, added, removed, offsets }`; `404` unknown file / item / block, `409` stale `base`, `422` a diff that does not apply or a file cut short on the board, `403` read-only / out of scope |
| GET | `/api/boards/:id/thumb.svg` | | SVG thumbnail of the board (used by the board list) |
| GET | `/api/boards/:id/outline` | | `text/plain` outline |
| POST | `/api/boards/:id/template` | `{ kind?, content, at?, scope?, frame?: { key, title?, source?, level?, at? } }` | `{ items, ops }` — rendered but **not** applied. With `frame`, drawn inside the diagram frame `diagram.<key>` (created if missing; an existing frame keeps its geometry), ids `<key>.<role>.<element id>`; trace links become dotted `trace` wires when their target is on the board |
| GET | `/api/boards/:id/studio` | | `{ capable, running, pid?, since?, exitedAt?, exitCode?, log: string[] (last 50), sessions?: { open, max, queued } }` — `capable: false` unless the board's `meta.workflow.file` is one of the server's `--studio` files |
| POST | `/api/boards/:id/studio` | `{ action: 'start' \| 'stop' }` | same shape; `403` for a board that is not studio-capable, `400` for another action. Start is idempotent; one child per workflow; no auto-restart |
| GET | `/api/kinds` | | `{ kinds }` |
| GET | `/api/update` | `?refresh=1` | `{ current, latest?, available, notes?, url?, checkedAt, source, error?, install: 'plugin'\|'checkout'\|'bundle'\|'unknown', supported, canUpgrade, reason?, command, throttled?, followsPluginUpdate? }` — the newest GitHub release (cached 6 h, errors 30 min); `refresh=1` checks again unless the previous check is under 30 s old (then `throttled: true` and that check); `canUpgrade` only for a page on this machine |
| POST | `/api/update` | | `202 { started, version }` — upgrade and restart on the new version (see "Updating"); `403` unless the caller is on this machine, `409 { error }` when it cannot start (up to date, dirty checkout, unsupported install) |
| GET | `/api/update/status` | | `{ running, phase?, message?, version?, log: string[] }` — the current or last upgrade job |
| POST | `/mcp` | MCP JSON-RPC (Streamable HTTP, stateless) | the MCP tools as the caller (see [Remote agents](#remote-agents)); `401` + `WWW-Authenticate` without credentials from elsewhere |
| GET | `/.well-known/oauth-protected-resource[/mcp]` · `/.well-known/oauth-authorization-server` | | RFC 9728 / RFC 8414 metadata |
| POST | `/register` | `{ client_name, redirect_uris }` | `201 { client_id, … }` — dynamic client registration (public clients, PKCE) |
| GET | `/authorize` | `response_type=code, client_id, redirect_uri, code_challenge, code_challenge_method=S256, state, scope?` | the approve-on-connect page (pairing code; one click on the canvas machine); `GET /authorize/status?id=` → `{ status, redirect? }` |
| POST | `/token` | form: `grant_type=authorization_code \| refresh_token \| urn:ietf:params:oauth:grant-type:device_code`, … | `{ access_token, token_type, expires_in?, refresh_token?, scope }` |
| POST | `/device_authorization` · `/revoke` | form: `client_name` · `token` | `{ device_code, user_code, verification_uri, expires_in, interval }` · `200` |
| GET | `/api/access/me` | | `{ grant, signedIn, local, remoteAuth, canApprove, canManage, oneClick, publicUrl }` |
| POST/GET | `/api/access/signin` · `/api/access/signin/:id` | | a browser asks to be let in → `{ id, code, expiresAt }`; polling sets the session cookie once approved |
| POST | `/api/access/session` · `/api/access/signout` | `{ token }` · | sign in with a pasted token · sign out (the session is revoked) |
| GET/POST | `/api/access/agents` | `{ name, scope, projects?, boards?, publicUrl? }` | the agents and pending requests · make a token → `201 { agent, token, setup }` (token shown once) |
| DELETE | `/api/access/agents/:id` | `?forget=1` | revoke (forget a revoked one) |
| PATCH | `/api/access/agents/:id` | `{ name }` | rename → `{ ok, from, name }`; boards naming it follow |
| GET | `/api/access/feedback` | | `{ feedback }` — the agents page's *Feedback from agents* (manage only) |
| GET/POST | `/api/access/requests` · `/api/access/requests/:id` · `/api/access/approve` | `{ allow, scope?, projects?, boards?, name?, code?, manage? }` · `{ code, … }` | pending requests · allow / deny one · allow the one whose code this is |
| WS | `/ws` | | the server socket: `access-request` / `access-resolved` (pages that may approve), `access-changed` |
| WS | `/ws/:id` | | `{ type:'hello', board }` then `{ type:'change', change }` per change |

Every `Change` carries `before` — a snapshot of each touched item before the change — so diffs never need a second read, and `by` when a named agent or person made it. CORS is open for the board API and the OAuth endpoints; the approve / manage API (`/api/access/…`) is same-origin only. From elsewhere every `/api` route except `version` and `kinds` needs credentials ([Remote agents](#remote-agents)); `?author=others` on `changes` / `diff` / `wait` means everyone but the calling agent.

### Model (from `src/model.ts`)

```ts
Item   { id, type: sticky|text|frame|lane|arrow|comment|wireframe|card|ui, x, y, w, h,
         text?, color?: orange|blue|yellow|pale-yellow|lilac|green|pink|red|purple|grey|white,
         role?, parent?, from?, to?, label?, target?, order?, data?,
         createdBy, updatedBy: 'agent'|'user', updatedAt }
Op     { kind:'add', item } | { kind:'update', id, patch } | { kind:'remove', id }
Change { seq, ts, author, boardId, ops, before: { [id]: Item|null }, note?, by?, meta? }   // meta: settings set by a no-ops change
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

### `ui-mock` (docs/diagrams.md §6c — real-looking screens)

```yaml
device: desktop            # desktop 1280×800 | laptop 1024×680 | tablet 768×1024 | phone 390×844
theme: light               # the mock's own theme; a screen may override it
tokens: { accent: '#1f56d6', radius: 8, font: sans }
screens:
  - id: boards
    name: Boards
    body:
      - { type: navbar, text: Unprose, items: [Boards, Docs], active: Boards, children: [{ type: avatar, id: me, text: River Lin }] }
      - type: section                      # padding 24
        children:
          - type: row
            justify: between
            children:
              - { type: heading, id: title, text: Boards, level: 1 }
              - { type: button, id: new-board, text: New board, icon: plus, goto: new-board }
          - { type: table, id: recent, columns: [Board, Status], rows: [[Studio, '[Done]']] }
  - { id: new-board, name: New board, device: phone, theme: dark, body: [ … ] }
flows: [{ from: boards/recent, to: new-board, label: open }]
```

A component tree, laid out by the template (no HTML is stored or rendered). Layout nodes `stack`, `row` (children
take `span` of 12, a fixed `w`, hug their content — buttons, badges, links — or share the rest; `justify`, `align`)
and `grid` (`cols`) are not drawn; `card`, `section` and `navbar` are drawn and hold children; every other type is
one element. Each screen and element becomes a `ui` item (`role` = its type) with
`data.ui = { type, …props, path, textKey, theme, accent, radius, font }` and `data.element = '<screen>/<element>'`;
ids are `<key>.screen.<screen>` and `<key>.ui.<screen>.<element>`. `goto` and `flows` draw `navigate` arrows to the
target screen; `note` becomes a comment bubble. The full list of types and props is in the MCP `CONTENT_HELP`
and docs/diagrams.md §6c. A text edit on the board sets `data.pending = { kind: 'text', before: { text }, after:
{ text }, path, key, by: 'user', at }` (a table cell or list item adds `sub: ['rows', r, c] | ['items', i]`); Delete
sets `{ kind: 'remove', before: { type, text }, path }` and keeps the item; the panel's Add element adds an item
`<key>.ui.<screen>.new-<type>` with `{ kind: 'add', node: { type, id, text }, parent | after: { element, path }, path }`.
A redraw clears each once the file explains it (new text, element gone, element with that id drawn). The drawing
puts `awd design lint`'s findings on the elements as `data.ui.findings: [{ severity, message }]`.

### `workflow`

The JSON `awd graph --json` emits: `{ name?, nodes: [{ id, kind: trigger|script|ai|gate|human|outcome, label?, config? }], edges: [{ from, to, label?, condition? }] }`. Triggers form the leftmost column; every other node sits one column right of its furthest predecessor; edge labels show the outcome and `if <condition>`.

`awd graph --json` also emits `agents: [{ id, description?, model?, runner?, tools?, effort?, delegates?, steps: [<ai step ids>], legacy? }]` (a `role:`-only step yields a `legacy: true` entry). When present, the template draws an **Agents** frame above the graph: one lilac `card` per agent (`role: agent`, id `wf.agent.<id>`, text `@<id>` + `<model> · <runner>`, `data: { agent, model, runner, tools, effort, steps, delegates, description }`), a dotted `owns` arrow (`role: owns`) to each step it runs, and a dashed `delegates` arrow between agents. The graph starts below the frame, so nothing overlaps, and ids are deterministic, so re-running `awd graph --canvas` after editing `agents:` updates the same cards. The run overlay badges these cards by `data.agent` (busy / idle).

Nodes and agents may carry a `detail` object; the template copies it to `item.data.detail`. `awd graph --canvas` fills it from the files around the workflow (persona and frontmatter of `agents/<id>.md`, the prompt an ai step really sends, a gate's rules in plain sentences, a script's source, `source: { workflow, line }`, `listens`, `emits`) — shape in [studio.md §1](studio.md). It is a snapshot refreshed on every redraw, not something the canvas writes back; `awd graph --json` stays detail-free.

### `domain-story` (docs/diagrams.md §6b — Domain Storytelling)

```json
{ "scope": { "granularity": "coarse-grained", "time": "as-is", "purity": "digitalized" },
  "actors": ["Moviegoer", "Cashier", { "text": "Ticket system", "kind": "system" }],
  "workObjects": [{ "text": "ticket", "kind": "document" }],
  "sentences": [{ "actor": "Cashier", "verb": "books", "object": "ticket", "to": "Ticket system", "toLabel": "in" }],
  "groups": [{ "text": "Booking", "members": ["ticket"] }], "annotations": [{ "on": "Cashier", "text": "Cash only" }] }
```

Actors (`role: actor`, blue cards with a pictogram) appear once on the top row; each sentence gets its own
work-object card (`role: work-object`, or `activity-node` when it has none) on the row below, in sequence order;
`activity` arrows are labelled `① verb`, `activity-to` arrows go on to the receiver. Annotations
(`role: annotation`), group outlines (`role: group`), a legend and the scope complete it. Cards carry
`data.element`; a sentence's card also `data.sentence` (read out) and `data.traces`.

### `freeform`

`{ items: [{ type?, text?, x?, y?, w?, h?, color?, role?, parent?, from?, to?, target?, id? }] }` — missing geometry is filled on a grid. This is also how the agent replies to a comment: `{ items: [{ type: 'comment', text: '…', target: '<item id>' }] }`.

### `kanban`

```json
{ "columns": [{ "name": "Backlog" }, { "name": "In Progress", "wip": 3 }, { "name": "Done" }],
  "cards": [
    { "id": "c-happy", "title": "Upload contacts CSV", "column": "Backlog", "size": "M", "labels": ["ST:ReadyForAgent"], "assignee": "@planner" },
    { "title": "Flaky date parsing", "column": "In Progress", "size": "S", "description": "…" },
    { "id": "release-1", "title": "Release 1", "column": "Backlog", "stories": ["studio-story-map/receipts"],
      "traces": [{ "from": "studio-es/ask-ai", "rel": "derived-from" }] } ] }
```

Every card and column carries `data.element` (the card's `id`, else the slug of its title; a column's slug) so
traces from other diagrams can point at it. `traces` on a card are drawn as dotted trace wires when the target
is on the board; `stories: ['<story map key>/<story id>']` is shorthand for `groups` traces (組成) and is also
kept as `data.stories` for the WorkTracker adapter (docs/diagrams.md §6).

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
awd-canvas serve [--port 4400] [--dir <boards dir, default ~/.awd/boards>] [--store file|memory] [--open]
                 [--studio <workflow.yaml>]... [--studio-cmd "<command with {file}>"] [--agents-file <file>]
                 # env: UNPROSE_REMOTE_AUTH=off · UNPROSE_PUBLIC_URL=https://… · UNPROSE_AGENTS_FILE
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

## Moving and selecting inside frames

Like Miro, FigJam and tldraw, a container moves by its edge and its inside is paper (`web/src/flow/bandSelect.ts`,
`boardToFlow.ts` `passThrough`, `select.css`):

- **Drag the empty inside of a frame** (a diagram frame, a domain-story group), **a lane, a kanban column, a wireframe
  or UI-mock screen, or a UI mock's section** — it draws a selection box, exactly like dragging on empty paper. The box
  selects every item it touches; a frame, lane, column or screen only when the box holds all of it, so a box drawn inside
  a frame never picks up the frame it was drawn on.
- **Drag its title bar or its border** (an 8 px strip along each edge; the cursor turns into a hand) — it moves, with
  everything inside. A kanban column moves by its header and snaps into its place in the row. Clicking the title or
  border selects it; once selected, its corners resize it as before.
- **Drag an item** (sticky, card, block, UI element — a UI card, navbar or sidebar included) — that item moves, alone.
- **Shift-drag** anywhere — the box adds to the current selection instead of replacing it (a Shift drag that starts on an
  item draws a box too). Shift- or ⌘/Ctrl-click still adds or removes one item.
- Middle-button drag, Space-drag and two-finger scroll pan the board; on a touch screen a drag on a frame's inside does
  what it does on empty paper. Long-press (touch) or right-click a frame's **title** for its menu; a double-click on
  its inside adds a sticky there, and a double-click on its title edits the title.

Technically: a container's React Flow node lets pointer events through (`pointer-events: none`) except on its title bar,
border strips and resize handles (class `drag-handle`, also the node's `dragHandle`), so a press on its body reaches the
pane and starts React Flow's selection box. The items inside are their own nodes and keep their events.

## Wires

How the board draws wires (`web/src/flow/route.ts`, `ItemEdge.tsx`, `catchAll.ts`). All of it is a way of looking:
nothing here is stored on the board, and a copied image shows what is shown.

- **Sides and routes.** A side the person (or a template) chose is kept. Otherwise every pair of sides is tried —
  facing sides (right → left, bottom → top …), one side into a perpendicular one (one bend), and a loop under or
  over both boxes — and the route that **crosses the fewest boxes** wins, then the shortest; the facing pair wins
  a near tie (40 px), so a wire changes sides only when that clears a box. A straight run sits in the best gap
  between boxes, wires sharing a side are spread along it, and a label sits on the wire's own run, never on a box.
  Going back along the same row a wire loops under (or over) rather than lying on the forward wire.
- **Selecting** a block brings its wires forward and fades the rest; hovering changes nothing.
- **Wires: All / Selected / None** (bottom-right corner, **W** cycles; remembered per viewer in this browser).
  *Selected* draws only the wires touching the selected blocks (others are hidden, not faded); *None* hides
  every wire. A wire picked in the Inspector's Wiring list is drawn in any mode.
- **Catch-all listeners are badges.** On a workflow board a subscription that listens to (or fans out across)
  many blocks is drawn as a small badge instead of a long wire: on the listener above its top edge
  (`on *.failed`, `resume: card.moved`, `on tick`, `on 8 events · 5 blocks` for a hub) and on the emitting block
  below its bottom edge (`card.moved → 2 blocks`, `3 events → park`); the badge's tooltip lists every wire.
  Click a badge to draw its wires again (click again to fold them back), or tick **Show catch-all wires** next to
  the mode buttons. The Inspector's Wiring section lists them as before. The rule — a flow wire carrying
  `data.event` is a catch-all when:
  1. its event pattern contains `*` (`*.failed`, `build.*`);
  2. it is a human step's `resume_on` (`data.event.resume`) — the trigger wakes a waiting step, it does not start one;
  3. its source is a cron trigger (`data.config.on: cron`, e.g. `tick`) — a sweep on a timer;
  4. *fan-out*: its source sends the same event to **4 or more** different blocks;
  5. *fan-in*: its target listens to **4 or more** different blocks (a hub such as `park` on every failure).

  Rules 4–5 count only the wires rules 1–3 left, so a trigger's resume fan-out does not hide its real start wire.

## Going to something

- **Go to…** (`⌘K` / `Ctrl+K`, or the header button): type a few letters of a frame's title or key, or an item's
  text; diagram frames are listed first. Enter fits the view to it and selects it.
- **Links:** `/b/<board>?frame=<diagram key>` opens the board fitted to that diagram frame (the frame panel's
  *Copy link*); `?focus=<item id>` opens it centred on an item (an item's *Copy link*).
- **Agent → you:** `canvas_focus` / `POST /api/boards/:id/focus` shows "Agent wants to show you …" with **Go** and
  **Dismiss**; *Follow agent* (remembered per viewer) makes the page jump without asking. Only the latest request
  is shown.

## Updating

A plugin canvas also follows `claude plugin update` run from a terminal: every 10 s it reads Claude Code's
`installed_plugins.json`, and when a newer version of this plugin is installed it restarts on it with the handoff
below (`UNPROSE_FOLLOW_INSTALLED_MS`, `0` = off; see docs/agents-setup.md → Updates).

The version button at the bottom of the rail checks GitHub for a newer release (on load and every six hours,
server-side, cached in `~/.awd/update-check.json`). When one exists the button says **update** and the release
notes dialog shows the new version's notes and **Upgrade to v…**.

**Check for updates** at the top of the dialog checks now (`GET /api/update?refresh=1`, past the cache): it shows
"Checking…", then "You're on the latest version (vX, checked just now)", the new version as above, or why the
check failed in plain words — "Couldn't reach GitHub: …", or for a private repository without credentials: set
`GITHUB_TOKEN` (or `GH_TOKEN`) in the canvas's environment or run `gh auth login`, then restart the canvas. Next to it:
"last checked … ago" (the check's `checkedAt`). The server throttles it: a refresh within 30 s of the previous
check answers with that check (`throttled: true`) instead of asking GitHub again, whoever asks — a page reached
through a tunnel may check too (it sees no local paths, and cannot upgrade). A plugin canvas that follows
`claude plugin update` (above) says "This canvas restarts by itself after `claude plugin update`".

What Upgrade does depends on how the canvas was installed:

| Install | Upgrade runs | Then starts |
|---|---|---|
| Claude Code plugin (`~/.claude/plugins/cache/…`) | `claude plugin update unprose@unprose` | the new version directory's `scripts/canvas.mjs` (it fetches a missing runtime) |
| git checkout with `packages/` | `git pull --ff-only && npm ci && npm run build` (refused while tracked files have uncommitted changes) | the same entry, rebuilt |
| git clone of the published repo (`dist/` committed) | `git pull --ff-only` | the same entry |
| runtime bundle (`…/runtime/<version>/canvas.mjs`) | download `unprose-runtime-v<latest>.tgz` (checksum-verified; `gh release download` for a private repo) | `…/runtime/<latest>/canvas.mjs` |

The restart hands the port over: the old server tells every open page (`{ type: 'update', phase: 'restarting' }`
over the WebSocket), stops listening and starts the new one with the same arguments; once the new server
answers `GET /api/version` with a new version the old one exits, and pages reconnect and reload. If the new
server does not answer within 15 s, the old one listens again and reports the failure (its output:
`~/.awd/canvas-upgrade.log`). A canvas the plugin started keeps its `canvas.json` pointing at the new process.
A canvas run by launchd (`XPC_SERVICE_NAME` naming an awd/unprose job) just exits after installing and launchd
starts it again.

- **Only from this machine:** upgrading runs commands on it, so `POST /api/update` answers `403` to any caller that
  is not on loopback or that came through a proxy/tunnel (`X-Forwarded-For`, `CF-Connecting-IP` …). Pages
  opened through a tunnel see the notice and the command to run by hand, with the button disabled.
- **Private repository:** the check uses the public API, then `GITHUB_TOKEN` / `GH_TOKEN`, then the `gh` CLI's
  login; without any it says so ("cannot check (private repository)").
- **Settings:** `UNPROSE_UPDATE_REPO` (default `river0825/unprose`), `UNPROSE_UPDATE_CHECK=0` turns checks off.
  `UNPROSE_UPDATE_FAKE_LATEST=<version>` pretends that version is out — for trying the UI and for tests only;
  do not click Upgrade with it on a real install.

