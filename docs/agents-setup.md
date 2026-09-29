# Using Unprose from your AI agent

Unprose exposes the canvas to agents as an MCP server (`awd-canvas`, stdio) plus a CLI (`awd`). The MCP
server needs a running canvas server; start one first:

```bash
git clone <this repo> unprose && cd unprose
npm install && npm run build
npm start          # or: node packages/canvas/dist/cli.js serve --port 4400 --dir boards
```

Below, `<unprose>` is the absolute path of that checkout.

## Claude Code

**As a plugin** (skill + MCP server). This repository is also a plugin marketplace
(`.claude-plugin/marketplace.json`):

```
/plugin marketplace add river0825/unprose
/plugin install unprose@unprose
```

The plugin's `.mcp.json` starts `node ${CLAUDE_PLUGIN_ROOT}/scripts/mcp.mjs`. Run `npm install && npm
run build` once inside the installed plugin directory (or point it at your checkout) so `dist/` exists.

**As a project MCP server** (no plugin): the repository's own `.mcp.json` works when Claude Code is started
in the checkout (`${CLAUDE_PLUGIN_ROOT:-.}` falls back to the current directory). From another project:

```bash
claude mcp add awd-canvas -e AWD_CANVAS_URL=http://localhost:4400 -- node <unprose>/scripts/mcp.mjs
```

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

Agents without MCP can still use the CLI (`node <unprose>/packages/cli/bin/awd.js design …`) and the
canvas HTTP API (`docs/canvas.md`).

## Not verified yet

- The plugin install commands above follow the Claude Code plugin conventions (`.claude-plugin/plugin.json`,
  `marketplace.json`, root `.mcp.json`, `${CLAUDE_PLUGIN_ROOT}`); `${VAR:-default}` expansion in
  `.mcp.json` is what lets one file serve both the plugin and a plain checkout. Neither has been exercised
  end to end from a published marketplace.
- The Codex `config.toml` table shape (`[mcp_servers.<name>]` with `command` / `args` / `env`) is the
  documented form at the time of writing; check your Codex version's docs if it rejects it.
