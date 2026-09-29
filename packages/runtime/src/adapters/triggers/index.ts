// Driving adapters as TriggerSources, so the composition root can start and
// stop them uniformly (and a test can swap in a fake source).

import type { TriggerSource } from '../../ports/triggerSource.js'
import { createWebhookServer, type WebhookServerOptions } from './webhook.js'
import { startCron, type CronHandle } from './cron.js'
import { canvasSource, type CanvasTriggerOptions } from './canvasTrigger.js'

export { createWebhookServer, fireWebhook } from './webhook.js'
export { startCron, fireCron } from './cron.js'
export type { WebhookServerOptions, TriggerResult } from './webhook.js'
export type { CronHandle } from './cron.js'
export { canvasSource, movesFromChanges, fireBoardMove, cursorFor, kanbanScope } from './canvasTrigger.js'
export type { CanvasTriggerOptions, CardMove } from './canvasTrigger.js'

/** True when the workflow has at least one `on: board` trigger (the composition root asks before starting one). */
export function hasBoardTriggers(def: CanvasTriggerOptions['def']): boolean {
  return def.triggers.some((t) => t.on === 'board')
}

export function webhookSource(opts: WebhookServerOptions): TriggerSource {
  let server: ReturnType<typeof createWebhookServer> | undefined
  return {
    name: 'webhook',
    start: () =>
      new Promise<void>((res) => {
        server = createWebhookServer(opts)
        server.listen(opts.port ?? 4311, opts.host, res)
      }),
    stop: () => new Promise<void>((res) => (server ? server.close(() => res()) : res())),
  }
}

export function cronSource(...args: Parameters<typeof startCron>): TriggerSource {
  let handle: CronHandle | undefined
  return {
    name: 'cron',
    start: () => { handle = startCron(...args) },
    stop: () => handle?.stop(),
  }
}
