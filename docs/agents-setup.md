# Using Unprose from your AI agent

Unprose exposes the canvas to agents as an MCP server (`awd-canvas`, stdio) plus a CLI (`awd`). The MCP
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

The plugin's `.mcp.json` starts `node ${CLAUDE_PLUGIN_ROOT}/scripts/mcp.mjs`, which runs the bundled server in
`dist/` — nothing to install or build. Start the canvas with `node <plugin dir>/scripts/canvas.mjs`.

**As a project MCP server** (no plugin): the repository's own `.mcp.json` works when Claude Code is started
in the checkout (`${CLAUDE_PLUGIN_ROOT:-.}` falls back to the current directory). From another project:

```bash
claude mcp add awd-canvas -e AWD_CANVAS_URL=http://localhost:4400 -- node <unprose>/scripts/mcp.mjs
```

### A canvas that is not on localhost

Run the canvas anywhere (a tunnel, a server, another machine) and point the agent at it with
`AWD_CANVAS_URL`, e.g. `https://canvas.example.com`. A board link (`https://canvas.example.com/b/<id>`)
also works: the MCP server takes the origin from it. On startup the MCP server checks
`GET <url>/api/boards`; if that fails it exits with `awd-canvas MCP: cannot reach <url> (<reason>). Start
the canvas (npm start) or set AWD_CANVAS_URL` — in Claude Code that shows up in `/mcp` as a failed
server with this message. Keep a remote canvas behind an access proxy: it has no authentication yet.

## Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.awd-canvas]
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
{ "mcpServers": { "awd-canvas": { "command": "node", "args": ["<unprose>/scripts/mcp.mjs"], "env": { "AWD_CANVAS_URL": "http://localhost:4400" } } } }
```

Agents without MCP can still use the CLI (`node <unprose>/scripts/awd.mjs design …`) and the
canvas HTTP API (`docs/canvas.md`).

## Not verified yet

- The plugin install commands above follow the Claude Code plugin conventions (`.claude-plugin/plugin.json`,
  `marketplace.json`, root `.mcp.json`, `${CLAUDE_PLUGIN_ROOT}`); `${VAR:-default}` expansion in
  `.mcp.json` is what lets one file serve both the plugin and a plain checkout. Neither has been exercised
  end to end from a published marketplace.
- The Codex `config.toml` table shape (`[mcp_servers.<name>]` with `command` / `args` / `env`) is the
  documented form at the time of writing; check your Codex version's docs if it rejects it.
