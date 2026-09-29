// @awd/runtime — composition root. This is the one file that knows every
// adapter; everything under application/ and ports/ is wired here.
//
//   createRuntime({ workflow, store: 'file' | 'memory', worker: 'claude-code' })
//     → { engine, store, worker, start(), stop() }

import path from 'node:path'
import { Engine, wallClock } from './application/engine.js'
import { RunnerRegistry } from './application/runnerRegistry.js'
import { FileEventStore, MemoryEventStore } from './adapters/store/index.js'
import { FileMemoryStore, MemoryMemoryStore } from './adapters/memory/index.js'
import { shellScriptRunner } from './adapters/process/script.js'
import { workerFactory, WORKER_NAMES, type WorkerFactoryOptions } from './adapters/workers/index.js'
import { webhookSource, cronSource, canvasSource, hasBoardTriggers } from './adapters/triggers/index.js'
import type { EventStore } from './ports/eventStore.js'
import type { MemoryStore } from './ports/memory.js'
import type { WorkerRuntime } from './ports/workerRuntime.js'
import type { Clock } from './ports/clock.js'
import type { ScriptRunner } from './ports/scriptRunner.js'
import type { TriggerSource } from './ports/triggerSource.js'
import type { LoadedWorkflow } from './adapters/fs/workflowLoader.js'

// ---- ports (types) ----
export type * from './ports/index.js'

// ---- application ----
export { Engine, projectStates, wallClock } from './application/engine.js'
export type { EngineOptions } from './application/engine.js'
export { Timer, type PendingTimer } from './application/timer.js'
export { RunnerRegistry } from './application/runnerRegistry.js'
export { callAi, validateOutput } from './application/executors/ai.js'
export type { CallAiCommand, AiResult } from './application/executors/ai.js'
export { keyFor } from './application/keys.js'
export { newEventId } from './application/ids.js'
export { mergeAgents, parseAgentFile, splitFrontmatter } from './application/agents.js'
export type { AgentFile, AgentSources } from './application/agents.js'
export { blockDetails, keyLines, keyRanges, workflowFiles } from './application/blockDetails.js'
export type { BlockDetail, BlockDetails, WorkflowSource, DetailOptions } from './application/blockDetails.js'
export { MODEL_ALIASES, renderPrompt, extractJsonAnswer, jsonFromText } from './application/prompting.js'
export { renderMemory, syncMemory, memoryEntryFromEvent, MEMORY_LEARNED } from './application/memory.js'
export { REFLECTION_NOTED, signalsOf, patternsOf, decisionsOf, cardForPattern, renderPatterns, reasonClass, guardFor } from './application/reflection.js'
export type { Signal, Pattern, ReflectionCard, ReflectionData } from './application/reflection.js'
export { Studio, type StudioOptions, type StudioAction } from './application/studioLoop.js'
export { discussRequests, sessionName, studioScope, renderBrief, promptFor, ackComment, blockOf, STUDIO_MODELS } from './application/studio.js'
export type { DiscussRequest, StudioModel } from './application/studio.js'
export { canvasCards } from './adapters/canvas/cards.js'
export { canvasBoardHttp } from './adapters/canvas/board.js'
export { FakeCanvasBoard } from './adapters/canvas/fake.js'
export { FileStudioStore, MemoryStudioStore } from './adapters/fs/studioStore.js'
export type { UpsertResult } from './adapters/canvas/cards.js'

// ---- adapters ----
export { FileEventStore, MemoryEventStore, BaseEventStore } from './adapters/store/index.js'
export { loadWorkflow, resolveAgents, readAgentFiles } from './adapters/fs/workflowLoader.js'
export type { LoadedWorkflow } from './adapters/fs/workflowLoader.js'
export { runScript, lastJsonLine, shellScriptRunner } from './adapters/process/script.js'
export { createWebhookServer, fireWebhook, startCron, fireCron, webhookSource, cronSource, canvasSource, hasBoardTriggers, movesFromChanges, fireBoardMove, cursorFor, kanbanScope } from './adapters/triggers/index.js'
export type { WebhookServerOptions, TriggerResult, CronHandle } from './adapters/triggers/index.js'
export {
  FakeWorker, ClaudeCodeWorker, runProcess, AnthropicWorker, CliWorker, CLI_PRESETS, execShell, HerdrWorker, herdrExec,
  createWorker, workerFactory, WORKER_NAMES,
} from './adapters/workers/index.js'
export type {
  ClaudeCodeOptions, AnthropicWorkerOptions, CliRunnerConfig, CliWorkerOptions, HerdrRunnerConfig, HerdrWorkerOptions, HerdrExec,
  WorkerName, WorkerFactoryOptions,
} from './adapters/workers/index.js'
export { HerdrChannel, channelExec } from './adapters/channels/herdr.js'
export { FakeAgentChannel } from './adapters/channels/fake.js'
export { FileMailbox } from './adapters/mailbox/file.js'
export { FileMemoryStore, MemoryMemoryStore } from './adapters/memory/index.js'
export { MemoryMailbox } from './adapters/mailbox/memory.js'
export { FakeClock } from './adapters/clock/fake.js'

// ---- the runtime, assembled ----

export type StoreKind = 'file' | 'memory'

export interface RuntimeOptions {
  workflow: LoadedWorkflow
  /** `file` (NDJSON under the workflow's store dir) or `memory`. Default file. */
  store?: StoreKind | EventStore
  /** Long-term agent memory. Default: follows `store` (file → <store-dir>/memory, memory → RAM). */
  memory?: StoreKind | MemoryStore | false
  /** Default runner name (`--worker`); each agent may pick its own `runner:`. */
  worker?: string | WorkerRuntime
  /** `fake` forces every agent onto the fake worker (tests, dry runs). */
  forceWorker?: string
  env?: Record<string, string>
  log?: (line: string) => void
  /** Webhook port; `false` = no webhook server. Default 4311. */
  port?: number | false
  cron?: boolean
  clock?: Clock
  scriptRunner?: ScriptRunner
  timerIntervalMs?: number
  /** Extra factory options (fixtures, mail dir, herdr binary). */
  workers?: WorkerFactoryOptions
}

export interface Runtime {
  engine: Engine
  store: EventStore
  memory?: MemoryStore
  worker: WorkerRuntime
  triggers: TriggerSource[]
  start(): Promise<void>
  stop(): Promise<void>
}

export function createRuntime(opts: RuntimeOptions): Runtime {
  const wf = opts.workflow
  const env = opts.env ?? (process.env as Record<string, string>)
  const store: EventStore =
    typeof opts.store === 'object' ? opts.store
    : opts.store === 'memory' ? new MemoryEventStore()
    : new FileEventStore(path.join(wf.storeDir, 'events.ndjson'))

  const memoryKind = opts.memory ?? (typeof opts.store === 'string' ? opts.store : opts.store === undefined ? 'file' : 'memory')
  const memory: MemoryStore | undefined =
    memoryKind === false ? undefined
    : typeof memoryKind === 'object' ? memoryKind
    : memoryKind === 'memory' ? new MemoryMemoryStore()
    : new FileMemoryStore(path.join(wf.storeDir, 'memory'))

  const workerName = typeof opts.worker === 'string' ? opts.worker : undefined
  if (workerName && !WORKER_NAMES.includes(workerName as never)) throw new Error(`unknown worker "${workerName}" (${WORKER_NAMES.join(' | ')})`)
  const factoryOpts: WorkerFactoryOptions = { fixturesDir: wf.fixturesDir, cwd: wf.dir, mailDir: path.join(wf.storeDir, 'mail'), ...opts.workers }
  const worker: WorkerRuntime =
    typeof opts.worker === 'object' ? opts.worker
    : new RunnerRegistry(workerName ?? 'fake', workerFactory(factoryOpts), opts.forceWorker ?? (workerName === 'fake' ? 'fake' : undefined))

  const engine = new Engine({
    def: wf.def, store, worker, memory, roles: wf.roles, agents: wf.agents, cwd: wf.dir, env,
    log: opts.log, clock: opts.clock ?? wallClock, scriptRunner: opts.scriptRunner ?? shellScriptRunner, timerIntervalMs: opts.timerIntervalMs,
  })

  const triggers: TriggerSource[] = []
  if (opts.port !== false) triggers.push(webhookSource({ def: wf.def, store, engine, env, port: opts.port ?? 4311, log: opts.log }))
  if (opts.cron !== false) triggers.push(cronSource(wf.def, store, env, opts.log))
  // `on: board` — a kanban board on the canvas is the event source (card moves → events).
  if (hasBoardTriggers(wf.def)) triggers.push(canvasSource({ def: wf.def, store, env, log: opts.log }))

  return {
    engine, store, memory, worker, triggers,
    async start() {
      await engine.start()
      for (const t of triggers) await t.start()
    },
    async stop() {
      for (const t of triggers) await t.stop()
      engine.stop()
    },
  }
}
// Work trackers (docs/diagrams.md §6)
export type { WorkTracker, TrackerCard, CardDraft } from './ports/workTracker.js'
export { CanvasKanbanTracker, TextFileTracker, FakeWorkTracker, parseTasks, renderTasks, type CanvasKanbanOptions, type TextFileTrackerOptions, type TasksDoc } from './adapters/tracker/index.js'
// Studio per project, one session per board (docs/diagrams.md §8)
export { inProject, boardScope, boardSessionName, forkSessionName, diagramOf, diagramLines, boardSources, promptWarm, promptForFollowUp, tabLabel } from './application/studio.js'
export type { DiagramRef } from './application/studio.js'
export { FakeCanvas } from './adapters/canvas/fake.js'
export type { StudioStatus, StudioSession, StudioJob, StudioChat, BoardCursor } from './ports/studioStore.js'
export type { BoardSummary } from './ports/canvasBoard.js'
