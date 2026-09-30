// Installer + Launcher adapters: child processes for the upgrade commands, a checksum-verified runtime
// download, and the detached start of the next server (docs/canvas.md "Updating").
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CommandSpec, Installer, Launcher } from '../../ports/update.js'

const lines = (onLine: (l: string) => void) => {
  let rest = ''
  return (chunk: Buffer) => {
    const text = rest + chunk.toString('utf8')
    const parts = text.split(/\r?\n/)
    rest = parts.pop() ?? ''
    for (const p of parts) if (p.trim()) onLine(p)
  }
}

const execText = (cmd: string, args: string[], cwd?: string) =>
  new Promise<string>((resolve, reject) => execFile(cmd, args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (err, out, errOut) => (err ? reject(new Error((errOut || err.message).trim())) : resolve(out))))

export interface ChildInstallerOptions {
  repo: string
  /** Release download base (default https://github.com/<repo>/releases/download); AWD_RUNTIME_URL overrides. */
  base?: string
}

export class ChildInstaller implements Installer {
  constructor(private o: ChildInstallerOptions) {}

  run(cmd: CommandSpec, onLine: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout.on('data', lines(onLine))
      child.stderr.on('data', lines(onLine))
      child.on('error', (e) => reject(new Error(`${cmd.command}: ${e.message}`)))
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${[cmd.command, ...cmd.args].join(' ')} exited with ${code}`))))
    })
  }

  async dirtyFiles(cwd: string): Promise<string[]> {
    const out = await execText('git', ['status', '--porcelain', '--untracked-files=no'], cwd)
    return out.split('\n').map((l) => l.slice(3).trim()).filter(Boolean)
  }

  async downloadRuntime(version: string, dir: string, onLine: (line: string) => void): Promise<void> {
    const name = `unprose-runtime-v${version}.tgz`
    const base = (process.env.AWD_RUNTIME_URL || this.o.base || `https://github.com/${this.o.repo}/releases/download`).replace(/\/$/, '')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unprose-upgrade-'))
    try {
      const tgz = path.join(tmp, name)
      const sum = path.join(tmp, `${name}.sha256`)
      try {
        for (const [file, url] of [[tgz, `${base}/v${version}/${name}`], [sum, `${base}/v${version}/${name}.sha256`]] as const) {
          onLine(`downloading ${url}`)
          const r = await fetch(url)
          if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
          fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
        }
      } catch (e) {
        // a private repository needs the gh login for release assets
        onLine(`direct download failed (${(e as Error).message}); trying gh release download`)
        await execText('gh', ['release', 'download', `v${version}`, '-R', this.o.repo, '-p', name, '-p', `${name}.sha256`, '-D', tmp, '--clobber'])
      }
      const want = fs.readFileSync(sum, 'utf8').trim().split(/\s+/)[0]
      const got = createHash('sha256').update(fs.readFileSync(tgz)).digest('hex')
      if (!want || want !== got) throw new Error(`checksum mismatch for ${name}`)
      const out = path.join(tmp, 'x')
      fs.mkdirSync(out)
      await execText('tar', ['-xzf', tgz, '-C', out])
      fs.mkdirSync(path.dirname(dir), { recursive: true })
      fs.rmSync(dir, { recursive: true, force: true })
      fs.renameSync(out, dir)
      onLine(`unpacked into ${dir}`)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  exists(p: string): boolean {
    return fs.existsSync(p)
  }
}

export class ProcessLauncher implements Launcher {
  spawnDetached(entry: string, args: string[], env: Record<string, string>, logFile: string): number {
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    const fd = fs.openSync(logFile, 'a')
    const child = spawn(process.execPath, [entry, ...args], { detached: true, stdio: ['ignore', fd, fd], env })
    child.unref()
    fs.closeSync(fd)
    return child.pid ?? -1
  }

  async probeVersion(port: number): Promise<string | undefined> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 800)
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: ctl.signal })
      if (!r.ok) return undefined
      const j = (await r.json()) as { version?: unknown }
      return typeof j.version === 'string' ? j.version : undefined
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }

  alive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  kill(pid: number): void {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
}
