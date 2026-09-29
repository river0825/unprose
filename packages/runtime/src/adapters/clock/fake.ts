// Clock adapter for tests: time moves only when `advance` is called.

import type { Clock, ClockHandle } from '../../ports/clock.js'

interface Scheduled { at: number; every?: number; fn: () => void; cancelled: boolean }

export class FakeClock implements Clock {
  private t: number
  private scheduled: Scheduled[] = []
  constructor(start = 0) { this.t = start }

  now() { return this.t }

  setInterval(fn: () => void, ms: number): ClockHandle {
    const s: Scheduled = { at: this.t + ms, every: ms, fn, cancelled: false }
    this.scheduled.push(s)
    return { clear: () => { s.cancelled = true } }
  }

  setTimeout(fn: () => void, ms: number): ClockHandle {
    const s: Scheduled = { at: this.t + ms, fn, cancelled: false }
    this.scheduled.push(s)
    return { clear: () => { s.cancelled = true } }
  }

  /** Move time forward, firing everything that falls due, in order. */
  advance(ms: number) {
    const target = this.t + ms
    for (;;) {
      const next = this.scheduled.filter((s) => !s.cancelled && s.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!next) break
      this.t = next.at
      if (next.every) next.at += next.every
      else next.cancelled = true
      next.fn()
    }
    this.t = target
  }
}
