// A small process-level EventStorming of Studio's "Ask AI", written in the book's grammar (p.202).
import type { EventStormingContent } from '../src/diagrams/eventStorming.js'

export const studioEs: EventStormingContent = {
  level: 'process',
  people: ['Designer'],
  systems: [{ id: 'canvas', text: 'Canvas' }, { id: 'studio', text: 'awd studio' }, { id: 'herdr', text: 'herdr', external: true, raises: ['pane-opened'] }],
  events: [
    { id: 'ask-sent', text: 'Ask AI sent', phase: 'ask' },
    { id: 'request-picked', text: 'Request picked up', phase: 'ask', pivotal: true },
    { id: 'pane-opened', text: 'Claude pane opened', phase: 'work' },
    { id: 'reply-posted', text: 'Reply posted in thread', phase: 'work' },
    { id: 'idle-closed', text: 'Idle pane closed', time: 'after 30 min', phase: 'work' },
  ],
  commands: [
    { id: 'send-ask', text: 'Send Ask AI', by: 'Designer', system: 'canvas', produces: 'ask-sent' },
    { id: 'pick-request', text: 'Pick up request', system: 'studio', produces: ['request-picked'] },
    { id: 'reply', text: 'Reply in thread', system: 'studio', produces: ['reply-posted'] },
  ],
  policies: [{ id: 'whenever-asked', text: 'Whenever an ask is sent, pick it up', when: 'ask-sent', then: 'pick-request' }],
  readModels: [{ id: 'thread', text: 'Chat thread', updatedBy: ['reply-posted'], informs: ['Designer', 'send-ask'] }],
  hotspots: [{ id: 'cost', text: 'Too many sessions cost tokens?', on: 'pick-request', kind: 'question' }],
  values: [{ text: 'no copy-paste', on: 'reply-posted', sign: '+', currency: 'time' }],
  votes: [{ on: 'cost', count: 2 }],
  milestones: [{ text: 'first chat', before: 'ask-sent' }],
  phases: [{ id: 'ask', text: 'Ask' }, { id: 'work', text: 'Work' }],
  definitions: [{ term: 'brief', text: 'the file studio writes for the session' }],
}
