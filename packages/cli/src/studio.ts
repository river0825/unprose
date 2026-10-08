// `awd studio --project <dir>` (or `awd studio <workflow.yaml>`) — the composition root for
// Studio (docs/diagrams.md §8, docs/studio.md §3): one process per project, serving every
// board of the project, one Claude Code session per board in a herdr tab. The use case is
// `Studio` in @awd/runtime; this file only wires real adapters and runs the loop.

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseDuration } from '@awd/core'
import { loadWorkflow, Studio, HerdrChannel, canvasBoardHttp, FileStudioStore, STUDIO_MODELS, type StudioModel } from '@awd/runtime'
import { pushGraphToCanvas, repoRoot } from './graphCanvas.js'

type Flags = Record<string, string | boolean>
const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v : undefined)

export async function cmdStudio(file: string | undefined, flags: Flags) {
  const model = (str(flags.model) ?? 'opus') as StudioModel
  if (!STUDIO_MODELS.includes(model)) throw new Error(`--model must be one of ${STUDIO_MODELS.join(', ')}`)
  const permissionMode = str(flags['permission-mode']) ?? 'auto'
  if (!/^[A-Za-z]+$/.test(permissionMode)) throw new Error(`--permission-mode: "${permissionMode}" is not a Claude Code permission mode`)
  const intervalMs = flags.interval ? parseDuration(str(flags.interval), '--interval') : 2000
  const maxSessions = flags['max-sessions'] ? Number(str(flags['max-sessions'])) : 3
  if (!Number.isInteger(maxSessions) || maxSessions < 1) throw new Error('--max-sessions must be a whole number ≥ 1')
  const idleCloseMs = flags['idle-close'] ? parseDuration(str(flags['idle-close']), '--idle-close') : 30 * 60_000

  // The project: --project, else the repo of the workflow file. A workflow is drawn first, so its board is in the project.
  const projectFlag = str(flags.project)
  if (!projectFlag && !file) throw new Error('awd studio needs --project <dir> or a workflow file')
  let base = str(flags.canvas) ?? process.env.AWD_CANVAS_URL ?? 'http://localhost:4400'
  let root = projectFlag ? fs.realpathSync(path.resolve(projectFlag)) : ''
  if (file) {
    const wf = loadWorkflow(file)
    root ||= fs.realpathSync(repoRoot(wf.dir))
    try {
      const drawn = await pushGraphToCanvas(wf.def, { canvas: str(flags.canvas), runtime: str(flags.runtime), file })
      base = drawn.base
      console.log(`studio: ${wf.def.name} → ${drawn.base}/b/${drawn.boardId} (seq ${drawn.seq})`)
    } catch (e) {
      // the person handed the workflow's files to another agent: studio serves the board without redrawing it
      if (!/^the files of "workflow"/.test((e as Error).message)) throw e
      console.log(`studio: not redrawn — ${(e as Error).message}`)
    }
  }
  const name = path.basename(root)

  const studio = new Studio({
    canvas: canvasBoardHttp({ base }),
    channel: new HerdrChannel(str(flags['herdr-bin']) ?? 'herdr'),
    // per project: state.json + status.json; briefs per board under <board-scope>/
    store: new FileStudioStore(path.join(root, '.awd', 'studio')),
    project: root,
    projectName: name,
    canvasUrl: base.replace(/\/$/, ''),
    awd: awdCommand(root),
    model,
    permissionMode,
    maxSessions,
    idleCloseMs,
    warm: flags.warm === true || flags.warm === 'true',
    newSessionId: randomUUID,
    log: (line) => console.log(`studio: ${line}`),
  })
  studio.init()
  console.log(`studio: project ${root} — every board whose meta points inside it; herdr tab "studio: ${name}", one session per board (a fork when it is busy), up to ${maxSessions} panes, idle panes close after ${Math.round(idleCloseMs / 60_000)} min (conversations resume). New sessions: claude --model <request or ${model}> --permission-mode ${permissionMode}. Ctrl-C stops.`)

  let stopped = false
  process.once('SIGINT', () => {
    stopped = true
    console.log('\nstudio: stopped (open herdr sessions keep running)')
    process.exit(0)
  })
  process.once('SIGTERM', () => process.exit(0))
  while (!stopped) {
    try {
      await studio.tick()
    } catch (e) {
      console.error(`studio: ${(e as Error).message} — retrying in ${intervalMs} ms`)
    }
    // several boards, one loop: a short poll while a session is at work, a slower one when all is quiet
    await new Promise((r) => setTimeout(r, studio.busy ? intervalMs : Math.max(intervalMs, 5000)))
  }
}

/** How the session should call this CLI from the repo root: `node <bin>` — `awd` is usually not on PATH. */
function awdCommand(root: string): string {
  // bundled (dist/awd.mjs in the published plugin, unprose#4): this very file; else the workspace launcher
  const self = fileURLToPath(import.meta.url)
  const bin = self.endsWith('.mjs') ? self : fileURLToPath(new URL('../bin/awd.js', import.meta.url))
  return `node ${path.relative(root, bin) || bin}`
}
