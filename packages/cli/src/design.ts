// `awd design draw | lint | propose-stories` — diagrams backed by files (docs/diagrams.md).
// A diagram frame on the canvas is a projection of `design/<name>.<kind>.yaml`; the file is the
// truth, the board keeps where the person put things, and proposals stay proposals until the
// file explains them (the workflow board's rules, scoped to one frame).

import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { designFromObject, fromEgon, frameOf, growFrame, lintDesignContent, proposalOps, withDesignFindings, proposeFromDomainStory, proposeStories, toEgon, yamlCommentHint, type DesignFile, type DesignFinding } from '@awd/canvas/diagrams'
import { lint as lintWorkflow, toGraph } from '@awd/core'
import { loadWorkflow } from '@awd/runtime'
import { planRedraw, placedByUser, repoRoot, withDetails } from './graphCanvas.js'
import { boardByTitle, canvasApi as projectApi, canvasBase, holderInfo, registerProject } from './projects.js'
import { afterApplied, type AppliedResult } from './applied.js'

type Flags = Record<string, string | boolean>
const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v : undefined)

// ── the file ─────────────────────────────────────────────────────────────────
// What a file means is pure and shared with the canvas server's remote design tools (@awd/canvas/diagrams).

export { KIND_ALIASES, yamlCommentHint, type DesignFile, type DesignFinding } from '@awd/canvas/diagrams'

/**
 * `design/studio.es.yaml` → key `studio-es`, kind `event-storming`. Two diagrams of one topic
 * (`studio.es.yaml`, `studio.story-map.yaml`) get different keys, so they can share a board.
 * Top-level `key:` / `kind:` / `title:` in the file win over the filename.
 */
export function parseDesignFile(file: string, text: string): DesignFile {
  let raw: unknown
  try {
    raw = YAML.parse(text) ?? {}
  } catch (err) {
    const line = (err as { linePos?: Array<{ line: number }> }).linePos?.[0]?.line
    const hint = yamlCommentHint(text, line)
    throw new Error(`${file}: ${(err as Error).message}${hint ? `\n${hint}` : ''}`)
  }
  return designFromObject(file, raw)
}

// ── lint ─────────────────────────────────────────────────────────────────────

/** Schema errors (the file will not draw) and, for EventStorming, the book's grammar (docs/diagrams.md §3). */
export function lintDesign(d: DesignFile, file?: string): DesignFinding[] {
  if (d.kind === 'workflow') {
    if (!file) return [{ severity: 'info', message: 'workflow: lint it with awd lint <file>' }]
    const r = lintWorkflow(loadWorkflow(file).def)
    return [...r.errors.map((e) => ({ severity: 'error' as const, message: `${e.where}: ${e.message}` })), ...r.warnings.map((w) => ({ severity: 'warning' as const, message: `${w.where}: ${w.message}` }))]
  }
  return lintDesignContent(d)
}

export function cmdDesignLint(file: string): boolean {
  const d = parseDesignFile(file, fs.readFileSync(file, 'utf8'))
  const findings = lintDesign(d, file)
  const errors = findings.filter((f) => f.severity === 'error')
  for (const f of findings) console.log(`${f.severity === 'error' ? '✖' : f.severity === 'warning' ? '⚠' : '·'} ${f.element ? `${f.element}: ` : ''}${f.message}${f.page ? `  (${f.page})` : ''}`)
  console.log(`${errors.length ? '✖' : '✔'} ${path.basename(file)} (${d.kind}, key ${d.key}): ${errors.length} error(s), ${findings.length - errors.length} note(s)`)
  return errors.length === 0
}

// ── the canvas ───────────────────────────────────────────────────────────────

type BoardItem = { id: string; type: string; parent?: string; x?: number; y?: number; w?: number; h?: number; from?: string; to?: string; text?: string; data?: Record<string, unknown>; [k: string]: unknown }
type Board = { id: string; title: string; kind: string; items: Record<string, BoardItem>; meta?: Record<string, unknown> }

const canvasApi = projectApi
type Api = ReturnType<typeof canvasApi>

/**
 * `title:<title>` or a board id. A title is looked up in the design file's project first (its repo,
 * registered on the canvas) and created there as a freeform board when missing (docs/canvas.md "Projects").
 */
async function resolveBoard(api: Api, ref: string, projectRoot?: string): Promise<Board> {
  if (ref.startsWith('title:')) {
    const title = ref.slice(6).trim()
    const project = projectRoot ? await registerProject(api, projectRoot) : undefined
    const id = (await boardByTitle(api, title, 'freeform', project)).id
    return (await api<{ board: Board }>('GET', `/api/boards/${id}`)).board
  }
  return (await api<{ board: Board }>('GET', `/api/boards/${encodeURIComponent(ref)}`)).board
}

export { frameOf, growFrame, proposalOps }

export interface DrawOptions {
  board: string
  canvas?: string
  /** where a NEW frame goes (board coordinates); an existing frame stays where it is */
  at?: { x: number; y: number }
  /** the proposal thread this redraw applies: answers "Applied …" there, and commits if UNPROSE_APPLY_COMMIT=1 (docs/canvas.md) */
  applied?: string
}

/** Draw or refresh one diagram frame from its file (docs/diagrams.md §2). */
export interface UnresolvedTrace { item: string; trace: { from: string; rel: string }; reason: string }

export async function drawDesign(file: string, opts: DrawOptions): Promise<{ base: string; boardId: string; seq: number; key: string; unresolvedTraces: UnresolvedTrace[]; applied?: AppliedResult }> {
  const base = canvasBase(opts.canvas)
  const api = canvasApi(base)
  const abs = path.resolve(file)
  const text = fs.readFileSync(abs, 'utf8')
  const d = parseDesignFile(abs, text)
  const root = repoRoot(path.dirname(abs))
  const source = path.relative(root, abs)
  const board = await resolveBoard(api, opts.board, root)
  // A workflow is drawn with the runner's own projection (graph + block details); the files behind it
  // (agent prompts, scripts) go into the snapshot so the Inspector and Files tab can show them.
  const wf = d.kind === 'workflow' ? withDetails(toGraph(loadWorkflow(abs).def), abs) : undefined
  const { items: served, unresolvedTraces = [] } = await api<{ items: BoardItem[]; unresolvedTraces?: UnresolvedTrace[] }>('POST', `/api/boards/${board.id}/template`, {
    kind: d.kind,
    content: wf ? wf.graph : d.content,
    frame: { key: d.key, title: d.title, source, level: d.level, ...(opts.at ? { at: opts.at } : {}) },
  })
  // a UI mock's lint findings go on its elements, from the file as written (docs/diagrams.md §6c)
  const drawn = withDesignFindings(d, served)
  const current = (await api<{ board: Board }>('GET', `/api/boards/${board.id}`)).board
  const { changes } = await api<{ changes: Array<{ ops: Array<{ kind: string; id?: string; patch?: Record<string, unknown> }> }> }>('GET', `/api/boards/${board.id}/changes?since=0&author=user`)
  const frame = drawn.find((it) => it.type === 'frame' && (it.data?.diagram as { key?: string } | undefined)?.key === d.key) ?? frameOf(current, d.key)
  const placed = placedByUser(changes)
  const ops = planRedraw(current.items, drawn, placed, { prefix: `${d.key}.`, keep: new Set(frame ? [frame.id] : []) })
  const grow = frame && current.items[frame.id] ? growFrame(current.items[frame.id], drawn, placed) : undefined
  if (grow) ops.push(grow)
  const { seq } = await api<{ seq: number }>('POST', `/api/boards/${board.id}/ops`, { author: 'agent', ops, note: `awd design draw: ${source}` })
  // PATCH merges: only this diagram's entry changes — another machine's diagrams and keys stay as they are.
  // the holder: this agent has the files and where (machine, root — the project root per diagram); the canvas stamps the
  // name and the time (docs/canvas.md "Several agents on one board"). The board-level `project.root` is only the default
  // for a board drawn from one machine: set when the board has none, never overwritten by another machine's draw.
  const holder = { ...holderInfo(root), ...(opts.applied ? { applied: opts.applied } : {}) }
  const projectRoot = (current.meta?.project as { root?: unknown } | undefined)?.root
  await api('PATCH', `/api/boards/${board.id}`, { meta: { diagrams: { [d.key]: { kind: d.kind, source, files: wf?.files?.files ?? { [source]: text }, holder } }, ...(typeof projectRoot === 'string' && projectRoot ? {} : { project: { root } }) } })
  const applied = opts.applied ? await afterApplied(api, { base, boardId: board.id, thread: opts.applied, root, fallbackFile: source }) : undefined
  return { base, boardId: board.id, seq, key: d.key, unresolvedTraces, ...(applied ? { applied } : {}) }
}

/** "N trace(s) not drawn" lines for a draw, so a link to a missing target is not lost silently (river0825/unprose#6). */
export function unresolvedReport(list: UnresolvedTrace[]): string[] {
  if (!list.length) return []
  const why = (u: UnresolvedTrace) => (u.reason === 'bad-ref' ? 'not a <diagram key>/<element id> ref' : 'target not found on the board')
  return [`⚠ ${list.length} trace(s) not drawn:`, ...list.map((u) => `  ${u.item} —${u.trace.rel}→ ${u.trace.from}: ${why(u)}`)]
}

// ── proposals: stories from EventStorming (docs/diagrams.md §4) — proposalOps is in @awd/canvas/diagrams ──

export async function proposeStoriesToBoard(esFile: string, usmFile: string, opts: DrawOptions) {
  const base = canvasBase(opts.canvas)
  const api = canvasApi(base)
  const es = parseDesignFile(esFile, fs.readFileSync(esFile, 'utf8'))
  const usm = parseDesignFile(usmFile, fs.readFileSync(usmFile, 'utf8'))
  if (es.kind !== 'event-storming' && es.kind !== 'domain-story') throw new Error(`${esFile} is a ${es.kind} diagram — propose stories from EventStorming or a domain story`)
  if (usm.kind !== 'user-story-map') throw new Error(`${usmFile} is a ${usm.kind} diagram, not a story map`)
  const { candidates } =
    es.kind === 'domain-story'
      ? proposeFromDomainStory(es.content as never, { dsKey: es.key, storyName: es.title ?? es.key, existing: usm.content as never })
      : proposeStories(es.content as never, { esKey: es.key, existing: usm.content as never })
  const board = await resolveBoard(api, opts.board, repoRoot(path.dirname(path.resolve(usmFile))))
  const { ops, proposed, skipped } = proposalOps(board, candidates, usm.key, es.key)
  const seq = ops.length ? (await api<{ seq: number }>('POST', `/api/boards/${board.id}/ops`, { author: 'agent', ops, note: `awd design propose-stories: ${proposed} from ${es.key}` })).seq : undefined
  return { base, boardId: board.id, proposed, skipped, candidates: candidates.length, seq }
}

// ── the command ──────────────────────────────────────────────────────────────

export async function cmdDesign(args: string[], flags: Flags): Promise<boolean> {
  const [sub, file] = args
  const boardRef = str(flags.board)
  const canvas = str(flags.canvas)
  if (sub === 'lint') {
    if (!file) throw new Error('usage: awd design lint <design/<name>.<kind>.yaml>')
    return cmdDesignLint(file)
  }
  if (sub === 'draw') {
    if (!file || !boardRef) throw new Error('usage: awd design draw <file> --board <id | title:…> [--canvas URL] [--at x,y] [--applied <proposal thread id>]')
    const findings = lintDesign(parseDesignFile(file, fs.readFileSync(file, 'utf8')), file)
    const errors = findings.filter((f) => f.severity === 'error')
    if (errors.length) {
      for (const e of errors) console.error(`✖ ${e.message}`)
      return false
    }
    for (const w of findings.filter((f) => f.severity === 'warning' && f.message.startsWith('unknown field'))) console.warn(`⚠ ${w.message}`)
    const at = str(flags.at)?.split(',').map(Number)
    const applied = str(flags.applied)
    const r = await drawDesign(file, { board: boardRef, canvas, ...(applied ? { applied } : {}), ...(at && at.length === 2 && at.every(Number.isFinite) ? { at: { x: at[0], y: at[1] } } : {}) })
    console.log(`✔ ${path.basename(file)} → frame ${r.key} on ${r.base}/b/${r.boardId} (seq ${r.seq}; ${findings.filter((f) => f.severity !== 'error').length} note(s) — awd design lint ${file})`)
    if (r.applied) console.log(`✔ answered "Applied to ${r.applied.file ?? file}" in thread ${applied}${r.applied.notes.length ? ` (${r.applied.notes.join('; ')})` : ''}`)
    for (const line of unresolvedReport(r.unresolvedTraces)) console.warn(line)
    return true
  }
  if (sub === 'propose-stories') {
    const into = str(flags.into)
    if (!file || !into || !boardRef) throw new Error('usage: awd design propose-stories <es file> --into <story map file> --board <id | title:…> [--canvas URL]')
    const r = await proposeStoriesToBoard(file, into, { board: boardRef, canvas })
    console.log(`✔ ${r.proposed} story proposal(s) on ${r.base}/b/${r.boardId}${r.skipped ? ` (${r.skipped} already proposed)` : ''}${r.candidates === 0 ? ' — nothing new: every command already has a story' : ''}. Accept them in a chat; the story-map file is not written until then.`)
    return true
  }
  if (sub === 'import-egon') {
    const out = str(flags.out)
    if (!file || !out) throw new Error('usage: awd design import-egon <story.egn> --out design/<name>.domain-story.yaml')
    const r = importEgonFile(file, out)
    for (const w of r.warnings) console.warn(`⚠ ${w}`)
    console.log(`✔ ${path.basename(file)} → ${out} (${r.sentences} sentence(s)); draw it with awd design draw ${out} --board …`)
    return cmdDesignLint(out)
  }
  if (sub === 'export-egon') {
    const out = str(flags.out)
    if (!file || !out) throw new Error('usage: awd design export-egon <design/<name>.domain-story.yaml> --out <story.egn>')
    exportEgonFile(file, out)
    console.log(`✔ ${path.basename(file)} → ${out}; open it in Egon.io (https://egon.io) with Import`)
    return true
  }
  throw new Error('usage: awd design draw|lint|propose-stories|import-egon|export-egon … (docs/diagrams.md)')
}

// ── Egon.io interop (docs/diagrams.md §6b) ──────────────────────────────────

/** Read an Egon.io story (`.egn`, or `.egn.svg` with the story embedded) and write it as a domain-story file. */
export function importEgonFile(file: string, out: string): { sentences: number; warnings: string[] } {
  let text = fs.readFileSync(file, 'utf8')
  if (file.endsWith('.svg')) {
    // Egon embeds the story as <DST>…</DST> in a hidden, XML-escaped <text> (older files: in a comment)
    const unescaped = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    const m = unescaped.match(/<DST>([\s\S]*?)<\/DST>/)
    if (!m) throw new Error(`${file}: no embedded domain story (<DST>) in this SVG`)
    text = m[1].replace(/<!--|-->/g, '')
  }
  const r = fromEgon(JSON.parse(text))
  const header = [`# Imported from Egon.io (${path.basename(file)}) by awd design import-egon.`, ...(r.description ? [`# ${r.description.replace(/\n/g, ' ')}`] : [])].join('\n')
  const body = YAML.stringify({ ...(r.title ? { title: r.title } : {}), ...r.content }, { lineWidth: 0 })
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.writeFileSync(out, `${header}\n${body}`)
  return { sentences: (r.content.sentences ?? []).length, warnings: r.warnings }
}

/** Write a domain-story file as an Egon.io `.egn` story. */
export function exportEgonFile(file: string, out: string): void {
  const d = parseDesignFile(file, fs.readFileSync(file, 'utf8'))
  if (d.kind !== 'domain-story') throw new Error(`${file} is a ${d.kind} diagram, not a domain story`)
  fs.writeFileSync(out, JSON.stringify(toEgon(d.content as never, { title: d.title ?? d.key }), null, 2))
}
