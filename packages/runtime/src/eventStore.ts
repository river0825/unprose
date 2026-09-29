// Compatibility entry — the port lives in ports/eventStore.ts, the adapters in adapters/store/.
export type { EventStore, Listener, EventDraft } from './ports/eventStore.js'
export { MemoryEventStore, FileEventStore, BaseEventStore } from './adapters/store/index.js'
export { newEventId } from './application/ids.js'
