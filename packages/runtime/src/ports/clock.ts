// Port: Clock — time and scheduling, so the engine and timers can run against
// a fake clock in tests instead of the wall clock.

export interface Clock {
  now(): number
  setInterval(fn: () => void, ms: number): ClockHandle
  setTimeout(fn: () => void, ms: number): ClockHandle
}

export interface ClockHandle {
  clear(): void
}
