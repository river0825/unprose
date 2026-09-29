// Compatibility entry over adapters/workers. Keeps the old
// `new RunnerRegistry(name, factoryOptions, force)` signature by building the
// factory here; new code passes a WorkerFactory to application/runnerRegistry.

export * from './types.js'
export {
  FakeWorker, ClaudeCodeWorker, runProcess, AnthropicWorker, CliWorker, CLI_PRESETS, execShell, HerdrWorker, herdrExec,
  createWorker, workerFactory, WORKER_NAMES,
} from '../adapters/workers/index.js'
export type {
  ClaudeCodeOptions, AnthropicWorkerOptions, CliRunnerConfig, CliWorkerOptions, HerdrRunnerConfig, HerdrWorkerOptions, HerdrExec,
  WorkerName, WorkerFactoryOptions,
} from '../adapters/workers/index.js'

import { RunnerRegistry as ApplicationRunnerRegistry } from '../application/runnerRegistry.js'
import { workerFactory, type WorkerFactoryOptions } from '../adapters/workers/index.js'

export class RunnerRegistry extends ApplicationRunnerRegistry {
  constructor(defaultName: string, opts: WorkerFactoryOptions = {}, force?: string) {
    super(defaultName, workerFactory(opts), force)
  }
}
