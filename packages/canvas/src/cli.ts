#!/usr/bin/env node
// awd-canvas — serve | mcp | render | demo
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer, type StudioConfig } from './server.js'
import { createBoardRepository, defaultBoardsDir, isInsidePluginCache } from './adapters/boards/index.js'
import { hasProjects } from './ports/boardRepository.js'
import { SpawnSupervisor } from './adapters/process/index.js'
import { runMcp } from './mcp.js'
import { CanvasClient } from './client.js'
import { render, diagramKinds, contentSchemas } from './templates/index.js'
import { demoBoards } from './demo.js'
import type { DiagramKind } from './model.js'

const USAGE = `awd-canvas — a shared canvas for agents and humans

  awd-canvas serve [--port 4400] [--dir <boards dir>] [--store file|memory]   start the HTTP/WS server (+ web UI if built)
        boards dir: --dir, else $AWD_BOARDS_DIR, else $XDG_DATA_HOME/awd/boards, else ~/.awd/boards
        [--project <dir>]...   serve these projects' boards too (stored in <dir>/.unprose/boards; also registered over the API)
        [--studio-project <dir>]... [--studio-cmd "<command with {project}>"]   let the web start/stop "awd studio" for these projects only
        (--studio <workflow.yaml> still works: it means that file's repo)
  awd-canvas mcp                                    MCP stdio server over a running canvas server (AWD_CANVAS_URL)
  awd-canvas render <kind> <content.json>           print the items a template produces
  awd-canvas demo [--url http://localhost:4400]     create sample boards (card pipeline, 6 diagrams) and print URLs
  awd-canvas outline <boardId>                      print a board's text outline
  awd-canvas diff <boardId> <since>                 print user changes since seq
  awd-canvas card add <boardId> <column> "<title>" [--size S] [--label L]...   add a kanban card
  awd-canvas card move <boardId> <cardId> <column>  move a kanban card to a column (logged like a user drag)
  awd-canvas card moves <boardId> [since]           column moves since seq (what the workflow trigger reads)

kinds: ${diagramKinds.join(', ')}
`

/** Every value of a repeatable flag. */
function flags(args: string[], name: string): string[] {
  return args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []))
}

/** The git top level above `dir` (a `.git` dir or file), else `dir`. */
function repoRoot(dir: string): string {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d
    if (path.dirname(d) === d) return dir
  }
}

/** `--studio-project` dirs (and `--studio` files, meaning their repo) → the projects the web may start studio for (docs/diagrams.md §8). */
function studioConfig(args: string[]): StudioConfig | undefined {
  const dirs = [...flags(args, '--studio-project'), ...flags(args, '--studio').map((f) => repoRoot(path.dirname(path.resolve(f))))]
  if (!dirs.length) return undefined
  const roots = [...new Set(dirs.map((d) => fs.realpathSync(path.resolve(d))))] // fails loudly on a typo, at startup
  const projects = roots.map((root) => ({ root, name: path.basename(root) }))
  // Default: this checkout's awd CLI (absolute), so any project can use it.
  // the bundled CLI next to this file (published plugin, unprose#4), else the workspace one
  const bundled = fileURLToPath(new URL('./awd.mjs', import.meta.url))
  const awd = fs.existsSync(bundled) ? bundled : fileURLToPath(new URL('../../cli/bin/awd.js', import.meta.url))
  const command = flag(args, '--studio-cmd') ?? `${process.execPath} ${awd} studio --project {project}`
  if (!command.includes('{project}') && !command.includes('{file}')) console.warn('awd-canvas: --studio-cmd has no {project}; every project runs the same command')
  return { projects, command, supervisor: new SpawnSupervisor(), logDir: process.env.AWD_LOG_DIR ?? path.join(os.homedir(), 'Library', 'Logs', 'awd') }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i === -1) return undefined
  return args[i + 1]
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  switch (cmd) {
    case 'serve': {
      const port = Number(flag(args, '--port') ?? process.env.PORT ?? 4400)
      const dir = path.resolve(flag(args, '--dir') ?? defaultBoardsDir())
      const storeKind = flag(args, '--store') ?? process.env.AWD_CANVAS_STORE ?? 'file'
      if (storeKind !== 'memory' && isInsidePluginCache(dir))
        console.warn(`awd-canvas: WARNING boards are stored in ${dir}, inside a plugin install — reinstalling the plugin deletes them. Use --dir or AWD_BOARDS_DIR (default: ~/.awd/boards).`)
      const studio = studioConfig(args)
      const store = createBoardRepository(storeKind, dir)
      for (const root of flags(args, '--project')) {
        if (!hasProjects(store)) throw new Error('--project needs the file store')
        const p = store.registerProject(root) // fails loudly on a typo, at startup
        console.log(`  project ${p.id}: boards in ${p.boardsDir}`)
      }
      const s = await startServer({ port, store, studio })
      const where = storeKind === 'memory' ? 'in memory' : `in ${(s.store as { dir?: string }).dir ?? dir}`
      console.log(`awd-canvas listening on ${s.url}  (boards ${where})`)
      for (const p of studio?.projects ?? []) console.log(`  studio can be started from the web for boards of ${p.root}`)
      if (args.includes('--open') && process.platform === 'darwin') execFile('open', [s.url], () => {})
      // Studio children never outlive the server, however it goes down.
      process.on('exit', () => studio?.supervisor.stopAll())
      const stop = () => s.close().then(() => process.exit(0))
      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)
      return
    }
    case 'mcp':
      return runMcp()
    case 'render': {
      const [kind, file] = args
      if (!kind || !file || !diagramKinds.includes(kind as DiagramKind)) return void usage(1)
      const content = JSON.parse(fs.readFileSync(file, 'utf8'))
      const parsed = contentSchemas[kind as DiagramKind].parse(content)
      console.log(JSON.stringify(render(kind as DiagramKind, parsed, { now: new Date().toISOString() }), null, 2))
      return
    }
    case 'demo': {
      const client = new CanvasClient(flag(args, '--url'))
      for (const b of demoBoards) {
        const board = await client.createBoard({ title: b.title, kind: b.kind, content: b.content, meta: b.meta })
        console.log(`${board.kind.padEnd(16)} ${Object.keys(board.items).length.toString().padStart(3)} items  ${client.boardUrl(board.id)}  ${board.title}`)
      }
      return
    }
    case 'outline': {
      const client = new CanvasClient(flag(args, '--url'))
      console.log(await client.outline(args[0]))
      return
    }
    case 'diff': {
      const client = new CanvasClient(flag(args, '--url'))
      const r = await client.diff(args[0], Number(args[1] ?? 0), 'user')
      console.log(r.lines.join('\n') || `(no user changes since ${args[1] ?? 0}; seq ${r.seq})`)
      return
    }
    case 'card': {
      const client = new CanvasClient(flag(args, '--url'))
      const [sub, boardId, a, b] = args
      if (sub === 'add' && boardId && a && b) {
        const labels = args.flatMap((v, i) => (v === '--label' && args[i + 1] ? [args[i + 1]] : []))
        const r = await client.addCard(boardId, { title: b, column: a, size: flag(args, '--size'), assignee: flag(args, '--assignee'), labels: labels.length ? labels : undefined })
        console.log(`${r.card.id}  "${r.card.text}" → ${a}  (seq ${r.seq})`)
        return
      }
      if (sub === 'move' && boardId && a && b) {
        const r = await client.moveCard(boardId, a, b)
        console.log(`"${r.card.text}": ${r.from} → ${r.to}  (seq ${r.seq})`)
        return
      }
      if (sub === 'moves' && boardId) {
        const r = await client.cardMoves(boardId, Number(a ?? 0))
        console.log(r.moves.map((m) => `[${m.seq} ${m.author}] ${m.cardId}  "${m.title}": ${m.from ?? '—'} → ${m.to ?? '—'}`).join('\n') || `(no card moves since ${a ?? 0}; seq ${r.seq})`)
        return
      }
      return void usage(1)
    }
    default:
      usage(cmd && cmd !== '--help' && cmd !== '-h' ? 1 : 0)
  }
}

function usage(code: number) {
  ;(code ? console.error : console.log)(USAGE)
  process.exit(code)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
