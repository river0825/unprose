// Fakes for the update ports: a fixed "latest release", an installer that records what it would run, and a
// launcher that pretends to start the next server.
import type { CommandSpec, Installer, Launcher, ReleaseInfo, UpdateSource } from '../../ports/update.js'

export class FakeUpdateSource implements UpdateSource {
  calls = 0
  constructor(private release: ReleaseInfo | Error) {}
  async latest(): Promise<ReleaseInfo> {
    this.calls++
    if (this.release instanceof Error) throw this.release
    return this.release
  }
}

export class FakeInstaller implements Installer {
  ran: CommandSpec[] = []
  downloads: { version: string; dir: string }[] = []
  files = new Set<string>()
  constructor(private o: { failOn?: string; dirty?: string[] } = {}) {}
  async run(cmd: CommandSpec, onLine: (line: string) => void): Promise<void> {
    this.ran.push(cmd)
    onLine(`$ ${[cmd.command, ...cmd.args].join(' ')}`)
    if (this.o.failOn && [cmd.command, ...cmd.args].join(' ').includes(this.o.failOn)) throw new Error(`${cmd.command} failed`)
  }
  async dirtyFiles(): Promise<string[]> {
    return this.o.dirty ?? []
  }
  async downloadRuntime(version: string, dir: string): Promise<void> {
    this.downloads.push({ version, dir })
    this.files.add(`${dir}/canvas.mjs`)
  }
  exists(p: string): boolean {
    return this.files.has(p)
  }
}

export class FakeLauncher implements Launcher {
  spawned: { entry: string; args: string[] }[] = []
  /** What the port answers after a spawn (undefined = the new server never comes up). */
  constructor(public answer: string | undefined) {}
  spawnDetached(entry: string, args: string[]): number {
    this.spawned.push({ entry, args })
    return 4242
  }
  async probeVersion(): Promise<string | undefined> {
    return this.spawned.length ? this.answer : undefined
  }
  alive(): boolean {
    return false
  }
  kill(): void {}
}
