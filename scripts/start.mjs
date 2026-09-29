#!/usr/bin/env node
// `npm start` — run the canvas server and the example workflow runtime together.
// Ctrl-C stops both. Ports: canvas 4400, workflow 4311 (override with CANVAS_PORT / AWD_PORT).
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const canvasPort = process.env.CANVAS_PORT ?? '4400'
const awdPort = process.env.AWD_PORT ?? '4311'
const worker = process.env.AWD_WORKER ?? 'fake'

const procs = [
  ['canvas', process.execPath, [
    path.join(root, 'packages/canvas/dist/cli.js'), 'serve', '--port', canvasPort, '--dir', path.join(root, 'boards'),
    // the web may start/stop `awd studio` for this project only: every board whose meta points inside it (docs/diagrams.md §8)
    '--studio-project', root,
    '--studio-cmd', `${process.execPath} ${path.join(root, 'packages/cli/bin/awd.js')} studio --project {project}`,
  ]],
  ['awd', process.execPath, [path.join(root, 'packages/cli/bin/awd.js'), 'run', path.join(root, 'examples/card-pipeline/workflow.yaml'), '--port', awdPort, '--worker', worker, '--store-dir', path.join(root, '.awd')]],
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
