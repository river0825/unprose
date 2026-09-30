// MCP stdio server — the agent's hands on the canvas. Thin over the HTTP API so
// the browser UI and the agent share one store.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { CanvasClient, canvasOrigin, probeCanvas } from './client.js'
import { diagramKinds } from './templates/index.js'
import type { Author, DiagramKind, Op } from './model.js'

const kindEnum = z.enum(diagramKinds as [DiagramKind, ...DiagramKind[]])

const CONTENT_HELP = `content shape per kind (see docs/canvas.md for full examples):
- event-storming (Introducing EventStorming; docs/diagrams.md §3 — every element may carry \`id\`, references are ids or texts; drawn left → right in time): { level: 'big-picture'|'process'|'software', lanes?: string[], people?: (string|{id,text})[], systems?: [{id?, text, external?, raises?}], events: [{id?, text, lane?, phase?, pivotal?, time?, recurring?, person?, aggregate?}], commands?: [{id?, text, by?: <person>, system?: <system>, produces: <event> | <event>[] (several = branches, happy path first), aggregate?}], policies?: [{id?, text, when: <event>|<event>[], then: <command>, person?}], readModels?: [{id?, text, updatedBy?: <event>|<event>[], informs?: <person|command>}], hotspots?: [{text, on: <element>}], opportunities?: [{text, on}], values?: [{text, on, sign: '+'|'-'}], votes?: [{on, count}], milestones?: [{text, before: <event>}], phases?: [{text, from, to}], definitions?: [{term, text}], aggregates?: string[] }  — the grammar: a system between a command and its event, a policy between an event and the next command. The older shape (commands[].event, readModels[].for, externals, hotspots[].near) still works. Prefer \`awd design draw design/<name>.es.yaml\` so the file stays the truth.
- user-story-map: { activities: [{id?, text, steps: [{id?, text, stories: [{id?, text, release?, acceptance?: string[], traces?: [{from: '<diagram key>/<element id>', rel: 'derived-from'|'groups'|'shows'}]}]}]}], releases?: string[] }  (releases are cut lines, top to bottom)
- user-journey: { persona, stages: [{text, actions?, touchpoints?, emotion: -2..2, pains?, opportunities?}] }
- wireframe: { screens: [{name, w?, elements: [{role: box|button|input|heading|paragraph|image|nav|list|table|label, text?, x: 0..11, y: row, w: 1..12, h?: rows, note?}]}] }
- workflow: { name?, nodes: [{id, kind: trigger|script|ai|gate|human|outcome, label?, config?}], edges: [{from, to, label?, condition?}] }  (the output of \`awd graph --json\`)
- domain-story (Domain Storytelling, domainstorytelling.org; docs/diagrams.md §6b — pictographic sentences read left → right by number): { scope?: { granularity?: 'coarse-grained'|'medium-grained'|'fine-grained', time?: 'as-is'|'to-be', purity?: 'pure'|'digitalized' }, actors: (string|{id?, text, kind?: 'person'|'group'|'system'})[], workObjects?: (string|{id?, text, kind?: 'document'|'thing'|'digital'|'email'|'call'|'conversation'|'info'|'folder'})[], sentences: [{id?, seq?, actor, verb, object?, to?: <actor>|<actor>[], toLabel?, note?, traces?}], groups?: [{id?, text, members: <element>[]}], annotations?: [{on: <element>, text}] }  — every actor appears once, every activity gets its own work object. Prefer \`awd design draw design/<name>.domain-story.yaml\`; \`awd design import-egon\` / \`export-egon\` move stories to and from Egon.io.
- kanban: { columns: [{name, wip?}], cards: [{id?, title, column, labels?, size?: XS|S|M|L|XL, assignee?, description?}] }  — columns are lanes, cards stack inside; a card's column is its parent. When the user drags a card to another column, canvas_diff / canvas_wait report \`card "<title>" [<id>]: moved from <A> → <B>\`; the workflow runtime reads the same moves from GET /api/boards/:id/cards?since=N. Use kanban to replace Trello as the source of events.
- freeform: { items: [{type?: sticky|text|frame|lane|arrow|comment|card, text?, x?, y?, w?, h?, color?, role?, parent?, from?, to?, target?}] }`

const LOOP_HELP = `The alignment loop: 1) canvas_create_board (or canvas_add_items) to draw; 2) tell the user the URL and what to look at — and call canvas_focus so their page jumps there instead of making them search; 3) canvas_wait to block until they move/annotate something; 4) read the returned diff lines (or canvas_diff / canvas_read_board) and react — answer comments with canvas_add_items comment items, redraw, or change the underlying plan. Always remember the \`seq\` you last saw and pass it as \`since\`.`

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })

/**
 * The project an agent session works in: \`CLAUDE_PROJECT_DIR\` (set by Claude Code), else the working
 * directory — lifted to its git top level. None for the home directory or the filesystem root (a
 * session there belongs to no project, so its boards stay personal).
 */
export function sessionProjectRoot(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd(), home = os.homedir()): string | undefined {
  const start = path.resolve(env.CLAUDE_PROJECT_DIR || cwd)
  for (let d = start; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d
    if (path.dirname(d) === d) break
  }
  if (start === path.resolve(home) || path.dirname(start) === start) return undefined
  return start
}

export interface McpOptions {
  /** The session's project id on this canvas: new boards go there, and board lists show its boards first. */
  project?: string
}

export function createMcpServer(client = new CanvasClient(), opts: McpOptions = {}): McpServer {
  const server = new McpServer({ name: 'awd-canvas', version: '0.4.0' }, { instructions: `Shared visual canvas between you and the user. ${LOOP_HELP}` })

  server.registerTool(
    'canvas_list_boards',
    {
      title: 'List boards',
      description: `List boards with id, kind, title, current seq and project. By default only this session's project${opts.project ? ` (${opts.project})` : ''}; pass all: true for every project (and the personal space).`,
      inputSchema: { all: z.boolean().default(false).describe('List the boards of every project, not only this session\'s') },
    },
    async ({ all }) => {
      const only = all ? undefined : opts.project
      const boards = await client.listBoards(only)
      if (!boards.length) return text(only ? `(no boards in project ${only} yet — create one with canvas_create_board, or list all: true)` : '(no boards yet — create one with canvas_create_board)')
      return text(boards.map((b) => `${b.id}\t${b.kind}\tseq ${b.seq}\t${b.items} items\t[${b.project ?? 'personal'}]\t${b.title}\t${client.boardUrl(b.id)}`).join('\n'))
    },
  )

  server.registerTool(
    'canvas_create_board',
    {
      title: 'Create a board from structured content',
      description: `Draw a new diagram for the user. You give structured content; the template computes the layout (never pixels). Returns id, url and seq. Then tell the user the URL. ${LOOP_HELP}\n\n${CONTENT_HELP}`,
      inputSchema: {
        title: z.string().describe('Board title shown to the user'),
        kind: kindEnum,
        content: z.record(z.string(), z.unknown()).describe('Structured content for the kind (see description)'),
        meta: z.record(z.string(), z.unknown()).optional().describe('Free board metadata, e.g. { source: "workflow.yaml" }'),
        project: z.string().optional().describe(`Project id to store the board in (its <project>/.unprose/boards/); default: this session's project${opts.project ? ` (${opts.project})` : ''}, 'personal' for none`),
      },
    },
    async ({ title, kind, content, meta, project }) => {
      const board = await client.createBoard({ title, kind, content, meta, author: 'agent', ...((project ?? opts.project) ? { project: project ?? opts.project } : {}) })
      const n = Object.keys(board.items).length
      const url = client.boardUrl(board.id)
      // Open it for the person right away so they never have to copy a URL.
      if (process.platform === 'darwin' && process.env.AWD_CANVAS_NO_OPEN !== '1') execFile('open', [url], () => {})
      return text(`created board ${board.id} (${kind}, ${n} items, seq ${board.seq}) and opened it in the browser\nurl: ${url}\nNow call canvas_wait with since=${board.seq} — the UI shows "agent is watching" while you do.`)
    },
  )

  server.registerTool(
    'canvas_read_board',
    {
      title: 'Read a board',
      description: "Read a board. format 'outline' (default) is a compact text rendering grouped by lanes/frames with arrows and comments — use it to see what the user sees. 'json' returns the raw items (ids, geometry) when you need to reference or patch specific items.",
      inputSchema: { id: z.string(), format: z.enum(['outline', 'json']).default('outline') },
    },
    async ({ id, format }) => {
      if (format === 'json') return text(JSON.stringify(await client.getBoard(id), null, 1))
      return text(await client.outline(id))
    },
  )

  server.registerTool(
    'canvas_apply',
    {
      title: 'Apply raw ops',
      description: "Apply raw ops as the agent: add {kind:'add', item}, update {kind:'update', id, patch}, remove {kind:'remove', id}. Items: {id, type: sticky|text|frame|lane|arrow|comment|card|wireframe, x,y,w,h, text?, color?, role?, parent?, from?, to?, label?, target?, data?}. Prefer canvas_add_items for anything a template covers; use this for precise edits (rename, recolour, move, delete, reply to a comment).",
      inputSchema: {
        id: z.string(),
        ops: z.array(z.record(z.string(), z.unknown())).min(1),
        note: z.string().optional().describe('One line shown in the change feed, e.g. "answered the hotspot about sizing"'),
      },
    },
    async ({ id, ops, note }) => {
      const r = await client.apply(id, ops as unknown as Op[], 'agent', note)
      return text(`applied ${ops.length} op(s); board seq is now ${r.seq}`)
    },
  )

  server.registerTool(
    'canvas_add_items',
    {
      title: 'Render a template onto an existing board',
      description: `Render structured content with a template and apply it to an existing board (add, or update items whose deterministic ids already exist — re-rendering the same content updates in place). Use \`at\` to place it beside existing items and \`scope\` to keep separate renders apart. To reply to a user's comment or annotate an item, use kind 'freeform' with a comment item: { items: [{ type: 'comment', text: '...', target: '<item id>' }] } — leave x/y out and the server places it beside the target without covering anything.\n\n${CONTENT_HELP}`,
      inputSchema: {
        id: z.string(),
        kind: kindEnum.optional().describe("Defaults to the board's kind"),
        content: z.record(z.string(), z.unknown()),
        at: z.object({ x: z.number(), y: z.number() }).optional(),
        scope: z.string().optional().describe('Id prefix; different scopes never collide'),
        note: z.string().optional(),
      },
    },
    async ({ id, kind, content, at, scope, note }) => {
      const { ops } = await client.template(id, kind, content, at, scope)
      if (!ops.length) return text('template produced no items')
      const r = await client.apply(id, ops, 'agent', note)
      return text(`rendered ${ops.length} item(s) (${ops.filter((o) => o.kind === 'add').length} new); board seq is now ${r.seq}`)
    },
  )

  server.registerTool(
    'canvas_diff',
    {
      title: 'What changed since seq',
      description: "Human-readable lines describing every change after `since` (moves between lanes, added comments, renames, deletions…). By default only the user's changes are returned; pass author 'agent' or omit filtering with author 'all'.",
      inputSchema: {
        id: z.string(),
        since: z.number().int().min(0),
        author: z.enum(['user', 'agent', 'all']).default('user'),
      },
    },
    async ({ id, since, author }) => {
      const r = await client.diff(id, since, author === 'all' ? undefined : (author as Author))
      if (!r.count) return text(`no ${author === 'all' ? '' : author + ' '}changes since seq ${since} (board seq ${r.seq})`)
      return text(`${r.count} change(s), board seq now ${r.seq}:\n${r.lines.join('\n')}`)
    },
  )

  server.registerTool(
    'canvas_wait',
    {
      title: 'Wait for the user to change the board',
      description: 'Block until the user has changed something after `since` AND stopped for `quietSec` (default 2.5 s) — or pressed "Hand to agent" in the UI, which returns at once. `wake` decides what counts: \'meaningful\' (default) wakes on comments, adds, removals, renames, connections, recolours and handoff, while pure moves/resizes/reroutes neither wake you nor restart the quiet window — they ride along collapsed into one "moved N items: …" line; \'any\' wakes on every change with one line each; \'handoff\' waits for the "Hand to agent" button only. Times out after timeoutSec (max 120; call again with the same `since` to keep waiting). Returns the diff lines and the new seq. While you wait the UI shows "agent is watching", so call this right after drawing.',
      inputSchema: {
        id: z.string(),
        since: z.number().int().min(0),
        timeoutSec: z.number().min(1).max(120).default(60),
        quietSec: z.number().min(0).max(30).default(2.5),
        wake: z.enum(['meaningful', 'any', 'handoff']).default('meaningful'),
      },
    },
    async ({ id, since, timeoutSec, quietSec, wake }) => {
      const r = await client.wait(id, since, timeoutSec * 1000, 'user', quietSec * 1000, wake)
      if (r.timedOut) return text(`no user changes in ${timeoutSec}s (board seq ${r.seq}). Call canvas_wait again with since=${since} to keep waiting, or continue.`)
      return text(`user changed the board (seq ${r.seq}):\n${r.lines.join('\n')}`)
    },
  )

  server.registerTool(
    'canvas_focus',
    {
      title: 'Show the person something on the board',
      description:
        'Use this whenever you ask the person to look at something ("see the Q1–Q4 cards in the 要你決定 column"). Their open page shows "Agent wants to show you …" with a Go button (or jumps at once if they turned on Follow agent) and fits the view to those items. Pass item `ids` and/or a diagram `frame` key; `note` says why (one line). Nothing is stored on the board. Returns how many pages received it and a link that opens right there (share it in your reply too).',
      inputSchema: {
        id: z.string().describe('board id'),
        ids: z.array(z.string()).optional().describe('item ids to bring into view'),
        frame: z.string().optional().describe('diagram frame key, e.g. "studio-es"'),
        note: z.string().max(500).optional(),
      },
    },
    async ({ id, ids, frame, note }) => {
      const r = await client.focus(id, { ids, frame, note })
      const link = client.boardUrl(id, frame && !ids?.length ? { frame } : { focus: r.focus.ids[0], ...(frame ? { frame } : {}) })
      return text(r.viewers ? `shown on ${r.viewers} open page(s). Link: ${link}` : `no page has this board open right now — send the person this link instead: ${link}`)
    },
  )

  server.registerTool(
    'canvas_open',
    { title: 'Open a board in the browser', description: 'Print the board URL and open it in the default browser (macOS).', inputSchema: { id: z.string() } },
    async ({ id }) => {
      const url = client.boardUrl(id)
      if (process.platform === 'darwin') execFile('open', [url], () => {})
      return text(url)
    },
  )

  return server
}

export async function runMcp(): Promise<void> {
  // Fail with the reason, not as a bare "Connection closed" in the agent (river0825/unprose#5).
  const raw = process.env.AWD_CANVAS_URL ?? 'http://localhost:4400'
  let base: string
  try {
    base = canvasOrigin(raw)
  } catch {
    process.stderr.write(`awd-canvas MCP: AWD_CANVAS_URL "${raw}" is not a URL. Set it to the canvas address, e.g. http://localhost:4400 or https://canvas.example.com\n`)
    process.exit(2)
  }
  const probe = await probeCanvas(base)
  if (!probe.ok) {
    process.stderr.write(`awd-canvas MCP: cannot reach ${base} (${probe.reason}). Start the canvas (\`npm start\`) or set AWD_CANVAS_URL to where it runs.\n`)
    process.exit(1)
  }
  process.env.AWD_CANVAS_URL = base
  // Boards this session creates belong to its project (stored in <project>/.unprose/boards/). Only a
  // canvas on this machine accepts the registration; elsewhere the boards stay in its personal space.
  let project: string | undefined
  const root = sessionProjectRoot()
  if (root) {
    try {
      project = (await new CanvasClient(base).registerProject(root)).id
    } catch (e) {
      process.stderr.write(`awd-canvas MCP: boards stay in the canvas's personal space (${root} not registered: ${(e as Error).message})\n`)
    }
  }
  const server = createMcpServer(new CanvasClient(base), { project })
  await server.connect(new StdioServerTransport())
}
