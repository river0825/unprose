// `--applied <thread>` on `awd design draw` / `awd graph --canvas` (docs/canvas.md "Several agents on one board"):
// the holder of the files has applied a proposal the person agreed to, and redraws. This answers "Applied to <file>"
// in the proposal's thread and — only when this machine says so in its own environment, never from the canvas —
// commits the file (UNPROSE_APPLY_COMMIT=1) with a message linking the thread, and pushes (UNPROSE_APPLY_PUSH=1).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Api } from './projects.js'

type Comment = { id: string; type: string; text?: string; target?: string; data?: Record<string, unknown> }

export interface AppliedResult {
  file?: string
  commit?: string
  pushed?: boolean
  notes: string[]
}

const git = (root: string, args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim()

/** The commit message for an applied proposal: what, who proposed it, and the thread the person agreed in. */
export function appliedMessage(o: { file: string; note?: string; by?: string; link: string }): string {
  const first = (o.note ?? '').split('\n').map((l) => l.trim()).find(Boolean)
  return [`Apply canvas proposal to ${o.file}`, '', ...(first ? [first.slice(0, 200), ''] : []), `Proposed by ${o.by ?? 'the person'}; agreed by the person in ${o.link}`, ''].join('\n')
}

export async function afterApplied(api: Api, o: { base: string; boardId: string; thread: string; root: string; fallbackFile: string; env?: NodeJS.ProcessEnv }): Promise<AppliedResult> {
  const env = o.env ?? process.env
  const notes: string[] = []
  const { board } = await api<{ board: { items: Record<string, Comment> } }>('GET', `/api/boards/${encodeURIComponent(o.boardId)}`)
  const c = board.items[o.thread]
  if (!c || c.type !== 'comment') return { notes: [`no comment ${o.thread} on board ${o.boardId} — nothing answered, nothing committed`] }
  const edit = (c.data?.discuss as { edit?: { file?: unknown; by?: unknown } } | undefined)?.edit
  const proposed = typeof edit?.file === 'string' ? edit.file : undefined
  const file = proposed && fs.existsSync(path.join(o.root, proposed)) ? proposed : o.fallbackFile
  const link = `${o.base}/b/${encodeURIComponent(o.boardId)}?focus=${encodeURIComponent(o.thread)}`
  let commit: string | undefined
  let pushed = false
  if (env.UNPROSE_APPLY_COMMIT === '1') {
    try {
      const top = fs.realpathSync(git(o.root, ['rev-parse', '--show-toplevel']))
      if (top !== fs.realpathSync(o.root)) throw new Error(`${o.root} is not the top of its git repo (${top})`)
      git(o.root, ['add', '--', file])
      git(o.root, ['commit', '-m', appliedMessage({ file, note: c.text, by: typeof edit?.by === 'string' ? edit.by : undefined, link }), '--', file])
      commit = git(o.root, ['rev-parse', '--short', 'HEAD'])
      notes.push(`committed ${file} as ${commit}`)
      if (env.UNPROSE_APPLY_PUSH === '1') {
        try {
          git(o.root, ['push'])
          pushed = true
          notes.push('pushed')
        } catch (e) {
          notes.push(`push failed: ${firstLine(e)}`)
        }
      }
    } catch (e) {
      notes.push(`not committed: ${firstLine(e)}`)
    }
  }
  const text = `Applied to ${file}${commit ? ` — committed ${commit}${pushed ? ' and pushed' : ''}` : ''}. Redrawn from the file.`
  const { ops } = await api<{ ops: unknown[] }>('POST', `/api/boards/${encodeURIComponent(o.boardId)}/template`, { kind: 'freeform', content: { items: [{ id: `applied.${Date.now().toString(36)}`, type: 'comment', text, target: o.thread }] } })
  await api('POST', `/api/boards/${encodeURIComponent(o.boardId)}/ops`, { author: 'agent', ops, note: `applied ${o.thread}` })
  return { file, ...(commit ? { commit } : {}), pushed, notes }
}

const firstLine = (e: unknown) => String((e as { stderr?: string }).stderr || (e as Error).message || e).split('\n').find((l) => l.trim()) ?? 'failed'
