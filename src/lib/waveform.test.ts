import { describe, expect, it } from 'vitest'
import { barLayout, columnPeaks, segmentAt } from './waveform'

describe('columnPeaks', () => {
  it('max-pools peaks into pixel columns', () => {
    expect(Array.from(columnPeaks([0.1, 0.9, 0.2, 0.4], 2))).toEqual([expect.closeTo(0.9), expect.closeTo(0.4)])
  })
  it('stretches when there are fewer peaks than columns', () => {
    expect(columnPeaks([0.5, 1], 4)).toHaveLength(4)
  })
  it('handles empty input', () => {
    expect(columnPeaks([], 10)).toHaveLength(10)
    expect(columnPeaks([1], 0)).toHaveLength(0)
  })
})

describe('segmentAt', () => {
  const segments = [
    { start: 0, end: 100 },
    { start: 100, end: 250 },
    { start: 300, end: 400 },
  ]
  it('finds the segment containing a time', () => {
    expect(segmentAt(segments, 0)).toBe(0)
    expect(segmentAt(segments, 100)).toBe(1)
    expect(segmentAt(segments, 399.9)).toBe(2)
  })
  it('returns -1 in gaps and outside', () => {
    expect(segmentAt(segments, 275)).toBe(-1)
    expect(segmentAt(segments, 400)).toBe(-1)
  })
})

describe('barLayout', () => {
  it('fits bars with gaps into the width', () => {
    const bars = barLayout([1, 0.5, 0.25, 0], 100, 50, 3, 2)
    expect(bars).toHaveLength(20)
    expect(bars[1].x).toBe(5)
    expect(bars.at(-1)!.x + 3).toBeLessThanOrEqual(100)
  })
  it('keeps loud bars inside the area and quiet ones visible', () => {
    const bars = barLayout([1, 0], 10, 50, 3, 2)
    expect(bars[0].height).toBe(50)
    expect(bars.at(-1)!.height).toBe(3)
  })
})
