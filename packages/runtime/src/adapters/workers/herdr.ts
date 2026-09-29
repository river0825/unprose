// The herdr WorkerRuntime adapter lives at src/workers/herdr.ts (its `exec`
// injection is the AgentChannel seam — see adapters/channels/herdr.ts).
export { HerdrWorker, herdrExec } from '../../workers/herdr.js'
export type { HerdrRunnerConfig, HerdrWorkerOptions, HerdrExec } from '../../workers/herdr.js'
