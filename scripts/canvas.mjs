#!/usr/bin/env node
// `node scripts/canvas.mjs [serve options]` — start just the canvas (http://localhost:4400 by default,
// boards in ~/.awd/boards). Extra arguments go to `awd-canvas serve` (e.g. --port 4401, --dir …).
import { pathToFileURL } from 'node:url'
import { entry } from './entry.mjs'

const cli = entry('canvas')
const args = process.argv.slice(2)
process.argv = [process.argv[0], cli, 'serve', ...(args.includes('--port') ? [] : ['--port', process.env.PORT ?? '4400']), ...args]
await import(pathToFileURL(cli).href)
