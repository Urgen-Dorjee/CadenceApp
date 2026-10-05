import { describe, expect, it } from 'vitest'
import type { Track } from '../types/job'
import { canMergeWithNext, mergeWithNext, moveEnd, moveStart, needsCheck, needsName, splitAt } from './tracks'

function track(id: string, start: number, end: number, extra: Partial<Track> = {}): Track {
  return { id, title: id, artist: '', start, end, source_id: 's', origin: 'chapters', confidence: 0.95, include: true, ...extra }
}

const three = () => [track('a', 0, 100), track('b', 100, 200), track('c', 200, 300)]

describe('moveStart', () => {
  it('moves the shared cut so songs never overlap or leave a gap', () => {
    const next = moveStart(three(), 1, 104.5)
    expect(next[1].start).toBe(104.5)
    expect(next[0].end).toBe(104.5)
    expect(next[1].origin).toBe('manual')
    expect(next[1].confidence).toBe(1)
  })
  it('cannot cross into the previous song or past its own end', () => {
    expect(moveStart(three(), 1, 0)[1].start).toBe(1)
    expect(moveStart(three(), 1, 500)[1].start).toBe(199)
  })
  it('leaves a non-adjacent previous song alone', () => {
    const tracks = [track('a', 0, 90), track('b', 100, 200)]
    const next = moveStart(tracks, 1, 95)
    expect(next[0].end).toBe(90)
    expect(next[1].start).toBe(95)
  })
  it('does not mutate the input', () => {
    const tracks = three()
    moveStart(tracks, 1, 110)
    expect(tracks[1].start).toBe(100)
  })
})

describe('moveEnd', () => {
  it('moves the next song start with it', () => {
    const next = moveEnd(three(), 0, 98, 300)
    expect(next[0].end).toBe(98)
    expect(next[1].start).toBe(98)
  })
  it('the last song cannot end after the video', () => {
    expect(moveEnd(three(), 2, 999, 300)[2].end).toBe(300)
  })
})

describe('splitAt / mergeWithNext', () => {
  it('splits the song under the playhead', () => {
    const next = splitAt(three(), 's', 150)
    expect(next).toHaveLength(4)
    expect(next[1]).toMatchObject({ id: 'b', start: 100, end: 150 })
    expect(next[2]).toMatchObject({ start: 150, end: 200, title: 'Untitled song' })
    expect(next[2].id).not.toBe('b')
  })
  it('ignores a split right at an edge or on another source', () => {
    expect(splitAt(three(), 's', 100.5)).toHaveLength(3)
    expect(splitAt(three(), 'other', 150)).toHaveLength(3)
  })
  it('merges a false cut back together', () => {
    const next = mergeWithNext(three(), 0)
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ id: 'a', start: 0, end: 200 })
  })
  it('only merges adjacent songs from the same video', () => {
    const tracks = [track('a', 0, 100), track('b', 0, 120, { source_id: 'other' })]
    expect(canMergeWithNext(tracks, 0)).toBe(false)
    expect(mergeWithNext(tracks, 0)).toBe(tracks)
  })
})

describe('needsCheck', () => {
  it('flags low-confidence songs that will be saved', () => {
    expect(needsCheck(track('a', 0, 1, { confidence: 0.5 }))).toBe(true)
    expect(needsCheck(track('a', 0, 1, { confidence: 0.5, include: false }))).toBe(false)
    expect(needsCheck(track('a', 0, 1))).toBe(false)
  })
})

describe('needsName', () => {
  it('matches placeholder titles only', () => {
    expect(needsName(track('a', 0, 1, { title: 'Track 3' }))).toBe(true)
    expect(needsName(track('a', 0, 1, { title: 'Untitled song' }))).toBe(true)
    expect(needsName(track('a', 0, 1, { title: '  ' }))).toBe(true)
    expect(needsName(track('a', 0, 1, { title: 'Track Of My Heart' }))).toBe(false)
    expect(needsName(track('a', 0, 1, { title: 'Tum Hi Ho' }))).toBe(false)
  })
})
