// docs/studio.md §1 — every block on the board knows what it is, in full.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseWorkflow } from '@awd/core'
import { blockDetails, keyLines, keyRanges, workflowFiles, loadWorkflow, resolveAgents } from '../src/index.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const readFs = (p: string) => (fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : undefined)

test('dev/workflow.yaml: ai, script, human, trigger and agent details', () => {
  const wf = loadWorkflow(path.join(repo, 'dev/workflow.yaml'))
  const yaml = fs.readFileSync(wf.file, 'utf8').split('\n')
  const d = blockDetails(wf, { readFile: readFs, root: repo })

  const plan = d.nodes.plan
  assert.equal(plan.kind, 'ai')
  assert.equal(plan.agent, 'planner')
  assert.equal(plan.file, 'dev/agents/planner.md')
  assert.match(plan.prompt as string, /You are the planner/)
  assert.match(plan.prompt as string, /## Output/, 'prompt includes the output-schema instruction')
  assert.deepEqual(plan.outcomes, ['ready', 'needs-human'])
  assert.deepEqual(plan.listens, ['card-info.done'])
  assert.ok(plan.emits.includes('plan.ready') && plan.emits.includes('plan.timeout'))
  assert.equal(plan.source.workflow, 'dev/workflow.yaml')
  assert.match(yaml[plan.source.line! - 1], /^ {2}plan:/, 'source.line points at the step key')

  const script = d.nodes['card-info']
  assert.equal(script.kind, 'script')
  assert.equal(script.file, 'dev/scripts/card_info.sh')
  assert.equal(script.code, fs.readFileSync(path.join(repo, 'dev/scripts/card_info.sh'), 'utf8'))
  assert.deepEqual(script.listens, ["card.moved if event.data.to == 'Planning'"])

  const confirm = d.nodes.confirm
  assert.equal(confirm.kind, 'human')
  assert.deepEqual(confirm.resumeOn, ['card.moved'])
  assert.deepEqual(confirm.rules, [
    { outcome: 'approved', when: "event.data.to == 'Ready'", terminal: false },
    { outcome: 'rejected', when: "event.data.to == 'Backlog'", terminal: true },
  ])
  assert.deepEqual(confirm.plain, [
    'Waits for card.moved',
    `Goes on as "approved" when event.data.to == 'Ready'`,
    `Ends the run as "rejected" when event.data.to == 'Backlog'`,
    'Stops the run as "timeout" after 1w',
  ])

  const board = d.nodes.board
  assert.equal(board.kind, 'trigger')
  assert.equal(board.emit, 'card.moved')
  assert.equal((board.config as { author: string }).author, 'user')
  assert.match(yaml[board.source.line! - 1], /^ {2}board:/)

  const planner = d.agents.planner
  assert.equal(planner.kind, 'agent')
  assert.equal(planner.file, 'dev/agents/planner.md')
  assert.match(planner.persona as string, /^You are the planner/, 'persona is the body, frontmatter stripped')
  assert.equal((planner.frontmatter as { model: string }).model, 'opus')
  assert.ok(Array.isArray((planner.frontmatter as { tools: string[] }).tools))
  assert.deepEqual(planner.steps, ['plan'])
})

test('fixture: gate default, legacy role, big script is truncated, inline prompt', () => {
  const dir = '/wf'
  const files: Record<string, string> = {
    '/wf/workflow.yaml': [
      'name: fx',
      'triggers:',
      '  hook: { on: webhook, path: /in }',
      'steps:',
      '  check:',
      '    on: hook',
      '    gate:',
      "      big: \"event.data.n > 10\"",
      '      default: small',
      '    terminal: [small]',
      '  judge:',
      '    on: check.big',
      '    ai: { role: judge, output: { type: object, properties: { outcome: { enum: [ok] } } } }',
      '  say:',
      '    on: judge.ok',
      '    ai: { prompt: "Say hi.", output: { type: object, properties: { outcome: { enum: [done] } } } }',
      '  big:',
      '    on: say.done',
      '    run: ./run.sh',
    ].join('\n'),
    '/wf/roles/judge.md': 'You judge.',
    '/wf/run.sh': 'x'.repeat(25_000),
  }
  const def = parseWorkflow(files['/wf/workflow.yaml'])
  const wf = { def, file: '/wf/workflow.yaml', dir, roles: { judge: 'You judge.' }, agents: resolveAgents(def, '/nonexistent') }
  const d = blockDetails(wf, { readFile: (p) => files[p] })

  assert.deepEqual(d.nodes.check.plain, ['Goes on as "big" when event.data.n > 10', 'Ends the run as "small" otherwise'])
  assert.equal(d.nodes.check.source.line, 5)
  assert.equal(d.nodes.judge.file, 'roles/judge.md')
  assert.match(d.nodes.judge.prompt as string, /^You judge\./)
  assert.match(d.nodes.say.prompt as string, /^Say hi\./)
  assert.equal(d.agents.judge.persona, 'You judge.')
  assert.deepEqual(d.agents.judge.steps, ['judge'])
  assert.equal(d.nodes.big.file, 'run.sh')
  assert.equal((d.nodes.big.code as string).length, 20_000)
  assert.equal(d.nodes.big.truncated, true)
  assert.equal(d.nodes.hook.kind, 'trigger')
})

test('keyLines ignores deeper keys and comments', () => {
  const lines = keyLines(['steps:', '  # a comment', '  a:', '    on: x', '    ai:', '      agent: b', '  "c-d":', 'agents:', '  b: {}'].join('\n'))
  assert.deepEqual(lines, { steps: { a: 3, 'c-d': 7 }, agents: { b: 9 } })
})

test('keyRanges: a block ends before its next sibling, trailing blanks and banner comments go to what follows', () => {
  const r = keyRanges(['steps:', '  a:', '    on: x', '', '  # ── next ──', '  b:', '    run: y', 'agents:', '  c: {}', ''].join('\n'))
  assert.deepEqual(r, { steps: { a: { start: 2, end: 3 }, b: { start: 6, end: 7 } }, agents: { c: { start: 9, end: 9 } } })
})

test('dev/workflow.yaml: detail.yaml is the block range; workflowFiles has every file behind the workflow', () => {
  const wf = loadWorkflow(path.join(repo, 'dev/workflow.yaml'))
  const yaml = fs.readFileSync(wf.file, 'utf8').split('\n')
  const d = blockDetails(wf, { readFile: readFs, root: repo })
  const plan = d.nodes.plan.yaml!
  assert.equal(plan.start, d.nodes.plan.source.line)
  assert.match(yaml[plan.start - 1], /^ {2}plan:/)
  assert.match(yaml[plan.end - 1], /^ {4}timeout: 1h/, 'plan ends at its last line, not the blank before move-planned')
  assert.match(yaml.slice(plan.end).find((l) => l.trim())!, /^ {2}move-planned:/)
  assert.equal(d.agents.planner.yaml, undefined, 'an agent that lives only in agents/planner.md has no yaml range')

  const { files, truncated } = workflowFiles(wf, d, { readFile: readFs, root: repo })
  const paths = Object.keys(files)
  for (const p of ['dev/workflow.yaml', 'dev/agents/planner.md', 'dev/agents/builder.md', 'dev/scripts/card_info.sh']) assert.ok(paths.includes(p), p)
  assert.equal(files['dev/workflow.yaml'], yaml.join('\n'))
  assert.deepEqual(truncated, [])
})
