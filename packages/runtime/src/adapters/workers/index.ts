// Every WorkerRuntime adapter, and the factory that names them. Only the
// composition root (and the legacy `workers/index.ts` shim) should import this.

import type { WorkerRuntime, WorkerFactory } from '../../ports/workerRuntime.js'
import { FakeWorker } from './fake.js'
import { ClaudeCodeWorker } from './claudeCode.js'
import { AnthropicWorker } from './anthropic.js'
import { CliWorker } from './cli.js'
import { HerdrWorker } from './herdr.js'
import { HerdrChannel, channelExec } from '../channels/herdr.js'

export { FakeWorker } from './fake.js'
export { ClaudeCodeWorker, runProcess } from './claudeCode.js'
export type { ClaudeCodeOptions } from './claudeCode.js'
export { AnthropicWorker } from './anthropic.js'
export type { AnthropicWorkerOptions } from './anthropic.js'
export { CliWorker, CLI_PRESETS, execShell } from './cli.js'
export type { CliRunnerConfig, CliWorkerOptions } from './cli.js'
export { HerdrWorker, herdrExec } from './herdr.js'
export type { HerdrRunnerConfig, HerdrWorkerOptions, HerdrExec } from './herdr.js'

export type WorkerName = 'fake' | 'claude-code' | 'anthropic' | 'cli' | 'herdr'
export const WORKER_NAMES: WorkerName[] = ['fake', 'claude-code', 'anthropic', 'cli', 'herdr']

export interface WorkerFactoryOptions {
  fixturesDir?: string
  cwd?: string
  mailDir?: string
  /** herdr binary (default `herdr` on PATH). */
  herdrBin?: string
}

export function createWorker(name: WorkerName | string, opts: WorkerFactoryOptions = {}): WorkerRuntime {
  switch (name) {
    case 'fake': return new FakeWorker(opts.fixturesDir)
    case 'claude-code': return new ClaudeCodeWorker({ cwd: opts.cwd })
    case 'anthropic': return new AnthropicWorker()
    case 'cli': return new CliWorker({ cwd: opts.cwd })
    case 'herdr': return new HerdrWorker({ cwd: opts.cwd, mailDir: opts.mailDir, exec: channelExec(new HerdrChannel(opts.herdrBin)) })
    default: throw new Error(`unknown worker "${name}" (${WORKER_NAMES.join(' | ')})`)
  }
}

/** A WorkerFactory (port) over createWorker, for the RunnerRegistry. */
export function workerFactory(opts: WorkerFactoryOptions = {}): WorkerFactory {
  return (name) => createWorker(name, opts)
}
