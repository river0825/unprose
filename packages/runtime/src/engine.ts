// Compatibility entry: `Engine` wired with the default adapters (shell script
// runner, wall clock) so existing callers and tests keep `new Engine({...})`.
// New code goes through `createRuntime()` in src/index.ts.

import { Engine as ApplicationEngine, projectStates, wallClock, type EngineOptions as ApplicationEngineOptions } from './application/engine.js'
import { shellScriptRunner } from './adapters/process/script.js'

export type EngineOptions = Omit<ApplicationEngineOptions, 'scriptRunner'> & Partial<Pick<ApplicationEngineOptions, 'scriptRunner'>>

export class Engine extends ApplicationEngine {
  constructor(opts: EngineOptions) {
    super({ scriptRunner: shellScriptRunner, clock: wallClock, ...opts })
  }
}

export { projectStates, wallClock }
