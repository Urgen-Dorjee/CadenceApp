import { describe, expect, it } from 'vitest'
import { MAX_STEPS, MERGE_MS, canRedo, canUndo, record, redo, startHistory, undo } from './history'

describe('history', () => {
  it('undoes and redoes in order', () => {
    let h = startHistory(1)
    h = record(h, 2, undefined, 0)
    h = record(h, 3, undefined, 10_000)
    h = undo(h)
    expect(h.present).toBe(2)
    h = undo(h)
    expect(h.present).toBe(1)
    expect(canUndo(h)).toBe(false)
    h = redo(h)
    expect(h.present).toBe(2)
    expect(canRedo(h)).toBe(true)
  })

  it('a new change after undo drops the redo steps', () => {
    let h = record(record(startHistory('a'), 'b', undefined, 0), 'c', undefined, 10_000)
    h = record(undo(h), 'd', undefined, 20_000)
    expect(h.present).toBe('d')
    expect(canRedo(h)).toBe(false)
    expect(undo(h).present).toBe('b')
  })

  it('merges quick changes with the same key into one step', () => {
    let h = startHistory(0)
    h = record(h, 0.1, 'nudge-cut-2', 0)
    h = record(h, 0.2, 'nudge-cut-2', MERGE_MS - 1)
    h = record(h, 0.3, 'nudge-cut-2', 2 * MERGE_MS - 2)
    expect(h.past).toEqual([0])
    expect(undo(h).present).toBe(0)
  })

  it('does not merge different keys or slow changes', () => {
    let h = startHistory(0)
    h = record(h, 1, 'title-a', 0)
    h = record(h, 2, 'title-b', 10)
    h = record(h, 3, 'title-b', 10 + MERGE_MS)
    expect(h.past).toEqual([0, 1, 2])
  })

  it('ignores a change to the same value and keeps a bounded history', () => {
    const value = { x: 1 }
    const h = startHistory(value)
    expect(record(h, value)).toBe(h)
    let long = startHistory(0)
    for (let i = 1; i <= MAX_STEPS + 50; i++) long = record(long, i, undefined, i * 10_000)
    expect(long.past.length).toBe(MAX_STEPS)
  })
})
