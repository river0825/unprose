// `@awd/canvas/diagrams` — the pure diagram layer (docs/diagrams.md): content schemas with stable element
// ids, the EventStorming grammar check, and the EventStorming → story map proposer. No node builtins, so
// the CLI and the web share it.
export { slugify, idAllocator, parseTraceRef, DIAGRAM_KEY, TRACE_LABEL, TRACE_RELS, traceSchema, annotationSchema, annotationsSchema, type Trace, type TraceRel, type AnnotationEntry } from './ids.js'
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
export { WHICH_DIAGRAM, DOMAIN_STORY_METHOD, LAYOUT_NEVER_THE_STORY, tellBack } from './guidance.js'
export {
  domainStorySchema,
  normalizeDomainStory,
  checkDomainStory,
  readSentence,
  circled,
  DS_ACTOR_KINDS,
  DS_OBJECT_KINDS,
  DS_GRANULARITY,
  type DomainStoryContent,
  type DsModel,
  type DsActor,
  type DsWorkObject,
  type DsSentence,
  type DsFinding,
  type DsRule,
} from './domainStory.js'
export {
  uiMockSchema,
  uiNodeSchema,
  normalizeUiMock,
  layoutScreen,
  checkUiMock,
  lintUiMock,
  attachUiFindings,
  locateUi,
  uiPathText,
  walkUi,
  textWidth,
  UI_TYPES,
  UI_ICONS,
  UI_DEVICES,
  UI_GUTTER,
  UI_CALLOUT,
  uiGutterOf,
  uiCalloutSize,
  uiCalloutOf,
  isUiScreen,
  noteWordIn,
  NOTE_WORDS,
  NOTE_WORDS_CJK,
  NOTE_RULE,
  NOTE_RULE_MESSAGE,
  type UiMockContent,
  type UiModel,
  type UiScreen,
  type UiEl,
  type UiBox,
  type UiFinding,
  type UiPath,
  type UiType,
} from './uiMock.js'
export { checkEventStorming, openHotspotCount, type GrammarFinding, type GrammarRule } from './grammar.js'
export { proposeStories, type StoryCandidate, type StoryProposal, type ProposeOptions } from './proposeStories.js'
export { fromEgon, toEgon, type EgonImport } from './egon.js'
export { proposeFromDomainStory, type ProposeFromDomainStoryOptions } from './proposeFromDomainStory.js'
export { diagramOf, diagramFrames, diagramSpecOf, diagramFrameId, type DiagramSpec, type DiagramInfo, type DiagramFrameKind } from '../model.js'
export { gotoTargets, rankTargets, type GotoTarget } from './goto.js'
export { contentSchemaFor, unknownFields, unknownContentFields, type UnknownField } from './check.js'
export { KIND_ALIASES, designFromObject, yamlCommentHint, lintDesignContent, annotationFindings, withDesignFindings, findingLine, frameOf, growFrame, proposalOps, type DesignFile, type DesignFinding } from './designFile.js'
export {
  placedByUser,
  keepUserLayout,
  isResolved,
  planRedraw,
  explainRedraw,
  redrawInputs,
  emptyRedrawInputs,
  foldRedrawInputs,
  redrawInputsToJson,
  redrawInputsFromJson,
  originsOf,
  isRedrawNote,
  planLines,
  planSummary,
  type RedrawScope,
  type RedrawPlan,
  type RedrawResult,
  type RedrawInputs,
  type RedrawInputsJson,
  type PlanLine,
  type ItemOrigin,
  type LoggedChange,
  type TemplateOp,
  type BoardItem as RedrawItem,
  type UserChange,
} from './redraw.js'
export { LAYOUT_LOCK, ownLock, layoutLock } from '../model.js'
