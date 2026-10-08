import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CanvasClient, MemoryBoardRepository, createMcpServer, startServer, type RunningServer } from '@awd/canvas'
import { registerDesignTools } from '../src/mcp.js'
import { START_PROMPTS, commandFile, promptText } from '../src/prompts.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
let srv: RunningServer
let client: Client
let project: string
const savedUrl = process.env.AWD_CANVAS_URL

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean }
const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as ToolResult
const textOf = (r: ToolResult) => r.content.map((c) => c.text).join('\n')

before(async () => {
  srv = await startServer({ port: 0, store: new MemoryBoardRepository(), webDist: '/nonexistent' })
  process.env.AWD_CANVAS_URL = srv.url // drawDesign talks to the canvas the server would
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'unprose-mcp-'))
  fs.mkdirSync(path.join(project, 'design'))
  fs.copyFileSync(path.join(repo, 'design/studio.es.yaml'), path.join(project, 'design/studio.es.yaml'))
  fs.writeFileSync(path.join(project, 'design/bad.es.yaml'), 'kind: event-storming\nkey: bad\ncontent:\n  level: process\n  events: nope\n')
  const server = createMcpServer(new CanvasClient(srv.url), { extend: (s) => registerDesignTools(s, { cwd: project }) })
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
})

after(async () => {
  await client?.close()
  await srv?.close()
  if (savedUrl === undefined) delete process.env.AWD_CANVAS_URL
  else process.env.AWD_CANVAS_URL = savedUrl
})

test('the server is called unprose and says what it is for', () => {
  assert.equal(client.getServerVersion()?.name, 'unprose')
  assert.match(client.getInstructions() ?? '', /shared canvas where the person and you talk designs through/)
  assert.match(client.getInstructions() ?? '', /unprose_help/)
})

test('it lists the canvas tools, the design tools and unprose_help', async () => {
  const names = (await client.listTools()).tools.map((t) => t.name)
  for (const n of ['unprose_help', 'canvas_create_board', 'canvas_wait', 'canvas_focus', 'design_lint', 'design_draw', 'design_propose_stories', 'design_egon', 'canvas_files', 'canvas_propose_edit']) assert.ok(names.includes(n), n)
  // 14 before proposals (canvas_files, canvas_propose_edit), 16 before several agents (canvas_context, canvas_ask, unprose_feedback[_list]), 20 before seeing the board (canvas_snapshot, canvas_check_layout, canvas_approve), 23 before handing files over (canvas_handover); keep it short
  assert.ok(names.includes('canvas_handover'))
  assert.ok(names.length <= 24, `a short tool list (${names.length})`)
})

test('unprose_help explains the diagrams, the tools and how to start', async () => {
  const t = textOf(await call('unprose_help'))
  for (const s of ['EventStorming', 'Story map', 'Domain Storytelling', 'design_draw', 'canvas_wait', '/unprose:eventstorm', srv.url]) assert.ok(t.includes(s), s)
  assert.match(t, /MCP prompts on this server: help, eventstorm/)
})

test('design_lint and design_draw work on files relative to the project', async () => {
  assert.match(textOf(await call('design_lint', { file: 'design/studio.es.yaml' })), /✔ studio\.es\.yaml \(event-storming/)
  const bad = await call('design_draw', { file: 'design/bad.es.yaml', board: 'title:MCP test' })
  assert.equal(bad.isError, true)
  assert.match(textOf(bad), /not drawn|events/)
  const ok = await call('design_draw', { file: 'design/studio.es.yaml', board: 'title:MCP test' })
  assert.notEqual(ok.isError, true, textOf(ok))
  const m = textOf(ok).match(/\/b\/(b_[a-z0-9]+)\?frame=/)
  assert.ok(m, textOf(ok))
  const board = await new CanvasClient(srv.url).getBoard(m[1])
  assert.ok(Object.values(board.items).some((it) => it.type === 'frame'), 'the frame is on the board')
  const missing = await call('design_lint', { file: 'design/nope.es.yaml' })
  assert.equal(missing.isError, true)
  // the redraw preview (docs/diagrams.md "What a redraw keeps"): a plan, and nothing written
  const before = (await new CanvasClient(srv.url).getBoard(m[1])).seq
  const dry = textOf(await call('design_draw', { file: 'design/studio.es.yaml', board: 'title:MCP test', dryRun: true }))
  assert.match(dry, /^Redraw preview — studio-es from (design\/)?studio\.es\.yaml on "MCP test" .*\(dry run: nothing written\)\n {2}\d+ unchanged/)
  assert.equal((await new CanvasClient(srv.url).getBoard(m[1])).seq, before, 'a dry run writes nothing')
  const none = textOf(await call('design_draw', { file: 'design/studio.es.yaml', board: 'title:Never drawn', dryRun: true }))
  assert.match(none, /no board title:Never drawn yet/)
  assert.equal((await new CanvasClient(srv.url).listBoards()).some((b) => b.title === 'Never drawn'), false, 'and creates no board')
})

test('the start prompts are offered and fill in the topic', async () => {
  const names = (await client.listPrompts()).prompts.map((p) => p.name)
  assert.deepEqual(names, START_PROMPTS.map((p) => p.name))
  const r = await client.getPrompt({ name: 'eventstorm', arguments: { topic: 'our refund process' } })
  const t = (r.messages[0].content as { text: string }).text
  assert.match(t, /EventStorming with me on the Unprose canvas about: our refund process\./)
  assert.match(promptText(START_PROMPTS.find((p) => p.name === 'kanban')!), /the first release of the story map/)
})

test('the plugin slash commands are the prompts (npm run gen:commands)', () => {
  const dir = path.join(repo, 'commands')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
  assert.deepEqual(files, START_PROMPTS.map((p) => `${p.name}.md`).sort(), 'run npm run gen:commands')
  for (const p of START_PROMPTS) assert.equal(fs.readFileSync(path.join(dir, `${p.name}.md`), 'utf8'), commandFile(p), `commands/${p.name}.md is stale — run npm run gen:commands`)
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin/plugin.json'), 'utf8'))
  assert.equal(manifest.mcpServers.unprose.env.UNPROSE_MCP_PROMPTS, '0', 'the plugin has slash commands, so it turns the MCP prompts off')
})
