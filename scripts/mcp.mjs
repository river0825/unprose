#!/usr/bin/env node
// The awd-canvas MCP server, for Claude Code (plugin or project), Codex, or any MCP client.
// It talks to a running canvas server (AWD_CANVAS_URL, default http://localhost:4400; a board link works
// too) and exits with the reason if it cannot reach it. Start one with `node scripts/canvas.mjs`.
import { pathToFileURL } from 'node:url'
import { entry } from './entry.mjs'

const cli = entry('canvas')
process.env.AWD_CANVAS_URL ??= 'http://localhost:4400'
process.argv = [process.argv[0], cli, 'mcp']
await import(pathToFileURL(cli).href)
