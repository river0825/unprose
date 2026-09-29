// ProcessSupervisor for tests: nothing runs; `emit` and `exit` play the child's part.
import { LOG_LINES, type ProcessInfo, type ProcessSpec, type ProcessSupervisor } from '../../ports/processSupervisor.js'

export class FakeSupervisor implements ProcessSupervisor {
  /** Every start that actually launched something (idempotent starts are not recorded). */
  readonly started: Array<{ key: string; spec: ProcessSpec }> = []
  private entries = new Map<string, ProcessInfo>()
  private pid = 1000

  start(key: string, spec: ProcessSpec): ProcessInfo {
    const cur = this.entries.get(key)
    if (cur?.running) return this.info(key)!
    this.started.push({ key, spec })
    this.entries.set(key, { running: true, pid: ++this.pid, since: new Date().toISOString(), log: [...(cur?.log ?? []), `[start] ${[spec.command, ...spec.args].join(' ')}`] })
    return this.info(key)!
  }

  async stop(key: string): Promise<ProcessInfo> {
    this.exit(key, null, 'SIGTERM')
    return this.info(key) ?? { running: false, log: [] }
  }

  info(key: string): ProcessInfo | undefined {
    const e = this.entries.get(key)
    return e && { ...e, log: [...e.log] }
  }

  stopAll(): void {
    for (const key of this.entries.keys()) this.exit(key, null, 'SIGTERM')
  }

  /** Test hook: the child printed a line. */
  emit(key: string, line: string) {
    const e = this.entries.get(key)
    if (!e) return
    e.log.push(line)
    if (e.log.length > LOG_LINES) e.log.splice(0, e.log.length - LOG_LINES)
  }

  /** Test hook: the child exited. */
  exit(key: string, code: number | null, signal: string | null = null) {
    const e = this.entries.get(key)
    if (!e?.running) return
    this.emit(key, `[exited] code ${code ?? '-'}${signal ? `, signal ${signal}` : ''}`)
    Object.assign(e, { running: false, pid: undefined, exitedAt: new Date().toISOString(), exitCode: code, signal })
  }
}
