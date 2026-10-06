// `awd mcp` — the Unprose MCP server: the canvas tools (@awd/canvas) plus the diagram-file tools and the
// start prompts, so agents without the CLI (Codex, other MCP clients) can lint, draw and propose too.
// Relative paths are resolved against the session's project (CLAUDE_PROJECT_DIR or the working directory).
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { runMcp, sessionProjectRoot, type McpOptions } from '@awd/canvas'
import { DOMAIN_STORY_METHOD, LAYOUT_NEVER_THE_STORY, WHICH_DIAGRAM, findingLine, tellBack } from '@awd/canvas/diagrams'
import { drawDesign, previewDesign, exportEgonFile, importEgonFile, lintDesign, parseDesignFile, proposeStoriesToBoard, unresolvedReport } from './design.js'
import { START_PROMPTS, promptText } from './prompts.js'

type Server = Parameters<NonNullable<McpOptions['extend']>>[0]

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })
const fail = (s: string) => ({ content: [{ type: 'text' as const, text: s }], isError: true })

export interface DesignToolOptions {
  /** Where relative paths start (the session's project). */
  cwd?: string
  /** Offer the start prompts (off for the Claude Code plugin, which has them as slash commands). */
  prompts?: boolean
}

/** Register design_lint, design_draw, design_propose_stories, design_egon and (optionally) the start prompts. */
export function registerDesignTools(server: Server, o: DesignToolOptions = {}): { designTools: true; prompts: string[] } {
  const cwd = o.cwd ?? sessionProjectRoot() ?? process.cwd()
  const abs = (p: string) => path.resolve(cwd, p)
  const lintFile = (file: string) => {
    const d = parseDesignFile(file, fs.readFileSync(file, 'utf8'))
    return { d, findings: lintDesign(d, file) }
  }
  const guard = async (fn: () => Promise<ReturnType<typeof text>> | ReturnType<typeof text>) => {
    try {
      return await fn()
    } catch (e) {
      return fail((e as Error).message)
    }
  }

  server.registerTool(
    'design_lint',
    {
      title: 'Check a diagram file',
      description: 'Check a diagram file (design/<name>.<kind>.yaml): its schema, unknown fields, and the EventStorming / Domain Storytelling grammar, with book page references. It checks the grammar and the drawing, not whether this is the right diagram or a true story: a domain story\'s result ends with the story read back for you to tell the person. Run it before design_draw.',
      inputSchema: { file: z.string().describe('Path to the diagram file, relative to the project') },
    },
    async ({ file }) =>
      guard(() => {
        const f = abs(file)
        const { d, findings } = lintFile(f)
        const errors = findings.filter((x) => x.severity === 'error').length
        return text([...findings.map(findingLine), `${errors ? '✖' : '✔'} ${path.basename(f)} (${d.kind}, key ${d.key}): ${errors} error(s), ${findings.length - errors} note(s)`, ...(d.kind === 'domain-story' && !errors ? tellBack(d.content as never) : [])].join('\n'))
      }),
  )

  server.registerTool(
    'design_draw',
    {
      title: 'Draw a diagram file on a board',
      description: `${WHICH_DIAGRAM}\nFor a domain story: ${DOMAIN_STORY_METHOD} ${LAYOUT_NEVER_THE_STORY}\nDraw (or refresh) one diagram frame from its file. What a redraw keeps: a locked item (data.lock "layout", on it or on its frame) keeps its place and size; else what the person moved keeps its place; else the file decides. Content always follows the file; pending proposals stay; items no longer in the file go; items in the frame this file did not draw (the person's, another agent's, comments) are kept. dryRun: true returns that plan (added / updated / removed / kept, and why) and writes nothing — use it before redrawing a frame others worked on. Refuses a file with lint errors. Returns the board link and the frame key (use it with canvas_focus). It records you as the holder of the file (proposals on this diagram come to you); a new board it creates suggests you as "Answered by" — the person confirms it.`,
      inputSchema: {
        file: z.string().describe('Path to the diagram file, relative to the project'),
        board: z.string().describe('A board id, or "title:<title>" (found or created in this project)'),
        at: z.object({ x: z.number(), y: z.number() }).optional().describe('Where a NEW frame goes (board coordinates); an existing frame stays where it is'),
        applied: z.string().optional().describe('The proposal thread (comment id) this redraw applies, after the person agreed: answers "Applied to <file>" there, and commits the file if this machine set UNPROSE_APPLY_COMMIT=1 (pushes with UNPROSE_APPLY_PUSH=1)'),
        dryRun: z.boolean().optional().describe('true: only preview the redraw (what it adds, updates, removes, keeps, and why); nothing is written and no board is created'),
        limit: z.number().int().min(1).max(200).optional().describe('dryRun: lines per section (default 8)'),
      },
    },
    async ({ file, board, at, applied, dryRun, limit }) =>
      guard(async () => {
        const f = abs(file)
        if (dryRun) return text((await previewDesign(f, { board, ...(at ? { at } : {}), ...(limit ? { limit } : {}) })).lines.join('\n'))
        const { d, findings } = lintFile(f)
        const errors = findings.filter((x) => x.severity === 'error')
        if (errors.length) return fail([`not drawn: ${errors.length} lint error(s) in ${file}`, ...errors.map(findingLine)].join('\n'))
        const r = await drawDesign(f, { board, ...(at ? { at } : {}), ...(applied ? { applied } : {}) })
        const notes = findings.filter((x) => x.severity !== 'error')
        return text(
          [
            `✔ ${path.basename(f)} → frame ${r.key} on ${r.base}/b/${r.boardId}?frame=${encodeURIComponent(r.key)} (seq ${r.seq})`,
            ...(r.applied ? [`✔ answered "Applied to ${r.applied.file ?? file}" in thread ${applied}${r.applied.notes.length ? ` (${r.applied.notes.join('; ')})` : ''}`] : []),
            ...notes.map(findingLine),
            ...unresolvedReport(r.unresolvedTraces),
            ...(d.kind === 'domain-story' ? tellBack(d.content as never) : []),
          ].join('\n'),
        )
      }),
  )

  server.registerTool(
    'design_propose_stories',
    {
      title: 'Propose stories from EventStorming',
      description: 'Story candidates from an EventStorming (person + command → story; events and read models → acceptance) or a domain story, drawn as dashed proposals on the story-map frame. The story-map file is not written: discuss the proposals and write the accepted ones yourself.',
      inputSchema: {
        from: z.string().describe('The EventStorming (.es.yaml) or domain story file'),
        into: z.string().describe('The story map file (.story-map.yaml)'),
        board: z.string().describe('The board with the story map frame (id or "title:<title>")'),
      },
    },
    async ({ from, into, board }) =>
      guard(async () => {
        const r = await proposeStoriesToBoard(abs(from), abs(into), { board })
        return text(`✔ ${r.proposed} story proposal(s) on ${r.base}/b/${r.boardId}${r.skipped ? ` (${r.skipped} already proposed)` : ''}${r.candidates === 0 ? ' — nothing new: every command already has a story' : ''}. The story-map file is unchanged until the person accepts them.`)
      }),
  )

  server.registerTool(
    'design_egon',
    {
      title: 'Egon.io import / export',
      description: 'Move a domain story to or from Egon.io (egon.io): import an .egn / .egn.svg into design/<name>.domain-story.yaml (then lint and draw it), or export a domain-story file to .egn.',
      inputSchema: {
        action: z.enum(['import', 'export']),
        file: z.string().describe('import: the .egn / .egn.svg file; export: the .domain-story.yaml file'),
        out: z.string().describe('import: design/<name>.domain-story.yaml; export: <story>.egn'),
      },
    },
    async ({ action, file, out }) =>
      guard(() => {
        if (action === 'export') {
          exportEgonFile(abs(file), abs(out))
          return text(`✔ ${file} → ${out}; open it in Egon.io (https://egon.io) with Import`)
        }
        const r = importEgonFile(abs(file), abs(out))
        const { findings } = lintFile(abs(out))
        return text([`✔ ${file} → ${out} (${r.sentences} sentence(s)); draw it with design_draw`, ...r.warnings.map((w) => `⚠ ${w}`), ...findings.map(findingLine)].join('\n'))
      }),
  )

  const prompts: string[] = []
  if (o.prompts !== false) {
    for (const p of START_PROMPTS) {
      const argsSchema = p.arg ? { [p.arg.name]: z.string().optional().describe(p.arg.description) } : {}
      server.registerPrompt(p.name, { title: p.title, description: p.description, argsSchema }, (args: Record<string, string | undefined>) => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: promptText(p, p.arg ? args[p.arg.name] : undefined) } }],
      }))
      prompts.push(p.name)
    }
  }
  return { designTools: true, prompts }
}

/** `awd mcp`: the canvas MCP server with the design tools; UNPROSE_MCP_PROMPTS=0 leaves the prompts out. */
export async function cmdMcp(): Promise<void> {
  await runMcp((server) => registerDesignTools(server, { prompts: process.env.UNPROSE_MCP_PROMPTS !== '0' }))
}
