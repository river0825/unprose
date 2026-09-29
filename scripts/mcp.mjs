#!/usr/bin/env node
// The awd-canvas MCP server, for Claude Code (plugin or project), Codex, or any MCP client.
// It talks to a running canvas server (AWD_CANVAS_URL, default http://localhost:4400):
// start one with `npm start` or `node packages/canvas/dist/cli.js serve --port 4400`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(root, 'packages/canvas/dist/cli.js')
if (!fs.existsSync(cli)) {
  process.stderr.write(`unprose: ${cli} is missing — run \`npm install && npm run build\` in ${root} first.\n`)
  process.exit(1)
}
process.env.AWD_CANVAS_URL ??= 'http://localhost:4400'
process.argv = [process.argv[0], cli, 'mcp']
await import(pathToFileURL(cli).href)
