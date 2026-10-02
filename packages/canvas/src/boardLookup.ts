// Finding a board by its title (`--board "title:…"`, design_draw { board: "title:…" }) without making duplicates
// (docs/canvas.md "Projects"). Pure: the server decides with it in one step (POST /api/boards { reuse }), and the CLI
// reports what it found.

export interface TitledBoard {
  id: string
  title: string
  kind?: string
  project?: string
  updatedAt?: string
}

export interface TitleLookup<T extends TitledBoard> {
  board?: T
  /** Every board that fits as well as the one picked (more than one = the title is ambiguous; the newest was picked). */
  ambiguous: T[]
  /** Where it was found: the project asked for, the personal space, or anywhere you can see. */
  where?: 'project' | 'personal' | 'any'
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

/**
 * The board titled `title`: in `project` first, then in the personal space, then any board the caller sees; an exact
 * title before one that differs only in case or spaces. Several equally good → the most recently updated, and
 * `ambiguous` lists them all so the caller can say so.
 */
export function pickBoardByTitle<T extends TitledBoard>(boards: T[], title: string, project?: string, match: (b: T) => boolean = () => true): TitleLookup<T> {
  const want = norm(title)
  const exact = boards.filter((b) => norm(b.title) === want && match(b))
  const loose = exact.length ? exact : boards.filter((b) => norm(b.title).toLowerCase() === want.toLowerCase() && match(b))
  const tiers: Array<[TitleLookup<T>['where'], T[]]> = [
    ['project', project && project !== 'personal' ? loose.filter((b) => b.project === project) : []],
    ['personal', loose.filter((b) => (b.project ?? 'personal') === 'personal')],
    ['any', loose],
  ]
  for (const [where, list] of tiers) {
    if (!list.length) continue
    const sorted = [...list].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    return { board: sorted[0], ambiguous: sorted.length > 1 ? sorted : [], where }
  }
  return { ambiguous: [] }
}

/** "3 boards are titled "X" (b_1 [shop], b_2 [personal] …) — used b_1; pass a board id to pick another". */
export function ambiguityNote(title: string, r: TitleLookup<TitledBoard>): string | undefined {
  if (!r.board || r.ambiguous.length < 2) return undefined
  return `${r.ambiguous.length} boards are titled "${norm(title)}" (${r.ambiguous.map((b) => `${b.id} [${b.project ?? 'personal'}]`).join(', ')}) — used ${r.board.id}, the most recently changed; pass a board id to use another`
}
