/**
 * Undo/redo history for the review screen. Pure functions so they can be tested.
 *
 * Changes recorded with the same `key` in quick succession (typing a title,
 * holding an arrow key to nudge a cut) merge into one undo step.
 */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
  lastKey?: string
  lastAt?: number
}

export const MERGE_MS = 800
export const MAX_STEPS = 200

export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

export function record<T>(h: History<T>, next: T, key?: string, now = Date.now()): History<T> {
  if (Object.is(next, h.present)) return h
  if (key && key === h.lastKey && h.lastAt !== undefined && now - h.lastAt < MERGE_MS) {
    return { ...h, present: next, future: [], lastAt: now }
  }
  return { past: [...h.past, h.present].slice(-MAX_STEPS), present: next, future: [], lastKey: key, lastAt: now }
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}

export const canUndo = (h: History<unknown>) => h.past.length > 0
export const canRedo = (h: History<unknown>) => h.future.length > 0
