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
- ui-mock (docs/diagrams.md §6c — real-looking screens, one board item per element; no HTML): { device?: desktop|laptop|tablet|phone, theme?: light|dark, tokens?: { accent?: '#hex', radius?, font?: sans|serif|mono|rounded }, screens: [{ id?, name, device?, theme?, w?, h?, pad?, gap?, note?, traces?, body: [<node>] }], flows?: [{ from: '<screen>' | '<screen>/<element>', to: '<screen>', label? }] }; <node> = { type, id?, text?, children?, …props } — layout: stack | row (children take span: 1..12, w, or share the rest; justify: start|center|end|between; align) | grid (cols); drawn containers: card (text = title; variant flat|elevated) | section (pad 24, bg: surface|muted|accent) | navbar (text = brand, items = links, active, children at the right); elements: heading (level 1..4) | text (variant muted|small|code) | link | button (variant primary|secondary|ghost|danger|link, icon, size sm|md|lg) | input | textarea | select | search (label/text, placeholder, value, hint) | checkbox | radio | toggle (checked) | badge (tone neutral|info|success|warning|danger) | avatar | icon | divider | image (ratio '16:9', h) | table (columns, rows; a cell '[Done]' is a status badge) | list (items: [text | {text, meta, icon, badge}]) | stat (value, delta) | alert (tone) | progress (value 0..100) | tabs | breadcrumb (items, active) | pagination | spacer | empty | chart (variant bar|line, rows: [[numbers]]) | sidebar (items with icon/badge, active). Every node may carry note, goto: <screen id>, traces. Element ids are unique per screen and referenced as '<screen>/<element>'. Prefer \`awd design draw design/<name>.ui.yaml\`; changes on the board come back as proposals with a diff to apply, until you edit the file and redraw: words edited (data.pending.kind 'text'; a table cell or list item adds sub: ['rows', r, c] | ['items', i]), an element deleted (kind 'remove' — it stays on the board, struck), an element added (kind 'add' with node { type, id, text } — write it with that id, at the end of parent.element or right after after.element). Lint findings are on the elements as data.ui.findings.
- workflow: { name?, nodes: [{id, kind: trigger|script|ai|gate|human|outcome, label?, config?}], edges: [{from, to, label?, condition?}] }  (the output of \`awd graph --json\`)
- domain-story (Domain Storytelling, domainstorytelling.org; docs/diagrams.md §6b — pictographic sentences read left → right by number): { scope?: { granularity?: 'coarse-grained'|'medium-grained'|'fine-grained', time?: 'as-is'|'to-be', purity?: 'pure'|'digitalized' }, actors: (string|{id?, text, kind?: 'person'|'group'|'system'})[], workObjects?: (string|{id?, text, kind?: 'document'|'thing'|'digital'|'email'|'call'|'conversation'|'info'|'folder'})[], sentences: [{id?, seq?, actor, verb, object?, to?: <actor>|<actor>[], toLabel?, note?, traces?}], groups?: [{id?, text, members: <element>[]}], annotations?: [{on: <element>, text}] }  — every actor appears once, every activity gets its own work object. Prefer \`awd design draw design/<name>.domain-story.yaml\`; \`awd design import-egon\` / \`export-egon\` move stories to and from Egon.io.
- kanban: { columns: [{name, wip?}], cards: [{id?, title, column, labels?, size?: XS|S|M|L|XL, assignee?, description?}] }  — columns are lanes, cards stack inside; a card's column is its parent. When the user drags a card to another column, canvas_diff / canvas_wait report \`card "<title>" [<id>]: moved from <A> → <B>\`; the workflow runtime reads the same moves from GET /api/boards/:id/cards?since=N. Use kanban to replace Trello as the source of events.
- freeform: { items: [{type?: sticky|text|frame|lane|arrow|comment|card, text?, x?, y?, w?, h?, color?, role?, parent?, from?, to?, target?}] }`

const LOOP_HELP = `The alignment loop: 1) canvas_create_board (or canvas_add_items) to draw; 2) tell the user the URL and what to look at — and call canvas_focus so their page jumps there instead of making them search; 3) canvas_wait to block until they move/annotate something; 4) read the returned diff lines (or canvas_diff / canvas_read_board) and react — answer comments with canvas_add_items comment items, redraw, or change the underlying plan. Always remember the \`seq\` you last saw and pass it as \`since\`.`

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })

/** What Unprose is for, in the words an agent can pass on to the person (the server instructions open with it). */
const ABOUT = `Unprose: a shared canvas where the person and you talk designs through. Files are the truth (design/<name>.<kind>.yaml), you edit them, the person directs; edits the person makes on the canvas are proposals to discuss first.`

const DIAGRAMS = `Diagrams (one file each, drawn as a frame on a board):
- EventStorming — design/<name>.es.yaml — a flow in time: events, commands, people, systems, policies, hotspots (Introducing EventStorming)
- Story map — design/<name>.story-map.yaml — scope and releases; stories can be proposed from EventStorming or a domain story
- Kanban — design/<name>.kanban.yaml — the work; cards trace to stories
- Wireframe — design/<name>.wireframe.yaml — one page or screen on a 12-column grid
- UI mock — design/<name>.ui.yaml — real-looking screens (desktop / tablet / phone) from a component tree; the person comments on single elements, words edited on the board are proposals with a diff
- Domain Storytelling — design/<name>.domain-story.yaml — who does what with what, numbered sentences; Egon.io import/export
- Journey — design/<name>.journey.yaml — a persona's stages, emotions, pains
- Workflow — an agent pipeline (workflow yaml)
Link elements across diagrams with \`traces\` (derived-from, groups, shows, relates).`

/** The \`unprose_help\` answer: what Unprose can do and how to start. */
export function helpText(o: { designTools: boolean; prompts: string[]; canvas: string; version?: string; remote?: boolean }): string {
  const tools = [
    'Boards: canvas_list_boards, canvas_create_board, canvas_read_board, canvas_open',
    'Drawing: canvas_add_items (sticky notes, comments, any template), canvas_apply (raw ops)',
    'Conversation: canvas_wait (block until the person comments or hands over), canvas_diff (what changed since a seq), canvas_focus (take the person\'s page to an item or frame)',
    `Proposals: canvas_files (the files behind a board — workflow yaml, agents, scripts, design files — with their base sha-1), canvas_propose_edit (a unified diff or the whole new text → a proposal the person discusses in a thread on the block; ${o.remote ? 'this canvas is not on your machine, so this is how you change a file' : 'for files you cannot write yourself'}). Whoever has the files applies it after the person agrees`,
    ...(o.designTools && o.remote ? ['Diagram files: design_lint (schema + grammar), design_draw (file → frame, keeps the person\'s layout), design_propose_stories (EventStorming / domain story → story proposals) — this canvas is not on your machine, so pass each file\'s text as `content` and its name as `name`'] : o.designTools ? ['Diagram files: design_lint (schema + grammar), design_draw (file → frame, keeps the person\'s layout), design_propose_stories (EventStorming / domain story → story proposals), design_egon (Egon.io import / export)'] : []),
  ]
  return [
    ABOUT,
    '',
    DIAGRAMS,
    '',
    'Tools:',
    ...tools.map((t) => `- ${t}`),
    '',
    `The loop: ${LOOP_HELP}`,
    '',
    'Ways to start (Claude Code slash commands; other agents get the same as MCP prompts):',
    '- /unprose:eventstorm <topic> — run an EventStorming on the canvas',
    '- /unprose:storymap — turn the EventStorming into a story map with a first release',
    '- /unprose:kanban — a kanban of a release\'s stories',
    '- /unprose:wireframe <page> — sketch a page',
    '- /unprose:mockup <screen> — mock a screen as real-looking UI',
    '- /unprose:domain-story <topic> — tell a process as a domain story',
    '- /unprose:review — answer every open comment on a board',
    ...(o.prompts.length ? [`MCP prompts on this server: ${o.prompts.join(', ')}`] : []),
    '',
    `Canvas: ${o.canvas}${o.version ? ` (v${o.version})` : ''}. Docs: https://github.com/river0825/unprose`,
    'Proposals and saving: files stay the truth. An agent that cannot write the files behind a board proposes (canvas_files → canvas_propose_edit); the person discusses it in the thread; the agent that has the files — studio\'s session on the canvas machine, or the person\'s own Claude Code — applies it after they agree (checking the file still has the base sha-1), lints, tests and redraws. Watch for proposals from other agents with canvas_wait({ from: "others" }).',
    'Remote agents: another machine or a cloud agent connects to <canvas>/mcp — with OAuth (the person approves it on the canvas, typing the code the agent shows) or with a token from the canvas page Connected agents. Changes are signed with the agent\'s name.',
  ].join('\n')
}

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
  /** Open new boards in the browser on this machine (macOS); off for the canvas's remote /mcp endpoint. */
  openBrowser?: boolean
  /** Served by the canvas itself at /mcp to an agent elsewhere (docs/canvas.md "Remote agents"). */
  remote?: boolean
  /** More tools and prompts (the \`awd\` CLI adds the design_* tools and the prompts); runs after the canvas tools. */
  extend?: (server: McpServer, ctx: { client: CanvasClient; project?: string }) => { designTools?: boolean; prompts?: string[] } | void
}

export function createMcpServer(client = new CanvasClient(), opts: McpOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'unprose', version: '0.8.1' },
    { instructions: `${ABOUT} When the person asks what Unprose can do, or how to start, call unprose_help. ${LOOP_HELP}` },
  )
  let extra: { designTools?: boolean; prompts?: string[] } = {}

  server.registerTool(
    'unprose_help',
    {
      title: 'What Unprose can do',
      description: 'What Unprose can do — the diagrams, the tools, the comment loop and the ways to start (slash commands / prompts). Call it when the person asks what Unprose is, what it can do, or how to begin; pass the answer on in their language.',
      inputSchema: {},
    },
    async () => {
      const version = await fetch(`${client.baseUrl}/api/version`, { signal: AbortSignal.timeout(2000) })
        .then((r) => (r.ok ? (r.json() as Promise<{ version?: string }>) : {}))
        .then((j) => (j as { version?: string }).version)
        .catch(() => undefined)
      return text(helpText({ designTools: !!extra.designTools, prompts: extra.prompts ?? [], canvas: client.publicUrl, version, remote: opts.remote }))
    },
  )

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
      // Open it for the person right away so they never have to copy a URL (only when the canvas is on this machine).
      const opened = opts.openBrowser !== false && process.platform === 'darwin' && process.env.AWD_CANVAS_NO_OPEN !== '1'
      if (opened) execFile('open', [url], () => {})
      return text(`created board ${board.id} (${kind}, ${n} items, seq ${board.seq})${opened ? ' and opened it in the browser' : ' — give the person this link'}\nurl: ${url}\nNow call canvas_wait with since=${board.seq} — the UI shows "agent is watching" while you do.`)
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
      description: "Human-readable lines describing every change after `since` (moves between lanes, added comments, renames, deletions…). By default only the user's changes are returned; author 'others' adds the other agents' changes (never your own — for several agents on one board), 'agent' every agent's, 'all' everything.",
      inputSchema: {
        id: z.string(),
        since: z.number().int().min(0),
        author: z.enum(['user', 'others', 'agent', 'all']).default('user'),
      },
    },
    async ({ id, since, author }) => {
      const r = await client.diff(id, since, author === 'all' ? undefined : (author as Author | 'others'))
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
        from: z.enum(['person', 'others']).default('person').describe("'person' (default): wake on the person's changes; 'others': also on other agents' changes on this board (never your own)"),
      },
    },
    async ({ id, since, timeoutSec, quietSec, wake, from }) => {
      const r = await client.wait(id, since, timeoutSec * 1000, from === 'others' ? 'others' : 'user', quietSec * 1000, wake)
      if (r.timedOut) return text(`no ${from === 'others' ? '' : 'user '}changes in ${timeoutSec}s (board seq ${r.seq}). Call canvas_wait again with since=${since} to keep waiting, or continue.`)
      return text(`${from === 'others' ? 'the board changed' : 'user changed the board'} (seq ${r.seq}):\n${r.lines.join('\n')}`)
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
    'canvas_files',
    {
      title: 'Read the files behind a board',
      description:
        "The files a board is drawn from, as the last redraw put them on the board: a workflow board's yaml, agent files, prompts and scripts; a diagram frame's design file. Without `path`: each file with its sha-1 (`base`), line count and where it comes from. With `path`: that file's exact text — make your edit against exactly this text, then canvas_propose_edit with this base. It is a snapshot: the real file lives on the machine that drew the board.",
      inputSchema: { id: z.string().describe('board id'), path: z.string().optional().describe('one file, as listed (repo-relative, e.g. "examples/card-pipeline/workflow.yaml")') },
    },
    async ({ id, path: want }) => {
      if (!want) {
        const files = await client.files(id)
        if (!files.length) return text('No files on this board: it was not drawn from files (awd graph --canvas / awd design draw / design_draw put them there). Nothing to propose against.')
        return text([`${files.length} file(s) behind board ${id}:`, ...files.map((f) => `${f.path}\tbase ${f.sha}\t${f.lines ?? '?'} lines\t${'workflow' in f.from ? 'workflow' : `diagram ${f.from.diagram}`}${f.truncated ? '\tCUT SHORT on the board — cannot be proposed against' : ''}`)].join('\n'))
      }
      const f = await client.file(id, want)
      return text(`file: ${f.path}\nbase: ${f.sha}${f.truncated ? '\n(cut short on the board — not the whole file; it cannot be proposed against)' : ''}\n--- the exact text follows (after this line) ---\n${f.text}`)
    },
  )

  server.registerTool(
    'canvas_propose_edit',
    {
      title: 'Propose an edit to a file behind a board',
      description: `Propose a change to one file behind a board (canvas_files lists them) when you cannot or should not write it yourself${opts.remote ? ' — this canvas is not on your machine, so this is how you change a workflow or design file' : ''}. Give \`base\` (its sha-1 from canvas_files) and either \`diff\` (a unified diff against that text: \`--- a/<file>\` / \`+++ b/<file>\` / \`@@ -l,n +l,n @@\` hunks with 3 lines of context) or \`newText\` (the whole new file). The canvas checks it applies cleanly to the snapshot, then posts it as a proposal signed with your name: a comment threaded on the block or frame the first changed line belongs to (or on \`about\` item ids), showing the diff. Nothing is written to disk: the person discusses it in the thread, and whoever has the files (the studio session on the canvas machine, or the person's own agent) applies it after they agree. Then canvas_wait for their answer and reply in that thread. On a workflow board, \`wires\` optionally draws the wires your edit adds (or, with remove: true, removes) between existing blocks as dashed proposed wires; the yaml edit itself must be in the diff. Errors say what to fix: a stale base (re-read the file), a hunk that does not apply, an unknown file.`,
      inputSchema: {
        id: z.string().describe('board id'),
        file: z.string().describe('the file, exactly as canvas_files lists it'),
        base: z.string().describe('sha-1 of the text you edited (from canvas_files)'),
        diff: z.string().optional().describe('unified diff against that text (one file)'),
        newText: z.string().optional().describe('the whole new file instead of a diff'),
        note: z.string().max(4000).describe('what the edit does and why, for the person — it opens the thread'),
        about: z.array(z.string()).optional().describe('item ids the proposal is about (default: the block / frame owning the first changed line)'),
        wires: z
          .array(z.object({ from: z.string(), to: z.string(), event: z.string(), condition: z.string().optional(), remove: z.boolean().optional() }))
          .optional()
          .describe('workflow boards: wires the edit adds or removes, by workflow node id — drawn dashed until the applied file is redrawn'),
      },
    },
    async ({ id, file, base, diff, newText, note, about, wires }) => {
      const r = await client.propose(id, { file, base, diff, newText, note, about, wires })
      const moved = r.offsets.some((o) => o !== 0) ? ` (some hunks applied ${r.offsets.map((o) => (o > 0 ? `+${o}` : String(o))).join(', ')} lines from where they said)` : ''
      return text(`proposed an edit to ${r.file} (+${r.added} −${r.removed})${moved} as comment ${r.comment} on ${r.about.join(', ') || 'the board'}; board seq ${r.seq}.\nLink: ${client.boardUrl(id, r.about[0] ? { focus: r.about[0] } : {})}\nThe file is unchanged until whoever has it applies the edit after the person agrees. Tell the person, then canvas_wait (since ${r.seq}) for their answer in thread ${r.comment}.`)
    },
  )

  server.registerTool(
    'canvas_open',
    { title: 'Open a board in the browser', description: opts.openBrowser === false ? 'The board URL, to give the person.' : 'Print the board URL and open it in the default browser (macOS).', inputSchema: { id: z.string() } },
    async ({ id }) => {
      const url = client.boardUrl(id)
      if (opts.openBrowser !== false && process.platform === 'darwin') execFile('open', [url], () => {})
      return text(url)
    },
  )

  extra = opts.extend?.(server, { client, project: opts.project }) ?? {}
  return server
}

/** Tokens this agent got through the device flow, per canvas address (`~/.awd/tokens.json`, 0600). */
function tokenFile(): string {
  return process.env.UNPROSE_TOKENS_FILE || path.join(os.homedir(), '.awd', 'tokens.json')
}
function savedToken(base: string): string | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(tokenFile(), 'utf8')) as Record<string, string>
    return typeof j[base] === 'string' ? j[base] : undefined
  } catch {
    return undefined
  }
}
function saveToken(base: string, token: string | undefined) {
  const f = tokenFile()
  let j: Record<string, string> = {}
  try {
    j = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, string>
  } catch {
    // first token
  }
  if (token) j[base] = token
  else delete j[base]
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 })
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n', { mode: 0o600 })
}

/**
 * An agent without a browser connecting to a canvas elsewhere (RFC 8628, docs/canvas.md "Remote agents"):
 * ask for a pairing code, show it in every tool result until the person types it on the canvas, then use
 * the token (and keep it for next time).
 */
async function connectWithCode(base: string, client: CanvasClient, name: string): Promise<void> {
  const res = await fetch(`${base}/device_authorization`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_name: name, scope: 'write' }) })
  const j = (await res.json().catch(() => ({}))) as { device_code?: string; user_code?: string; interval?: number; expires_in?: number; error_description?: string }
  if (!res.ok || !j.device_code || !j.user_code) {
    client.authHint = `This canvas (${base}) wants an access token and could not start a pairing code (${j.error_description ?? `HTTP ${res.status}`}). Ask the person for a token (canvas → Connected agents) and set UNPROSE_TOKEN.`
    return
  }
  const hint = (code: string) => `Not connected to the canvas yet. Ask the person to type the code ${code} on the canvas (${base}): the notification "${name} wants to connect", or Connected agents → Enter a code. It expires in 10 minutes; then call this tool again.`
  client.authHint = hint(j.user_code)
  process.stderr.write(`unprose MCP: ${client.authHint}\n`)
  const until = Date.now() + (j.expires_in ?? 600) * 1000
  let interval = Math.max(5, j.interval ?? 5) * 1000
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, interval))
    const t = await fetch(`${base}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: j.device_code }) }).catch(() => undefined)
    const body = ((await t?.json().catch(() => ({}))) ?? {}) as { access_token?: string; error?: string }
    if (body.access_token) {
      client.setToken(body.access_token)
      client.authHint = undefined
      try {
        saveToken(base, body.access_token)
      } catch {
        // kept for this session only
      }
      process.stderr.write(`unprose MCP: connected to ${base} as ${name}\n`)
      return
    }
    if (body.error === 'slow_down') interval += 5000
    else if (body.error && body.error !== 'authorization_pending') break
  }
  // denied or expired: the next tool call starts over
  client.authHint = `Not connected to the canvas (${base}): the pairing code was not accepted in time. Call a canvas tool again to get a new code.`
  client.onAuthNeeded = () => {
    client.onAuthNeeded = undefined
    void connectWithCode(base, client, name)
  }
}

export async function runMcp(extend?: McpOptions['extend']): Promise<void> {
  // Fail with the reason, not as a bare "Connection closed" in the agent (river0825/unprose#5).
  const raw = process.env.AWD_CANVAS_URL ?? 'http://localhost:4400'
  let base: string
  try {
    base = canvasOrigin(raw)
  } catch {
    process.stderr.write(`unprose MCP: AWD_CANVAS_URL "${raw}" is not a URL. Set it to the canvas address, e.g. http://localhost:4400 or https://canvas.example.com\n`)
    process.exit(2)
  }
  // a token: UNPROSE_TOKEN, else one this agent got earlier with a pairing code
  let token = process.env.UNPROSE_TOKEN || savedToken(base)
  let probe = await probeCanvas(base, 4000, token)
  if (!probe.ok && probe.auth && token && !process.env.UNPROSE_TOKEN) {
    // the saved token was revoked: forget it and pair again
    saveToken(base, undefined)
    token = undefined
    probe = await probeCanvas(base)
  }
  const needsPairing = !probe.ok && probe.auth && !token
  if (!probe.ok && !needsPairing) {
    process.stderr.write(`unprose MCP: cannot reach ${base} (${probe.reason}). Start the canvas (\`npm start\`) or set AWD_CANVAS_URL to where it runs.\n`)
    process.exit(1)
  }
  process.env.AWD_CANVAS_URL = base
  const name = process.env.UNPROSE_AGENT_NAME || `agent on ${os.hostname().replace(/\.local$/, '')}`
  const client = new CanvasClient(base, { token, agentName: process.env.UNPROSE_AGENT_NAME })
  if (needsPairing) void connectWithCode(base, client, name)
  // Boards this session creates belong to its project (stored in <project>/.unprose/boards/). Only a
  // canvas on this machine accepts the registration; elsewhere the boards stay in its personal space.
  let project: string | undefined
  const root = sessionProjectRoot()
  if (root && !needsPairing) {
    try {
      project = (await client.registerProject(root)).id
    } catch (e) {
      process.stderr.write(`unprose MCP: boards stay in the canvas's personal space (${root} not registered: ${(e as Error).message})\n`)
    }
  }
  const server = createMcpServer(client, { project, extend })
  await server.connect(new StdioServerTransport())
}
