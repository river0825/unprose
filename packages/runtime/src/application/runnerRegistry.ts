// Routes each ai command to the WorkerRuntime its agent asked for. The
// registry knows nothing about concrete adapters — the composition root hands
// it a factory.

import type { WorkerRuntime, WorkerRequest, WorkerFactory } from '../ports/workerRuntime.js'

export class RunnerRegistry implements WorkerRuntime {
  readonly name: string
  private cache = new Map<string, WorkerRuntime>()

  /**
   * `defaultName` is the `--worker` flag; `force` (e.g. `fake` in tests) wins
   * over every agent's own `runner`.
   */
  constructor(private defaultName: string, private factory: WorkerFactory, private force?: string) {
    this.name = force ?? defaultName
  }

  for(runner: string | undefined): WorkerRuntime {
    const name = this.force ?? runner ?? this.defaultName
    let w = this.cache.get(name)
    if (!w) {
      w = this.factory(name)
      this.cache.set(name, w)
    }
    return w
  }

  run(req: WorkerRequest) {
    return this.for(req.runner).run(req)
  }
}
