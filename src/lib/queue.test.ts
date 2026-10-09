import { describe, expect, it } from 'vitest'
import { insertAfter, nextIndex, previousIndex, removeAt, shuffleFrom } from './queue'

describe('nextIndex', () => {
  it('moves on and stops at the end', () => {
    expect(nextIndex(0, 3, 'off', true)).toBe(1)
    expect(nextIndex(2, 3, 'off', true)).toBeNull()
  })
  it('starts over with repeat all', () => {
    expect(nextIndex(2, 3, 'all', true)).toBe(0)
  })
  it('repeats one song only when it ends by itself', () => {
    expect(nextIndex(1, 3, 'one', true)).toBe(1)
    expect(nextIndex(1, 3, 'one', false)).toBe(2) // the Next button still skips
  })
  it('handles an empty queue', () => {
    expect(nextIndex(-1, 0, 'all', true)).toBeNull()
  })
})

describe('previousIndex', () => {
  it('goes back, wrapping only with repeat all', () => {
    expect(previousIndex(2, 3, 'off')).toBe(1)
    expect(previousIndex(0, 3, 'off')).toBe(0)
    expect(previousIndex(0, 3, 'all')).toBe(2)
  })
})

describe('shuffleFrom', () => {
  it('keeps the chosen song first and every song once', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    let seed = 0.37
    const random = () => (seed = (seed * 9301 + 0.49297) % 1)
    const out = shuffleFrom(items, 2, random)
    expect(out[0]).toBe('c')
    expect([...out].sort()).toEqual(items)
  })
})

describe('insertAfter', () => {
  it('puts songs right after the current one', () => {
    expect(insertAfter(['a', 'b', 'c'], 0, ['x', 'y'])).toEqual(['a', 'x', 'y', 'b', 'c'])
  })
})

describe('removeAt', () => {
  it('keeps playing the same song when an earlier one is removed', () => {
    expect(removeAt(['a', 'b', 'c'], 2, 0)).toEqual({ queue: ['b', 'c'], index: 1 })
  })
  it('moves to the next song when the current one is removed', () => {
    expect(removeAt(['a', 'b', 'c'], 1, 1)).toEqual({ queue: ['a', 'c'], index: 1 })
    expect(removeAt(['a', 'b'], 1, 1)).toEqual({ queue: ['a'], index: 0 })
  })
  it('empties the queue', () => {
    expect(removeAt(['a'], 0, 0)).toEqual({ queue: [], index: -1 })
  })
})
