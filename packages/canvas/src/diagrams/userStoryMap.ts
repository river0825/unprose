// User story map content (docs/diagrams.md §5): backbone activities → steps → stories, with release
// cut lines top → bottom. Stories carry acceptance criteria and trace links (usually derived-from an
// EventStorming command). Pure and builtin-free.
import { z } from 'zod'
import { idAllocator, type Trace } from './ids.js'

const trace = z.object({ from: z.string(), rel: z.enum(['derived-from', 'groups', 'shows']) })

export const userStoryMapSchema = z.object({
  activities: z
    .array(
      z.object({
        id: z.string().optional(),
        text: z.string(),
        steps: z.array(
          z.object({
            id: z.string().optional(),
            text: z.string(),
            stories: z
              .array(
                z.object({
                  id: z.string().optional(),
                  text: z.string(),
                  release: z.string().optional(),
                  /** Yes/no checks — for a story from EventStorming: events produced, read models shown (p.279). */
                  acceptance: z.array(z.string()).optional(),
                  traces: z.array(trace).optional(),
                }),
              )
              .default([]),
          }),
        ),
      }),
    )
    .min(1),
  /** Release cut lines, top → bottom. Stories with an unknown/absent release fall into the last lane ("Later"). */
  releases: z.array(z.string()).default([]),
})
export type UserStoryMapContent = z.input<typeof userStoryMapSchema>

export interface UsmStory { id: string; text: string; release: string; acceptance: string[]; traces: Trace[] }
export interface UsmStep { id: string; text: string; stories: UsmStory[] }
export interface UsmActivity { id: string; text: string; steps: UsmStep[] }
export interface UsmModel { activities: UsmActivity[]; releases: string[] }

/** Ids for every element, releases completed with "Later" when some story needs it. */
export function normalizeUserStoryMap(raw: UserStoryMapContent): UsmModel {
  const c = userStoryMapSchema.parse(raw)
  const alloc = idAllocator()
  const releases = c.releases.length ? [...c.releases] : ['Now']
  const unassigned = c.activities.some((a) => a.steps.some((s) => s.stories.some((st) => !st.release || !releases.includes(st.release))))
  if (unassigned && !releases.includes('Later')) releases.push('Later')
  const releaseOf = (r?: string) => (r && releases.includes(r) ? r : releases[releases.length - 1])
  // Declare activities and steps before stories so their ids read naturally ('write-workflow-yaml').
  const activityIds = c.activities.map((a) => alloc(a.id, a.text, 'activity'))
  const stepIds = c.activities.map((a) => a.steps.map((s) => alloc(s.id, s.text, 'step')))
  return {
    releases,
    activities: c.activities.map((a, ai) => ({
      id: activityIds[ai],
      text: a.text,
      steps: a.steps.map((s, si) => ({
        id: stepIds[ai][si],
        text: s.text,
        stories: s.stories.map((st) => ({ id: alloc(st.id, st.text, 'story'), text: st.text, release: releaseOf(st.release), acceptance: st.acceptance ?? [], traces: st.traces ?? [] })),
      })),
    })),
  }
}
