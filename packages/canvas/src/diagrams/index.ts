// `@awd/canvas/diagrams` — the pure diagram layer (docs/diagrams.md): content schemas with stable element
// ids, the EventStorming grammar check, and the EventStorming → story map proposer. No node builtins, so
// the CLI and the web share it.
export { slugify, idAllocator, parseTraceRef, DIAGRAM_KEY, TRACE_LABEL, type Trace, type TraceRel } from './ids.js'
export {
  eventStormingSchema,
  normalizeEventStorming,
  ES_COLORS,
  ES_LEGEND,
  type EventStormingContent,
  type EventStormingParsed,
  type EsModel,
  type EsElementKind,
  type EsLevel,
  type EsEvent,
  type EsCommand,
  type EsPolicy,
  type EsReadModel,
  type EsSystem,
  type EsPerson,
} from './eventStorming.js'
export { userStoryMapSchema, normalizeUserStoryMap, type UserStoryMapContent, type UsmModel, type UsmActivity, type UsmStep, type UsmStory } from './userStoryMap.js'
export { checkEventStorming, openHotspotCount, type GrammarFinding, type GrammarRule } from './grammar.js'
export { proposeStories, type StoryCandidate, type StoryProposal, type ProposeOptions } from './proposeStories.js'
export { diagramOf, diagramFrames, diagramSpecOf, diagramFrameId, type DiagramSpec, type DiagramInfo, type DiagramFrameKind } from '../model.js'
