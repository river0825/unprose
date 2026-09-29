// WorkTracker adapter for tests: cards in memory, calls recorded.

import type { CardDraft, TrackerCard, WorkTracker } from '../../ports/workTracker.js'

export class FakeWorkTracker implements WorkTracker {
  readonly name = 'fake'
  readonly calls: string[][] = []
  cards: TrackerCard[] = []
  constructor(private cols: string[] = ['Backlog', 'Ready', 'Done']) {}
  async columns() { return this.cols.slice() }
  async list() { this.calls.push(['list']); return this.cards.map((c) => ({ ...c })) }
  async upsert(d: CardDraft) {
    this.calls.push(['upsert', d.id])
    const was = this.cards.find((c) => c.id === d.id)
    if (was) Object.assign(was, d, { column: d.column ?? was.column })
    else this.cards.push({ ...d, column: d.column ?? this.cols[0] })
    return { created: !was }
  }
  async move(id: string, column: string) {
    this.calls.push(['move', id, column])
    const c = this.cards.find((x) => x.id === id)
    if (!c) throw new Error(`no card ${id}`)
    c.column = column
  }
}
