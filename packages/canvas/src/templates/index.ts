import { z } from 'zod'
import type { DiagramKind, Item } from '../model.js'
import { eventStormingSchema, renderEventStorming } from './event-storming.js'
import { userStoryMapSchema, renderUserStoryMap } from './user-story-map.js'
import { userJourneySchema, renderUserJourney } from './user-journey.js'
import { wireframeSchema, renderWireframe } from './wireframe.js'
import { workflowSchema, renderWorkflow } from './workflow.js'
import { kanbanSchema, renderKanban } from './kanban.js'
import { make, offsetAll, stableId, type RenderOpts } from './util.js'

export * from './util.js'
export { eventStormingSchema, renderEventStorming } from './event-storming.js'
export { userStoryMapSchema, renderUserStoryMap } from './user-story-map.js'
export { userJourneySchema, renderUserJourney } from './user-journey.js'
export { wireframeSchema, renderWireframe } from './wireframe.js'
export { workflowSchema, renderWorkflow } from './workflow.js'
export { frameOrigin, placeInFrame, traceWires, resolveTraces, traceTarget, type FrameRequest, type UnresolvedTrace } from './frame.js'
export { kanbanSchema, renderKanban, cardHeight, columnsOf, cardsIn, bottomOf, columnId, cardId, CARD_SIZES, CARD_W, COLUMN_W } from './kanban.js'

const itemTypes = ['sticky', 'text', 'frame', 'lane', 'arrow', 'comment', 'wireframe', 'card'] as const
const colorTokens = ['orange', 'blue', 'yellow', 'pale-yellow', 'lilac', 'green', 'pink', 'red', 'purple', 'grey', 'white'] as const

/** Freeform: items as the agent wants them; missing geometry is filled in on a grid. */
export const freeformSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        type: z.enum(itemTypes).default('sticky'),
        text: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().optional(),
        h: z.number().optional(),
        color: z.enum(colorTokens).optional(),
        role: z.string().optional(),
        parent: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        label: z.string().optional(),
        target: z.string().optional(),
        data: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1),
})
export type FreeformContent = z.input<typeof freeformSchema>

export function renderFreeform(raw: FreeformContent, opts: RenderOpts = {}): Item[] {
  const c = freeformSchema.parse(raw)
  const now = opts.now ?? new Date().toISOString()
  const scope = opts.scope ?? 'ff'
  const items = c.items.map((it, i) =>
    make(
      {
        id: it.id ?? stableId(scope, it.role ?? it.type, it.text ?? `#${i}`),
        type: it.type,
        x: it.x ?? 40 + (i % 6) * 190,
        y: it.y ?? 40 + Math.floor(i / 6) * 140,
        w: it.w ?? (it.type === 'frame' || it.type === 'lane' ? 600 : it.type === 'arrow' ? 0 : 160),
        h: it.h ?? (it.type === 'frame' || it.type === 'lane' ? 400 : it.type === 'arrow' ? 0 : 110),
        text: it.text,
        color: it.color ?? (it.type === 'comment' ? 'yellow' : it.type === 'sticky' ? 'yellow' : 'white'),
        role: it.role,
        parent: it.parent,
        from: it.from,
        to: it.to,
        label: it.label,
        target: it.target,
        data: it.data,
      },
      now,
    ),
  )
  return offsetAll(items, opts.at)
}

export const contentSchemas = {
  'event-storming': eventStormingSchema,
  'user-story-map': userStoryMapSchema,
  'user-journey': userJourneySchema,
  wireframe: wireframeSchema,
  workflow: workflowSchema,
  kanban: kanbanSchema,
  freeform: freeformSchema,
} as const satisfies Record<DiagramKind, z.ZodTypeAny>

export type ContentOf<K extends DiagramKind> = z.input<(typeof contentSchemas)[K]>

/** Render any diagram kind from its structured content. Pure. */
export function render(kind: DiagramKind, content: unknown, opts: RenderOpts = {}): Item[] {
  switch (kind) {
    case 'event-storming':
      return renderEventStorming(content as never, opts)
    case 'user-story-map':
      return renderUserStoryMap(content as never, opts)
    case 'user-journey':
      return renderUserJourney(content as never, opts)
    case 'wireframe':
      return renderWireframe(content as never, opts)
    case 'workflow':
      return renderWorkflow(content as never, opts)
    case 'kanban':
      return renderKanban(content as never, opts)
    case 'freeform':
      return renderFreeform(content as never, opts)
    default: {
      const _exhaustive: never = kind
      throw new Error(`unknown diagram kind ${String(_exhaustive)}`)
    }
  }
}

export const diagramKinds = Object.keys(contentSchemas) as DiagramKind[]
