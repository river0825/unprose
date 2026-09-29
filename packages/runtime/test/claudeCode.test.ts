import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ClaudeCodeWorker, workdirNote } from '../src/adapters/workers/claudeCode.js'
import type { WorkerRequest } from '../src/ports/workerRuntime.js'

// A stand-in for the `claude` binary: prints the envelope Claude Code prints,
// with the args and cwd it was called with tucked into `structured_output`.
function fakeClaude(dir: string): string {
  const bin = path.join(dir, 'fake-claude.mjs')
  fs.writeFileSync(
    bin,
    `let stdin = ''\nprocess.stdin.on('data', (d) => (stdin += d))\nprocess.stdin.on('end', () => {\n  const out = { outcome: 'done', args: process.argv.slice(2), cwd: process.cwd(), stdin }\n  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(out), structured_output: out, usage: { input_tokens: 1, output_tokens: 2 } }))\n})\n`,
  )
  return bin
}

const schema = { type: 'object', required: ['outcome'], properties: { outcome: { enum: ['done'] } } }

test('claude-code runner: per-agent cwd / permissionMode / addDirs become the spawn cwd and flags', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-cc-'))
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-wt-'))
  const bin = fakeClaude(dir)
  const req: WorkerRequest = {
    agent: 'builder', system: 'Build it.', model: 'opus', tools: ['Read', 'Edit'], effort: 'high',
    runner: 'claude-code', runnerConfig: { cwd: worktree, permissionMode: 'acceptEdits', addDirs: ['/tmp/shared'] },
    input: { card: 'c1' }, outputSchema: schema, key: 'c1', step: 'build', commandId: 'e1:build',
  }
  const wrapper = path.join(dir, 'claude')
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${bin}" "$@"\n`)
  fs.chmodSync(wrapper, 0o755)
  const out = (await new ClaudeCodeWorker({ bin: wrapper }).run(req)).output as { args: string[]; cwd: string; stdin: string }
  assert.equal(fs.realpathSync(out.cwd), fs.realpathSync(worktree))
  const args = out.args
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits')
  assert.equal(args[args.indexOf('--add-dir') + 1], '/tmp/shared')
  assert.equal(args[args.indexOf('--model') + 1], 'opus')
  const sys = args[args.indexOf('--append-system-prompt') + 1]
  assert.match(sys, /Build it\./)
  assert.match(sys, new RegExp(workdirNote(worktree).split('\n')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(sys, /never touch the main checkout/)
})

test('claude-code runner: without runnerConfig the worker-level defaults apply', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-cc-'))
  const bin = fakeClaude(dir)
  const wrapper = path.join(dir, 'claude')
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${bin}" "$@"\n`)
  fs.chmodSync(wrapper, 0o755)
  const out = (await new ClaudeCodeWorker({ bin: wrapper, cwd: dir, permissionMode: 'plan' }).run({ input: {}, outputSchema: schema, key: 'k', step: 's' })).output as { args: string[]; cwd: string }
  assert.equal(fs.realpathSync(out.cwd), fs.realpathSync(dir))
  assert.equal(out.args[out.args.indexOf('--permission-mode') + 1], 'plan')
  assert.ok(!out.args.includes('--add-dir'))
})
