#!/usr/bin/env node
// `node scripts/canvas.mjs [serve options]` — start just the canvas (http://localhost:4400 by default,
// boards in ~/.awd/boards). Extra arguments go to `awd-canvas serve` (e.g. --port 4401, --dir …).
// Finds the runtime like the plugin does (downloading this version's if the install has none).
import { pathToFileURL } from 'node:url'
import { ensureRuntime } from './runtime.mjs'

const { runtime, reason } = await ensureRuntime({ log: (s) => process.stderr.write(`unprose: ${s}\n`) })
if (!runtime) {
  process.stderr.write(`unprose: ${reason}\n`)
  process.exit(1)
}
const args = process.argv.slice(2)
process.argv = [process.argv[0], runtime.canvas, 'serve', ...(args.includes('--port') ? [] : ['--port', process.env.PORT ?? '4400']), ...args]
await import(pathToFileURL(runtime.canvas).href)
