#!/usr/bin/env node
// `npm start` — run the canvas server and the example workflow runtime together.
// Ctrl-C stops both. Ports: canvas 4400, workflow 4311 (override with CANVAS_PORT / AWD_PORT).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { entry } from './entry.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const canvasPort = process.env.CANVAS_PORT ?? '4400'
const awdPort = process.env.AWD_PORT ?? '4311'
const worker = process.env.AWD_WORKER ?? 'fake'
// Boards: $AWD_BOARDS_DIR, else a checkout's existing ./boards (older setups keep their data), else the
// canvas default (~/.awd/boards). Never inside a plugin install — a reinstall deletes it (unprose#1).
const inPluginCache = /[\\/]plugins[\\/]cache[\\/]/.test(root + path.sep)
const legacy = path.join(root, 'boards')
const boardsDir = process.env.AWD_BOARDS_DIR ?? (!inPluginCache && fs.existsSync(legacy) ? legacy : undefined)

// the bundled plugin runtime (dist/) or the workspace build (unprose#4)
const canvasCli = entry('canvas')
const awdCli = entry('awd')
const procs = [
  ['canvas', process.execPath, [
    canvasCli, 'serve', '--port', canvasPort, ...(boardsDir ? ['--dir', boardsDir] : []),
    // the web may start/stop `awd studio` for this project only: every board whose meta points inside it (docs/diagrams.md §8)
    '--studio-project', root,
    '--studio-cmd', `${process.execPath} ${awdCli} studio --project {project}`,
  ]],
  ['awd', process.execPath, [awdCli, 'run', path.join(root, 'examples/card-pipeline/workflow.yaml'), '--port', awdPort, '--worker', worker, '--store-dir', path.join(root, '.awd')]],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AWD_CANVAS_URL: `http://localhost:${canvasPort}` } })
  const tag = (line) => `[${name}] ${line}`
  p.stdout.on('data', (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map(tag).join('\n') + '\n'))
  p.stderr.on('data', (d) => process.stderr.write(String(d).split('\n').filter(Boolean).map(tag).join('\n') + '\n'))
  p.on('exit', (code) => { console.log(`[${name}] exited (${code})`); stopAll() })
  return p
})

console.log(`canvas   http://localhost:${canvasPort}   docs http://localhost:${canvasPort}/docs`)
console.log(`workflow http://localhost:${awdPort}/api/status   (worker: ${worker})`)

function stopAll() { for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM') }
process.on('SIGINT', () => { stopAll(); process.exit(0) })
process.on('SIGTERM', () => { stopAll(); process.exit(0) })
