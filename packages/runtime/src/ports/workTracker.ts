// Port: WorkTracker — where work items (cards) live: the canvas kanban, a text
// file in the repo, later Trello / Jira / Linear (docs/diagrams.md §6). A card
// groups several user stories; `stories` are trace refs back to the story map.

export interface TrackerCard {
  /** Stable id, owned by us (the story map / the person), not by the tracker. */
  id: string
  title: string
  description?: string
  /** Column / status name as the person sees it: 'Backlog', 'Ready', … */
  column: string
  labels?: string[]
  /** `groups` traces: '<story-map key>/<story id>'. */
  stories: string[]
}

export type CardDraft = Omit<TrackerCard, 'column'> & { column?: string }

export interface WorkTracker {
  /** Adapter name for logs: 'canvas', 'text', 'trello', … */
  readonly name: string
  /** Column names, in order. */
  columns(): Promise<string[]>
  list(): Promise<TrackerCard[]>
  /** Create the card (in `column`, else the first column) or update its title / description / labels / stories. */
  upsert(card: CardDraft): Promise<{ created: boolean }>
  move(cardId: string, column: string): Promise<void>
}
