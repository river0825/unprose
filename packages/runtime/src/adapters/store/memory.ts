// EventStore adapter: memory only — tests, golden runs, `--store memory`.
import { BaseEventStore } from './base.js'

export class MemoryEventStore extends BaseEventStore {
  protected persist(): void {}
}
