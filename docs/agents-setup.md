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

The plugin declares its MCP server in `.claude-plugin/plugin.json` (`mcpServers`): `node
${CLAUDE_PLUGIN_ROOT}/scripts/mcp.mjs`, which runs the bundled server in `dist/` — nothing to install or build.
Two plugin options (`/config`, or the dialog when the plugin is enabled) reach it as `${user_config.*}`:
`canvas_url` (default `http://localhost:4400`; a remote address or a board link works) and `canvas_autostart`
(default on). The environment variables `AWD_CANVAS_URL` / `AWD_CANVAS_AUTOSTART` still work for the hook. The plugin also starts the canvas for you (see **Updates** below);
to start it by hand: `node <plugin dir>/scripts/canvas.mjs`.

### Updates: the plugin keeps itself runnable

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

- Plugin configs use plain `${CLAUDE_PLUGIN_ROOT}` / `${user_config.KEY}` only — Claude Code substitutes
  `${NAME}` in MCP `command` / `args` / `env` and hook commands, not shell forms like `${VAR:-default}`
  (the export refuses them). `claude plugin validate` passes on the exported tree.
- The Codex `config.toml` table shape (`[mcp_servers.<name>]` with `command` / `args` / `env`) is the
  documented form at the time of writing; check your Codex version's docs if it rejects it.
