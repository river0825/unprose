#!/usr/bin/env node
// The Unprose MCP server, for Claude Code (plugin or project), Codex, or any MCP client.
// It talks to a running canvas server (AWD_CANVAS_URL, default http://localhost:4400; a board link works
// too). Before starting it makes sure the runtime exists (downloading this version's if the install has
// none) and, for a local canvas, starts one if none answers — so the first session after an update works.
// All status goes to stderr: stdout is the MCP channel.
import { pathToFileURL } from 'node:url'
import { canvasTarget, ensureCanvas, ensureRuntime } from './runtime.mjs'

const say = (s) => process.stderr.write(`unprose: ${s}\n`)
const { runtime, reason } = await ensureRuntime({ log: say })
if (!runtime) {
  say(reason)
  process.exit(1)
}
// the plugin passes its canvas_url option here; empty or unsubstituted means the default
process.env.AWD_CANVAS_URL = canvasTarget()
try {
  await ensureCanvas({ runtime, log: say })
} catch (e) {
  say(`canvas check failed: ${e?.message ?? e}`)
}
// `awd mcp`: the canvas tools plus the design_* tools and the start prompts
process.argv = [process.argv[0], runtime.awd, 'mcp']
await import(pathToFileURL(runtime.awd).href)
