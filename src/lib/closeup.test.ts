import { describe, expect, it } from 'vitest'
import { cutForPlayingSong, cutNear, cutsInView, followPlayhead, windowAround } from './closeup'
import type { Track } from '../types/job'

const track = (start: number, end: number, source_id = 's'): Track => ({
  id: `${start}`, title: '', artist: '', start, end, source_id, origin: 'chapters', confidence: 1, include: true,
})

describe('windowAround', () => {
  it('shows 16 s around a time, never before zero', () => {
    expect(windowAround(100)).toEqual({ start: 92, end: 108 })
    expect(windowAround(3)).toEqual({ start: 0, end: 16 })
  })
})

describe('followPlayhead', () => {
  const view = { start: 568.3, end: 584.3 }

  it('keeps the view while the playhead moves across it', () => {
    expect(followPlayhead(view, 570)).toBeNull()
    expect(followPlayhead(view, 583)).toBeNull()
  })

  it('pages forward when the playhead nears the right edge', () => {
    const center = followPlayhead(view, 583.5)!
    expect(windowAround(center)).toEqual({ start: 581.5, end: 597.5 })
  })

  it('jumps to the playhead after a seek elsewhere', () => {
    expect(windowAround(followPlayhead(view, 1200)!).start).toBe(1198)
    expect(windowAround(followPlayhead(null, 10)!).start).toBe(8)
  })
})

describe('cutsInView', () => {
  const tracks = [track(0, 100), track(100, 200), track(200, 300), track(0, 50, 'other'), track(400, 500)]

  it('lists shared cuts of this source inside the view', () => {
    expect(cutsInView(tracks, 's', { start: 90, end: 210 })).toEqual([
      { index: 1, time: 100 },
      { index: 2, time: 200 },
    ])
  })

  it('skips cuts outside the view, other sources and gaps', () => {
    expect(cutsInView(tracks, 's', { start: 150, end: 450 })).toEqual([{ index: 2, time: 200 }])
  })
})

describe('cutNear', () => {
  const cuts = [{ index: 1, time: 100 }, { index: 2, time: 100.3 }]
  it('finds the nearest cut within the tolerance', () => {
    expect(cutNear(cuts, 100.25, 0.2)).toEqual({ index: 2, time: 100.3 })
    expect(cutNear(cuts, 101, 0.2)).toBeNull()
  })
})

describe('cutForPlayingSong', () => {
  const tracks = [track(0, 6), track(6, 362), track(362, 576), track(576, 810)]
  const cuts = [1, 2, 3]
  it('uses the cut where the song starts, early in the song', () => {
    expect(cutForPlayingSong(tracks, 2, cuts, 370)).toBe(2)
  })
  it('uses the cut where the song ends, late in the song', () => {
    expect(cutForPlayingSong(tracks, 2, cuts, 570)).toBe(3)
  })
  it('uses the only cut a first or last song has', () => {
    expect(cutForPlayingSong(tracks, 0, cuts, 1)).toBe(1)
    expect(cutForPlayingSong(tracks, 3, cuts, 800)).toBe(3)
  })
  it('returns null when nothing is playing', () => {
    expect(cutForPlayingSong(tracks, -1, cuts, 0)).toBeNull()
  })
})
