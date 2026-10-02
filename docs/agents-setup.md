# Using Unprose from your AI agent

Unprose exposes the canvas to agents as an MCP server (`unprose`, stdio) plus a CLI (`awd`). The MCP
server needs a running canvas server; start one first:

```bash
git clone <this repo> unprose && cd unprose
node scripts/canvas.mjs   # http://localhost:4400; boards in ~/.awd/boards (AWD_BOARDS_DIR moves them)
# the published repository and plugin ship a bundled runtime in dist/ — no npm install or build needed;
# in a dev checkout without dist/, run `npm install && npm run build` first
```

Below, `<unprose>` is the absolute path of that checkout.

## Claude Code

**As a plugin** (skill + MCP server). This repository is also a plugin marketplace
(`.claude-plugin/marketplace.json`):

```
/plugin marketplace add river0825/unprose
/plugin install unprose@unprose
```

The plugin declares its MCP server in `.claude-plugin/plugin.json` (`mcpServers`): `node
${CLAUDE_PLUGIN_ROOT}/scripts/mcp.mjs`, which runs the bundled server in `dist/` — nothing to install or build.
Two plugin options (`/config`, or the dialog when the plugin is enabled) reach it as `${user_config.*}`:
`canvas_url` (default `http://localhost:4400`; a remote address or a board link works) and `canvas_autostart`
(default on). The environment variables `AWD_CANVAS_URL` / `AWD_CANVAS_AUTOSTART` still work for the hook. The plugin also starts the canvas for you (see **Updates** below);
to start it by hand: `node <plugin dir>/scripts/canvas.mjs`.

### Updates: the plugin keeps itself runnable

**Updating from a terminal** (`claude plugin update unprose@unprose`, no session running): Claude Code has no
post-update hook, so the canvas follows the update itself. A canvas running from the plugin reads Claude Code's
install record (`~/.claude/plugins/installed_plugins.json`, or under `$CLAUDE_CONFIG_DIR`) every 10 s; when a newer
version of this plugin is installed it restarts on it — the same port handoff as the Upgrade button, the same
options (`--dir` …), open pages reconnect; if the new server does not come up, the old one keeps serving and that
version is not retried. `UNPROSE_FOLLOW_INSTALLED_MS` changes the interval (`0` turns it off). A canvas older than
0.6.3 does not follow yet: restart it once (a new session, `/reload-plugins`, or `node <plugin>/scripts/ensure.mjs`).

Claude Code copies each plugin version into its own folder and has no post-update hook, so the plugin checks
at the start of every session (`hooks/hooks.json` → `scripts/ensure.mjs`; the MCP server runs the same check
when it starts):

1. **Runtime** — the plugin's `dist/`, else this version's copy in `${CLAUDE_PLUGIN_DATA}/runtime/<version>/`,
   else it downloads `unprose-runtime-v<version>.tgz` from the GitHub release (checked against its `.sha256`)
   into that folder. In a dev checkout it runs `npm run build` instead. If nothing works it prints the fix.
2. **Canvas** (only when `AWD_CANVAS_URL` is local — `localhost` / `127.0.0.1`, default `:4400`):
   - nothing answers → starts one (boards in `$AWD_BOARDS_DIR`, else `~/.awd/boards`) and records it in
     `${CLAUDE_PLUGIN_DATA}/canvas.json`, which survives updates;
   - the canvas it started runs another version → stops it and starts the new one (the old version folder is
     deleted by Claude Code 14 days after an update, which would otherwise break it);
   - a canvas started by hand from the plugin (e.g. an agent ran `node <plugin>/scripts/canvas.mjs`) runs
     another version → the same: stopped and started from the new version, keeping its options (`--dir` …).
     It is recognised by its command line: a `canvas.mjs` in one of the plugin's version folders in the plugin
     cache, or in the data dir's runtime copies;
   - any other canvas you started yourself (a checkout, another folder) is never touched — you get one line:
     "a canvas vX is already running … not started by the plugin; restart it to get vY".
   `/reload-plugins` does not run the SessionStart hook, but it restarts the MCP server, which runs this check.
   A remote canvas is never started or stopped; you only get a note if its version differs.
3. The `canvas_autostart` option (or `AWD_CANVAS_AUTOSTART=0`) turns step 2 off (you start the canvas yourself). The hook prints at most a few
   short lines, and nothing when all is well. Its log: `${CLAUDE_PLUGIN_DATA}/canvas.log`.

**As a project MCP server** (no plugin): register it for your project (the public repository ships no root
`.mcp.json` — a plugin's root `.mcp.json` is loaded too, and one with `${CLAUDE_PLUGIN_ROOT:-.}` resolved to
the user's project, so the MCP server never started):

```bash
claude mcp add unprose -e AWD_CANVAS_URL=http://localhost:4400 -- node <unprose>/scripts/mcp.mjs
```

### A canvas that is not on localhost

Run the canvas anywhere (a tunnel, a server, another machine) and point the agent at it with
`AWD_CANVAS_URL`, e.g. `https://canvas.example.com`. A board link (`https://canvas.example.com/b/<id>`)
also works: the MCP server takes the origin from it. On startup the MCP server checks
`GET <url>/api/boards`; if that fails it exits with `unprose MCP: cannot reach <url> (<reason>). Start
the canvas (npm start) or set AWD_CANVAS_URL` — in Claude Code that shows up in `/mcp` as a failed
server with this message.

A canvas elsewhere wants credentials (docs/canvas.md → [Remote agents](canvas.md#remote-agents)). Without
`UNPROSE_TOKEN` the MCP server asks for a **pairing code** by itself: every tool result says *"Ask the person to
type the code ABCD-EFGH on the canvas"* until the person types it there (the notification on any open page, or
**Connected agents → Enter a code**), then it keeps the token in `~/.awd/tokens.json` for next time. Or make a
token on the canvas page **Connected agents** and pass it:

```bash
claude mcp add unprose -e AWD_CANVAS_URL=https://canvas.example.com -e UNPROSE_TOKEN=unp_… -e UNPROSE_AGENT_NAME=claude-laptop -- node <unprose>/scripts/mcp.mjs
```

`UNPROSE_AGENT_NAME` names your agent: its changes read `[7 claude-laptop] …` in the change feed (also for a local
canvas). Simpler for a canvas elsewhere: connect to its own MCP endpoint, next section.

## Remote agents: another machine or the cloud

The canvas serves MCP itself at **`https://<canvas>/mcp`** (Streamable HTTP). Nothing to install on the agent's
side. Two ways in:

- **OAuth (approve on connect)** — for clients that open a browser (claude.ai, Claude Code, ChatGPT …): the browser
  shows *"<client> wants to connect"* and a **pairing code**; every open canvas page shows the same request with a
  box for the code — type it and press **Allow** (a page opened on the canvas machine, `http://localhost:4400`, can
  just click Allow). The agent then appears in **Connected agents**, where you can revoke it.
- **A token** — for clients that can send a header: canvas → **Connected agents** (the *Agents* link on the board
  list, `http://localhost:4400/agents`) → **New token**: a name, read or read-and-draw, optionally only some
  projects or boards. The page shows the token once, with the lines below filled in. Tokens are made only on a page
  opened on the canvas machine.

Set `UNPROSE_PUBLIC_URL=https://<canvas>` on the canvas so the page's setup lines use the tunnel address.

### Claude Code (another machine)

```bash
claude mcp add --transport http unprose https://canvas.example.com/mcp
```

then `/mcp` in Claude Code → **unprose → Authenticate**: the browser opens the canvas's connect page with a code;
type it on the canvas (or click Allow on a page on the canvas machine). With a token instead:

```bash
claude mcp add --transport http unprose https://canvas.example.com/mcp --header "Authorization: Bearer unp_…"
```

### claude.ai (custom connector)

Settings → Connectors → **Add custom connector** → URL `https://canvas.example.com/mcp` → **Connect**. The connect
page shows the code; approve it on the canvas. Works in Claude Desktop and Claude mobile once added.

### ChatGPT (connector)

Settings → Connectors → (developer mode) **Create** → MCP server URL `https://canvas.example.com/mcp`,
authentication **OAuth** → approve with the code as above.

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.unprose]
url = "https://canvas.example.com/mcp"
bearer_token_env_var = "UNPROSE_TOKEN"   # export UNPROSE_TOKEN=unp_… (a token from Connected agents)
```

Or the stdio server with `AWD_CANVAS_URL` (previous section), which pairs with a code by itself.

### Cursor and other clients

```json
{ "mcpServers": { "unprose": { "url": "https://canvas.example.com/mcp", "headers": { "Authorization": "Bearer unp_…" } } } }
```

A client that supports MCP OAuth can leave the header out and approve on connect. A headless agent without a
browser can use the device flow: `POST https://canvas.example.com/device_authorization` with `client_name=<name>`,
show the person the `user_code`, poll `POST /token` (`grant_type=urn:ietf:params:oauth:grant-type:device_code`).

### What is different remotely

The canvas cannot read the agent's files, so `design_lint` / `design_draw` / `design_propose_stories` take the
file's text (`content`) and its name (`name`, e.g. `checkout.es.yaml`); the agent keeps the file as the truth.
Boards are not opened in a browser on the canvas machine — the tools return the link to give the person.
`design_egon` and workflow files (`awd graph`) need the local tools.

**Changing files you do not have — propose.** A remote agent cannot write the repo behind a board (a workflow's yaml,
its agents and scripts, the design files the person drew from their machine). It reads them from the board and
proposes a change:

```
canvas_files { id }                              → each file with its base sha-1
canvas_files { id, path: "workflow.yaml" }       → the exact text
canvas_propose_edit { id, file: "workflow.yaml", base: "<sha-1>", diff: "<unified diff>" | newText: "…",
                      note: "why", wires?: [{ from: "review", to: "build", event: "review.changes" }] }
canvas_wait { id, since }                        → the person's answer in the thread
```

The proposal shows in the board's Chat with the diff and your name; the agent that has the files (studio's session on
the canvas machine, or the person's own Claude Code) applies it after the person agrees, and says so in the thread. A
`409` means the file was redrawn since you read it — read it again and redo the edit. Proposals need a token with the
*read and draw* scope. Details: [canvas.md → Proposals and saving](canvas.md#proposals-and-saving).

## Two machines, one board

A worked example of several agents on one board ([canvas.md → Several agents on one board](canvas.md#several-agents-on-one-board)).

- **Machine A** runs the canvas (`http://localhost:4400`, reachable from B as `https://canvas.example.com` through a
  tunnel) and Claude Code with the unprose plugin — maybe studio too.
- **Machine B** has Codex and the files: `~/src/team-notes` (a git repo with `design/*.yaml` and the meeting
  notes). Codex took the notes of a meeting and should draw the diagrams and discuss them with you — machine A's
  Claude has neither the meeting nor the files.

**1. Give Codex a name (machine B).** Pick a short one: `codex-b`.

```toml
# ~/.codex/config.toml — the stdio server, which pairs with a code by itself
[mcp_servers.unprose]
command = "node"
args = ["/path/to/unprose/scripts/mcp.mjs"]
env = { AWD_CANVAS_URL = "https://canvas.example.com", UNPROSE_AGENT_NAME = "codex-b", UNPROSE_APPLY_COMMIT = "1", UNPROSE_APPLY_PUSH = "1" }
```

The first canvas tool call says *"Ask the person to type the code ABCD-EFGH on the canvas"*; type it on any canvas
page (or **Connected agents → Enter a code**). The token is called `codex-b` (without `UNPROSE_AGENT_NAME` it would be
`agent on <hostname>` — rename it on **Connected agents → Rename**). The `awd` CLI on machine B uses the same saved
token for that canvas, so `awd design draw` is signed `codex-b` too. (Or make a token named `codex-b` on Connected
agents at machine A and set `UNPROSE_TOKEN` on B.)

**2. Codex draws from its repo (machine B).**

```bash
cd ~/src/team-notes
awd design lint design/signup.es.yaml
awd design draw design/signup.es.yaml   --board "title:Meeting 2026-10-02" --canvas https://canvas.example.com
awd design draw design/scope.story-map.yaml --board "title:Meeting 2026-10-02" --canvas https://canvas.example.com
```

The board is new, so it is **answered by codex-b**, and every frame records its **holder**: *Files: team-notes ·
held by codex-b · drawn just now*, with the git remote (machine A's own pages also see *on mbp-b (…/src/team-notes)*).

**3. Codex writes the context** — what the meeting decided and where the notes are — so any agent that picks the
board up knows: `canvas_context { id, text: "Meeting 2026-10-02 (River, Codex): signup flow. Decided: no e-mail
confirmation in release 1. Notes: docs/meetings/2026-10-02.md in team-notes" }`. It shows at the top of the
board's side panel, in `canvas_read_board`, at the top of `canvas_wait` and of studio's briefs.

**4. Discuss.** Codex waits: `canvas_wait { id, since }`. Your comments go to codex-b (the header says *Answered by:
codex-b*; when Codex is not waiting, *"codex-b is away — your comments wait for it"*). Machine A's Claude (and studio)
are not woken by them: its `canvas_wait` says *"N change(s) on this board were for another agent"*.
Want Claude's view on one thing? Write **`@claude-a`** (or `@studio`) in that comment: that thread goes to Claude,
replies included. Agents can ask each other the same way — `canvas_ask { id, agent: "claude-a", question }` — and
pause after 6 messages in a row without you.

**5. Saving.** You edit a frame's text in the source dialog (or another agent proposes with `canvas_propose_edit`):
the proposal goes to **codex-b**, the holder. It explains it in the thread; after **you** agree, Codex applies it to
`~/src/team-notes/design/signup.es.yaml`, lints and redraws with `--applied <thread id>` — the thread gets
*"Applied to design/signup.es.yaml — committed 3e81cda and pushed"* (because machine B set `UNPROSE_APPLY_COMMIT=1`
and `UNPROSE_APPLY_PUSH=1`). Machine A runs `git pull` in its clone of team-notes when it wants the files.

Notes: a person on machine A may change *Answered by* back to studio at any time (logged). A read-only token can read
the board and the context but not change them. Names are how routing works — rename an agent rather than making a
second token for it.

## Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.unprose]
command = "node"
args = ["<unprose>/scripts/mcp.mjs"]
env = { AWD_CANVAS_URL = "http://localhost:4400" }
```

Codex reads `AGENTS.md` for project instructions; copy or link this repository's `AGENTS.md` into the
project you are designing, or reference it from that project's own `AGENTS.md`.

## Any other MCP client

Stdio server: command `node`, args `["<unprose>/scripts/mcp.mjs"]`, environment
`AWD_CANVAS_URL=http://localhost:4400`. The generic JSON form most clients accept:

```json
{ "mcpServers": { "unprose": { "command": "node", "args": ["<unprose>/scripts/mcp.mjs"], "env": { "AWD_CANVAS_URL": "http://localhost:4400" } } } }
```

Agents without MCP can still use the CLI (`node <unprose>/scripts/awd.mjs design …`) and the
canvas HTTP API (`docs/canvas.md`).

## Not verified yet

- Plugin configs use plain `${CLAUDE_PLUGIN_ROOT}` / `${user_config.KEY}` only — Claude Code substitutes
  `${NAME}` in MCP `command` / `args` / `env` and hook commands, not shell forms like `${VAR:-default}`
  (the export refuses them). `claude plugin validate` passes on the exported tree.
- The Codex `config.toml` table shape (`[mcp_servers.<name>]` with `command` / `args` / `env`, and `url` +
  `bearer_token_env_var` for a remote server) is the documented form at the time of writing; check your Codex
  version's docs if it rejects it.
- Remote MCP: the OAuth flow was tested end to end with the MCP SDK's own client (what Claude Code uses) through a
  tunnel-like proxy, and the device flow with the stdio server. The claude.ai, ChatGPT and Cursor steps follow their
  documented connector setup and were not run against a live canvas here.
