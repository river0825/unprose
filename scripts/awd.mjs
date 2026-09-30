#!/usr/bin/env node
// `node scripts/awd.mjs <command> …` — the awd CLI from the plugin's runtime (dist/, the data dir's copy for
// this version, or a dev checkout's build; downloaded if the install has none).
import { pathToFileURL } from 'node:url'
import { ensureRuntime } from './runtime.mjs'

const { runtime, reason } = await ensureRuntime({ log: (s) => process.stderr.write(`unprose: ${s}\n`) })
if (!runtime) {
  process.stderr.write(`unprose: ${reason}\n`)
  process.exit(1)
}
process.argv = [process.argv[0], runtime.awd, ...process.argv.slice(2)]
await import(pathToFileURL(runtime.awd).href)
