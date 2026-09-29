import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseWorkflow } from '@awd/core'
import { Engine } from '../src/engine.js'
import { MemoryEventStore } from '../src/eventStore.js'
import { CliWorker, CLI_PRESETS } from '../src/workers/cli.js'
import { HerdrWorker } from '../src/workers/herdr.js'
import { RunnerRegistry } from '../src/workers/index.js'
import { extractJsonAnswer } from '../src/workers/types.js'
import { loadWorkflow, splitFrontmatter } from '../src/load.js'
import type { WorkerRequest } from '../src/workers/types.js'

const schema = { type: 'object', required: ['outcome'], properties: { outcome: { enum: ['done', 'nope'] }, note: { type: 'string' } } }

test('extractJsonAnswer understands codex / opencode / claude-code streams and plain text', () => {
  const codex = [
    '{"type":"thread.started","thread_id":"t"}',
    '{"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"Sure.\\n```json\\n{\\"outcome\\":\\"done\\",\\"note\\":\\"codex\\"}\\n```"}}',
    '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}',
  ].join('\n')
  assert.deepEqual(extractJsonAnswer(codex), { outcome: 'done', note: 'codex' })
  const opencode = [
    '{"type":"step_start","part":{"type":"step-start"}}',
    '{"type":"text","part":{"type":"text","text":"{\\"outcome\\":\\"done\\",\\"note\\":\\"oc\\"}"}}',
    '{"type":"step_finish","part":{"tokens":{"input":5,"output":1}}}',
  ].join('\n')
  assert.deepEqual(extractJsonAnswer(opencode), { outcome: 'done', note: 'oc' })
  assert.deepEqual(extractJsonAnswer('{"type":"result","result":"{\\"outcome\\":\\"nope\\"}","structured_output":{"outcome":"done","note":"cc"}}'), { outcome: 'done', note: 'cc' })
  assert.deepEqual(extractJsonAnswer('blah {"a":1} then the answer {"outcome":"done"} bye'), { outcome: 'done' })
  assert.equal(extractJsonAnswer('nothing here'), undefined)
})

test('cli runner: presets exist; a custom command gets the prompt on stdin and its last JSON becomes the output', async () => {
  assert.ok(CLI_PRESETS.codex.command.startsWith('codex exec --json'))
  assert.ok(CLI_PRESETS.opencode.command.startsWith('opencode run --format json'))
  const seen: { cmd?: string; stdin?: string } = {}
  const worker = new CliWorker({
    exec: async (cmd, stdin) => {
      seen.cmd = cmd; seen.stdin = stdin
      return { stdout: 'thinking…\n{"type":"progress"}\n{"outcome":"done","note":"from ' + cmd.split(' ')[0] + '"}\n', stderr: '', code: 0 }
    },
  })
  const req: WorkerRequest = { agent: 'reviewer', model: 'sonnet', system: 'Be brief.', runner: 'cli', runnerConfig: { command: 'fakeagent --model {{ model }} -' }, input: { pr: 7 }, outputSchema: schema, key: 'k', step: 'review' }
  const r = await worker.run(req)
  assert.deepEqual(r.output, { outcome: 'done', note: 'from fakeagent' })
  assert.equal(seen.cmd, 'fakeagent --model sonnet -')
  assert.match(seen.stdin!, /Be brief\./)
  assert.match(seen.stdin!, /"pr": 7/)
  await assert.rejects(worker.run({ ...req, runnerConfig: { preset: 'nah' } }), /unknown cli preset/)
})

test('cli runner end to end through the engine with a real (node) command', async () => {
  const def = parseWorkflow(`
name: cli-e2e
triggers: { go: { on: manual, emit: go } }
agents:
  echoer:
    description: a node one-liner that answers with JSON
    runner: cli
    cli: { command: "node -e \\"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify({outcome:'done',note:'saw '+(s.includes('Input')?'input':'nothing')})))\\"", stdin: true }
steps:
  ask:
    on: go
    ai: { agent: echoer, input: { q: 1 }, output: ${JSON.stringify(schema)} }
    terminal: true
`)
  const store = new MemoryEventStore()
  const worker = new RunnerRegistry('fake', { cwd: os.tmpdir() })
  const engine = new Engine({ def, store, worker, timerIntervalMs: 10 })
  await engine.start()
  store.append({ type: 'go', key: 'k1', data: {} })
  await engine.idle()
  const st = engine.states.get('k1')!
  assert.deepEqual(st.history.map((h) => `${h.step}.${h.outcome}`), ['ask.done'])
  assert.deepEqual(st.vars.ask, { note: 'saw input' })
  // `--worker fake` forces every agent through the fake worker, whatever its runner says
  const forced = new RunnerRegistry('claude-code', {}, 'fake')
  assert.equal(forced.for('cli').name, 'fake')
  assert.equal(forced.for('herdr').name, 'fake')
  engine.stop()
})

test('herdr runner: reuses a ready agent, writes the mailbox, prompts once, reads the answer file; blocked → agent_blocked', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-herdr-'))
  const calls: string[][] = []
  let blocked = false
  const exec = async (args: string[]) => {
    calls.push(args)
    const json = (v: unknown) => ({ stdout: JSON.stringify(v), stderr: '', code: 0 })
    if (args[0] === 'agent' && args[1] === 'list') return json({ result: { agents: [{ agent: 'codex', agent_status: 'idle', name: 'awd-qa', pane_id: 'w1:p9' }] } })
    if (args[0] === 'agent' && args[1] === 'prompt') {
      if (blocked) return json({ error: { code: 'agent_blocked' } })
      // the "agent" does its work a moment later: it writes the answer file the prompt named
      const out = /to (\S+\.out\.json)/.exec(args[3])![1]
      setTimeout(() => fs.writeFileSync(out, '{"outcome":"done","note":"from pane"}\n'), 20)
      return json({ result: { type: 'agent_prompted', agent: { agent_status: 'working' } } })
    }
    if (args[0] === 'agent' && args[1] === 'get') return json({ result: { agent: { agent_status: blocked ? 'blocked' : 'working', interactive_ready: true } } })
    if (args[0] === 'agent' && args[1] === 'read') return { stdout: 'tail…', stderr: '', code: 0 }
    throw new Error('unexpected herdr call ' + args.join(' '))
  }
  const worker = new HerdrWorker({ exec, mailDir: path.join(dir, 'mail'), pollMs: 5, stateEveryMs: 5 })
  const req: WorkerRequest = { agent: 'qa', system: 'Test it.', runner: 'herdr', runnerConfig: { kind: 'codex' }, input: { preview: 'http://x' }, outputSchema: schema, key: 'c1', step: 'qa', commandId: 'e1:qa' }
  const r = await worker.run(req)
  assert.deepEqual(r.output, { outcome: 'done', note: 'from pane' })
  // list → prompt, then only state polls (`agent get`) until the answer file appears
  assert.deepEqual(calls.slice(0, 2).map((c) => c.slice(0, 2).join(' ')), ['agent list', 'agent prompt'])
  assert.ok(calls.slice(2).every((c) => c[1] === 'get'), 'after the prompt the worker only polls agent state')
  const prompt = calls[1]
  assert.equal(prompt[2], 'awd-qa')
  assert.match(prompt[3], /e1_qa\.in\.json/)
  assert.ok(!prompt[3].includes('\n'), 'the pasted prompt must be a single line (a newline can submit half of it)')
  assert.ok(!prompt.includes('--wait'), 'submission only — the answer file is the contract, not the TUI state')
  assert.ok(fs.existsSync(path.join(dir, 'mail', 'e1_qa.in.json')))
  const mailbox = JSON.parse(fs.readFileSync(path.join(dir, 'mail', 'e1_qa.in.json'), 'utf8'))
  assert.deepEqual(mailbox.input, { preview: 'http://x' })
  assert.equal(mailbox.system, 'Test it.')

  blocked = true
  await assert.rejects(worker.run({ ...req, commandId: 'e2:qa' }), /^Error: agent_blocked/)
})

test('herdr runner: an agent that goes idle without writing the file fails with the pane tail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-herdr-'))
  const exec = async (args: string[]) => {
    const json = (v: unknown) => ({ stdout: JSON.stringify(v), stderr: '', code: 0 })
    if (args[1] === 'list') return json({ result: { agents: [{ agent: 'codex', agent_status: 'idle', name: 'awd-qa', pane_id: 'w1:p9' }] } })
    if (args[1] === 'prompt') return json({ result: { type: 'agent_prompted' } })
    if (args[1] === 'get') return json({ result: { agent: { agent_status: 'idle', interactive_ready: true } } })
    if (args[1] === 'read') return { stdout: '…the pane said nothing useful…', stderr: '', code: 0 }
    throw new Error('unexpected ' + args.join(' '))
  }
  const worker = new HerdrWorker({ exec, mailDir: path.join(dir, 'mail'), pollMs: 5, stateEveryMs: 5, idleGraceMs: 30 })
  await assert.rejects(
    worker.run({ agent: 'qa', runner: 'herdr', runnerConfig: { kind: 'codex' }, input: {}, outputSchema: schema, key: 'c', step: 'qa', commandId: 'e3:qa' }),
    /finished without a valid e3_qa\.out\.json[\s\S]*nothing useful/,
  )
})

test('herdr runner: starts a new agent in a split pane when none has the name', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-herdr-'))
  const calls: string[][] = []
  const exec = async (args: string[]) => {
    calls.push(args)
    const json = (v: unknown) => ({ stdout: JSON.stringify(v), stderr: '', code: 0 })
    if (args[1] === 'list') return json({ result: { agents: [] } })
    if (args[0] === 'pane' && args[1] === 'split') return json({ result: { pane: { pane_id: 'w1:p7' } } })
    if (args[1] === 'start') return json({ result: { agent: { name: args[2], pane_id: 'w1:p7' } } })
    if (args[1] === 'wait') return json({ result: { state: 'idle' } })
    // the freshly started agent is only interactive on the second look
    if (args[1] === 'get') return json({ result: { agent: { name: args[2], agent_status: 'idle', interactive_ready: calls.filter((c) => c[1] === 'get').length > 1 } } })
    if (args[1] === 'prompt') { fs.writeFileSync(/to (\S+\.out\.json)/.exec(args[3])![1], '{"outcome":"done"}'); return json({ result: { state: 'idle' } }) }
    throw new Error('unexpected ' + args.join(' '))
  }
  const worker = new HerdrWorker({ exec, mailDir: path.join(dir, 'mail'), pollMs: 5, settleMs: 1, cwd: dir })
  const r = await worker.run({ agent: 'reviewer', runner: 'herdr', runnerConfig: { kind: 'opencode', name: 'rev' }, input: {}, outputSchema: schema, key: 'c', step: 'review' })
  assert.deepEqual(r.output, { outcome: 'done' })
  assert.deepEqual(calls.map((c) => c.slice(0, 2).join(' ')), ['agent list', 'pane split', 'agent start', 'agent wait', 'agent get', 'agent get', 'agent prompt'])
  assert.deepEqual(calls[2].slice(2), ['rev', '--kind', 'opencode', '--pane', 'w1:p7'])
  assert.ok(calls[1].includes('--no-focus'))
})

test('loader: agents/<id>.md frontmatter + body merge under the yaml block; roles/<id>.md is the fallback prompt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-load-'))
  fs.mkdirSync(path.join(dir, 'agents'))
  fs.mkdirSync(path.join(dir, 'roles'))
  fs.writeFileSync(path.join(dir, 'agents', 'architect.md'), '---\nname: architect\ndescription: from file\nmodel: opus\ntools: [Read]\n---\nYou are the architect.\n')
  fs.writeFileSync(path.join(dir, 'roles', 'planner.md'), 'You plan.\n')
  fs.writeFileSync(path.join(dir, 'workflow.yaml'), `
name: l
triggers: { go: { on: manual, emit: go } }
agents:
  planner: { model: sonnet }
  architect: { model: haiku }
steps:
  p:
    on: go
    ai: { agent: planner, output: { type: object, required: [outcome], properties: { outcome: { enum: [done] } } } }
    terminal: true
`)
  const wf = loadWorkflow(path.join(dir, 'workflow.yaml'))
  assert.equal(wf.agents.architect.system, 'You are the architect.\n')
  assert.equal(wf.agents.architect.model, 'haiku') // yaml wins
  assert.equal(wf.agents.architect.description, 'from file')
  assert.deepEqual(wf.agents.architect.tools, ['Read'])
  assert.equal(wf.agents.planner.system, 'You plan.\n') // roles fallback
  assert.equal(wf.def.agents.planner.system, 'You plan.\n') // def kept in sync for the reducer
  assert.deepEqual(splitFrontmatter('no front matter'), { data: {}, body: 'no front matter' })
})
