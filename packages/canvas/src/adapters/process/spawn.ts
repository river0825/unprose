// ProcessSupervisor over child_process.spawn — no shell, so the configured command and
// its args are passed as is. Output lines go to a 50-line ring and, optionally, a log file.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { LOG_LINES, type ProcessInfo, type ProcessSpec, type ProcessSupervisor } from '../../ports/processSupervisor.js'

interface Entry {
  child?: ChildProcess
  running: boolean
  since?: string
  exitedAt?: string
  exitCode?: number | null
  signal?: string | null
  log: string[]
  file?: fs.WriteStream
}

export class SpawnSupervisor implements ProcessSupervisor {
  private entries = new Map<string, Entry>()
  constructor(private graceMs = 5000) {}

  start(key: string, spec: ProcessSpec): ProcessInfo {
    const cur = this.entries.get(key)
    if (cur?.running) return this.info(key)!
    const e: Entry = { running: true, since: new Date().toISOString(), log: cur?.log ?? [] }
    if (spec.logFile) {
      fs.mkdirSync(path.dirname(spec.logFile), { recursive: true })
      e.file = fs.createWriteStream(spec.logFile, { flags: 'a' })
    }
    this.entries.set(key, e)
    const push = (line: string) => {
      e.log.push(line)
      if (e.log.length > LOG_LINES) e.log.splice(0, e.log.length - LOG_LINES)
      e.file?.write(`${new Date().toISOString()} ${line}\n`)
    }
    push(`[start] ${[spec.command, ...spec.args].join(' ')}  (cwd ${spec.cwd})`)
    const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: { ...process.env, ...spec.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    e.child = child
    for (const stream of [child.stdout, child.stderr]) {
      let rest = ''
      stream?.on('data', (d: Buffer) => {
        const lines = (rest + d.toString('utf8')).split('\n')
        rest = lines.pop() ?? ''
        for (const l of lines) if (l.trim()) push(l)
      })
      stream?.on('end', () => rest.trim() && push(rest))
    }
    const finish = (code: number | null, signal: string | null, why?: string) => {
      if (!e.running) return
      e.running = false
      e.exitedAt = new Date().toISOString()
      e.exitCode = code
      e.signal = signal
      push(why ?? `[exited] code ${code ?? '-'}${signal ? `, signal ${signal}` : ''}`)
      e.file?.end()
    }
    child.on('error', (err) => finish(null, null, `[error] ${err.message}`))
    child.on('exit', (code, signal) => finish(code, signal))
    return this.info(key)!
  }

  async stop(key: string): Promise<ProcessInfo> {
    const e = this.entries.get(key)
    if (!e?.running || !e.child) return this.info(key) ?? { running: false, log: [] }
    const child = e.child
    const exited = new Promise<void>((r) => child.once('exit', () => r()))
    child.kill('SIGTERM')
    const timer = setTimeout(() => e.running && child.kill('SIGKILL'), this.graceMs)
    await exited
    clearTimeout(timer)
    return this.info(key)!
  }

  info(key: string): ProcessInfo | undefined {
    const e = this.entries.get(key)
    if (!e) return undefined
    return { running: e.running, pid: e.running ? e.child?.pid : undefined, since: e.since, exitedAt: e.exitedAt, exitCode: e.exitCode, signal: e.signal, log: [...e.log] }
  }

  stopAll(): void {
    for (const e of this.entries.values()) if (e.running) e.child?.kill('SIGTERM')
  }
}
