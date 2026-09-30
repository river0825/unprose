#!/usr/bin/env node
// `node scripts/ensure.mjs` — run at the start of every Claude Code session (hooks/hooks.json): make the
// plugin runnable after an install or update and keep the canvas on the plugin's version.
//   1. runtime: the plugin's dist/, else this version's copy in the plugin data dir, else download it from
//      the GitHub release (checksum-verified), else (dev checkout) npm run build.
//   2. canvas (local AWD_CANVAS_URL only, unless AWD_CANVAS_AUTOSTART=0): start one if none answers;
//      restart one the plugin started when its version differs; leave a canvas you started alone.
// Prints at most a few short lines (they reach the session); never fails the session.
import { ensureCanvas, ensureRuntime } from './runtime.mjs'

const lines = []
const log = (s) => lines.push(`unprose: ${s}`)
try {
  const { runtime, reason } = await ensureRuntime({ log: (s) => process.stderr.write(`unprose: ${s}\n`) })
  if (!runtime) log(reason)
  await ensureCanvas({ runtime, log })
} catch (e) {
  log(`setup check failed: ${e?.message ?? e}`)
}
if (lines.length) process.stdout.write(lines.join('\n') + '\n')
process.exit(0)
