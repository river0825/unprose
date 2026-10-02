// The diagram-file tools for agents that are not on this machine (docs/canvas.md "Remote agents"): the canvas
// server cannot read a remote agent's files, so design_lint / design_draw / design_propose_stories take the
// file's text (`content`) and its name instead of a path. Same rules as `awd design …` (packages/cli): the
// shared, pure parts live in ./diagrams (designFile.ts, redraw.ts). Workflow files stay with `awd graph`.
import YAML from 'yaml'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CanvasClient } from './client.js'
import { designFromObject, findingLine, frameOf, lintDesignContent, proposalOps, withDesignFindings, yamlCommentHint, type DesignFile } from './diagrams/designFile.js'
import { explainRedraw, planLines, redrawInputs, type BoardItem, type LoggedChange } from './diagrams/redraw.js'
import { proposeStories } from './diagrams/proposeStories.js'
import { proposeFromDomainStory } from './diagrams/proposeFromDomainStory.js'
import { START_PROMPTS, promptText } from './prompts.js'
import type { Op } from './model.js'

const MAX = 512 * 1024
const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })
const fail = (s: string) => ({ content: [{ type: 'text' as const, text: s }], isError: true })

/** The file's text → a diagram (YAML or JSON). `name` is its file name (`checkout.es.yaml`), which says the kind. */
export function parseDesignText(name: string, content: string): DesignFile {
  if (content.length > MAX) throw new Error(`${name}: larger than ${MAX / 1024} KB`)
  let raw: unknown
  try {
    raw = YAML.parse(content) ?? {}
  } catch (err) {
    const line = (err as { linePos?: Array<{ line: number }> }).linePos?.[0]?.line
    const hint = yamlCommentHint(content, line)
    throw new Error(`${name}: ${(err as Error).message}${hint ? `\n${hint}` : ''}`)
  }
  const d = designFromObject(name, raw)
  if (d.kind === 'workflow') throw new Error(`${name}: a workflow file is drawn by \`awd graph <file> --canvas\` on the machine that has it; remotely, draw its graph with canvas_create_board (kind workflow, the JSON of \`awd graph --json\`)`)
  return d
}

/**
 * `title:<title>` → the board with that title the caller sees (the canvas decides in one step: its project, the
 * personal space, any — no duplicates), else a new freeform board; anything else is a board id. `note` says when
 * several boards have that title.
 */
async function resolveBoard(client: CanvasClient, ref: string): Promise<{ id: string; note?: string }> {
  if (!ref.startsWith('title:')) return { id: (await client.getBoard(ref)).id }
  const title = ref.slice(6).trim()
  // a board an agent draws from its own files suggests that agent as "Answered by"; the person confirms (docs/canvas.md "Several agents on one board")
  const r = await client.boardByTitle({ title, kind: 'freeform', answeredBy: 'me' })
  const many = r.ambiguous && r.ambiguous.length > 1 ? `${r.ambiguous.length} boards are titled "${title}" (${r.ambiguous.map((b) => `${b.id} [${b.project}]`).join(', ')}) — used ${r.board.id}, the most recently changed; pass a board id to use another` : undefined
  return { id: r.board.id, ...(many ? { note: many } : {}) }
}

/** The redraw of one diagram on a board, computed and not applied: its ops, its plan, and what it read. */
async function planDesignRedraw(client: CanvasClient, d: DesignFile, name: string, boardId: string, at?: { x: number; y: number }) {
  const r = await client.template(boardId, d.kind as never, d.content, undefined, undefined, { key: d.key, title: d.title, source: name, level: d.level, ...(at ? { at } : {}) })
  // a UI mock's lint findings go on its elements (docs/diagrams.md §6c)
  const drawn = withDesignFindings(d, r.items as unknown as BoardItem[])
  const current = await client.getBoard(boardId)
  const items = current.items as unknown as Record<string, BoardItem>
  // the whole log: what the person moved, and who added each item (docs/diagrams.md "What a redraw keeps")
  const { changes } = await client.changes(boardId, 0)
  const frame = drawn.find((it) => it.type === 'frame' && (it.data?.diagram as { key?: string } | undefined)?.key === d.key) ?? frameOf({ items }, d.key)
  const res = explainRedraw(items, drawn, redrawInputs(changes as unknown as LoggedChange[]), { prefix: `${d.key}.`, keep: new Set(frame ? [frame.id] : []), ...(frame && items[frame.id] ? { frame: frame.id } : {}) })
  return { ...res, current, unresolved: r.unresolvedTraces ?? [] }
}

/** design_draw { dryRun: true }: the redraw preview — nothing written, no board created. */
export async function previewDesignContent(client: CanvasClient, name: string, content: string, board: string, o: { at?: { x: number; y: number }; limit?: number } = {}) {
  const d = parseDesignText(name, content)
  const errors = lintDesignContent(d).filter((f) => f.severity === 'error')
  const lintLine = errors.length ? [`  ✖ ${errors.length} lint error(s): a real draw refuses this file (design_lint)`] : []
  let boardId: string | undefined
  if (!board.startsWith('title:')) boardId = (await client.getBoard(board)).id
  else boardId = (await client.listBoards()).find((b) => b.title === board.slice(6).trim())?.id
  if (!boardId) return { key: d.key, lines: [`Redraw preview — ${d.key} (dry run: nothing written)`, `  no board ${board} yet: a real draw creates it and adds the whole frame`, ...lintLine] }
  const { plan, current } = await planDesignRedraw(client, d, name, boardId, o.at)
  return { key: d.key, boardId, plan, lines: [...planLines(plan, { title: `Redraw preview — ${d.key} from ${name} on "${current.title}" (${client.boardUrl(boardId)})`, limit: o.limit }), ...lintLine] }
}

export async function drawDesignContent(client: CanvasClient, name: string, content: string, board: string, at?: { x: number; y: number }) {
  const d = parseDesignText(name, content)
  const findings = lintDesignContent(d)
  const errors = findings.filter((f) => f.severity === 'error')
  if (errors.length) throw new Error([`not drawn: ${errors.length} lint error(s) in ${name}`, ...errors.map(findingLine)].join('\n'))
  const found = await resolveBoard(client, board)
  const boardId = found.id
  const { ops, current, unresolved } = await planDesignRedraw(client, d, name, boardId, at)
  const { seq } = await client.apply(boardId, ops as unknown as Op[], 'agent', `design_draw: ${name}`)
  // only this diagram's entry changes (PATCH merges per diagram key: another agent's diagrams stay as they are)
  // the caller holds this file (the canvas stamps its name; there is no path to record from here)
  await client.patchBoard(boardId, { meta: { diagrams: { [d.key]: { kind: d.kind, source: name, files: { [name]: content }, holder: {} } } } })
  return { boardId, seq, key: d.key, notes: findings.filter((f) => f.severity !== 'error'), unresolved, ...(found.note ? { note: found.note } : {}) }
}

/** design_lint / design_draw / design_propose_stories over file content, and the start prompts. */
export function registerContentDesignTools(server: McpServer, client: CanvasClient, o: { prompts?: boolean } = {}): { designTools: true; prompts: string[] } {
  const guard = async (fn: () => Promise<ReturnType<typeof text>> | ReturnType<typeof text>) => {
    try {
      return await fn()
    } catch (e) {
      return fail((e as Error).message)
    }
  }
  const fileArgs = {
    name: z.string().max(200).describe('The file name, which says the kind: <name>.<kind>.yaml — es, story-map, kanban, wireframe, ui, domain-story, journey (e.g. "checkout.es.yaml")'),
    content: z.string().max(MAX).describe('The whole file, as text (YAML)'),
  }

  server.registerTool(
    'design_lint',
    {
      title: 'Check a diagram file',
      description: 'Check a diagram file (design/<name>.<kind>.yaml): its schema, unknown fields, and the EventStorming / Domain Storytelling grammar, with book page references. This canvas is not on your machine, so pass the file\'s text as `content` and its file name as `name`. Run it before design_draw.',
      inputSchema: fileArgs,
    },
    async ({ name, content }) =>
      guard(() => {
        const d = parseDesignText(name, content)
        const findings = lintDesignContent(d)
        const errors = findings.filter((x) => x.severity === 'error').length
        return text([...findings.map(findingLine), `${errors ? '✖' : '✔'} ${name} (${d.kind}, key ${d.key}): ${errors} error(s), ${findings.length - errors} note(s)`].join('\n'))
      }),
  )

  server.registerTool(
    'design_draw',
    {
      title: 'Draw a diagram file on a board',
      description: 'Draw (or refresh) one diagram frame from its file. What a redraw keeps: a locked item (data.lock "layout", on it or on its frame) keeps its place and size; else what the person moved keeps its place; else the file decides. Content always follows the file; pending proposals stay; items no longer in the file go; items in the frame this file did not draw (the person\'s, another agent\'s, comments) are kept. dryRun: true returns that plan (added / updated / removed / kept, and why) and writes nothing — use it before redrawing a frame others worked on. Refuses a file with lint errors. Pass the file\'s text as `content` and its name as `name` (this canvas cannot read your files); keep the file itself as the truth on your side. Returns the board link and the frame key (use it with canvas_focus).',
      inputSchema: {
        ...fileArgs,
        board: z.string().describe('A board id, or "title:<title>" (found, or created)'),
        at: z.object({ x: z.number(), y: z.number() }).optional().describe('Where a NEW frame goes (board coordinates); an existing frame stays where it is'),
        dryRun: z.boolean().optional().describe('true: only preview the redraw (what it adds, updates, removes, keeps, and why); nothing is written and no board is created'),
        limit: z.number().int().min(1).max(200).optional().describe('dryRun: lines per section (default 8)'),
      },
    },
    async ({ name, content, board, at, dryRun, limit }) =>
      guard(async () => {
        if (dryRun) return text((await previewDesignContent(client, name, content, board, { ...(at ? { at } : {}), ...(limit ? { limit } : {}) })).lines.join('\n'))
        const r = await drawDesignContent(client, name, content, board, at)
        const unresolved = r.unresolved.length ? [`⚠ ${r.unresolved.length} trace(s) not drawn:`, ...r.unresolved.map((u) => `  ${u.item} —${u.trace.rel}→ ${u.trace.from}: ${u.reason === 'bad-ref' ? 'not a <diagram key>/<element id> ref' : 'target not found on the board'}`)] : []
        return text([`✔ ${name} → frame ${r.key} on ${client.boardUrl(r.boardId, { frame: r.key })} (seq ${r.seq})`, ...(r.note ? [`⚠ ${r.note}`] : []), ...r.notes.map(findingLine), ...unresolved].join('\n'))
      }),
  )

  server.registerTool(
    'design_propose_stories',
    {
      title: 'Propose stories from EventStorming',
      description: 'Story candidates from an EventStorming (person + command → story; events and read models → acceptance) or a domain story, drawn as dashed proposals on the story-map frame. Pass both files as text. The story-map file is not changed: discuss the proposals and write the accepted ones yourself.',
      inputSchema: {
        from_name: z.string().max(200).describe('The EventStorming (.es.yaml) or domain story file name'),
        from_content: z.string().max(MAX),
        into_name: z.string().max(200).describe('The story map file name (.story-map.yaml)'),
        into_content: z.string().max(MAX),
        board: z.string().describe('The board with the story map frame (id or "title:<title>")'),
      },
    },
    async ({ from_name, from_content, into_name, into_content, board }) =>
      guard(async () => {
        const es = parseDesignText(from_name, from_content)
        const usm = parseDesignText(into_name, into_content)
        if (es.kind !== 'event-storming' && es.kind !== 'domain-story') throw new Error(`${from_name} is a ${es.kind} diagram — propose stories from EventStorming or a domain story`)
        if (usm.kind !== 'user-story-map') throw new Error(`${into_name} is a ${usm.kind} diagram, not a story map`)
        const { candidates } = es.kind === 'domain-story' ? proposeFromDomainStory(es.content as never, { dsKey: es.key, storyName: es.title ?? es.key, existing: usm.content as never }) : proposeStories(es.content as never, { esKey: es.key, existing: usm.content as never })
        const boardId = (await resolveBoard(client, board)).id
        const current = await client.getBoard(boardId)
        const { ops, proposed, skipped } = proposalOps({ items: current.items as unknown as Record<string, BoardItem> }, candidates, usm.key, es.key)
        if (ops.length) await client.apply(boardId, ops as unknown as Op[], 'agent', `design_propose_stories: ${proposed} from ${es.key}`)
        return text(`✔ ${proposed} story proposal(s) on ${client.boardUrl(boardId)}${skipped ? ` (${skipped} already proposed)` : ''}${candidates.length === 0 ? ' — nothing new: every command already has a story' : ''}. The story-map file is unchanged until the person accepts them.`)
      }),
  )

  const prompts: string[] = []
  if (o.prompts !== false) {
    for (const p of START_PROMPTS) {
      const argsSchema = p.arg ? { [p.arg.name]: z.string().optional().describe(p.arg.description) } : {}
      server.registerPrompt(p.name, { title: p.title, description: p.description, argsSchema }, (args: Record<string, string | undefined>) => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `${promptText(p, p.arg ? args[p.arg.name] : undefined)}\n\n(This canvas is not on your machine: give design_lint / design_draw the file's text as \`content\` and its name as \`name\`.)` } }],
      }))
      prompts.push(p.name)
    }
  }
  return { designTools: true, prompts }
}

