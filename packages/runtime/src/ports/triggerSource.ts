// Port: TriggerSource — a driving adapter that turns the outside world
// (webhooks, cron ticks, a CLI, a queue) into events on the store.
// The engine never knows which one fed it.

export interface TriggerSource {
  readonly name: string
  start(): Promise<void> | void
  stop(): Promise<void> | void
}
