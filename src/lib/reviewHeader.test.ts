import { describe, expect, it } from 'vitest'
import type { Collection, Track } from '../types/job'
import { previousTarget, reviewHeading, songAt } from './reviewHeader'

const track = (id: string, start: number, end: number, title = `Song ${id}`, artist = ''): Track => ({
  id, title, artist, start, end, source_id: 's', origin: 'chapters', confidence: 1, include: true,
})
const VIDEO = 'Yeh Aaine Jo Tumhein Kam Pasand - Tamanna ( 1997 ) Sharad Kapoor & Pooja Bhatt'

describe('reviewHeading', () => {
  it('names a single song by its own title, with singer, film and year', () => {
    const single: Collection = { type: 'single', name: '', artist: 'Kumar Sanu', album: 'Tamanna', year: '1997' }
    expect(reviewHeading(VIDEO, single, [track('1', 0, 372, 'Yeh Aaine Jo Tumhein Kam Pasand Karte Hain')])).toEqual({
      title: 'Yeh Aaine Jo Tumhein Kam Pasand Karte Hain',
      details: ['Kumar Sanu', 'Tamanna', '1997'],
    })
  })

  it('names albums and singer collections, and falls back to the video title', () => {
    const album: Collection = { type: 'album', name: '', artist: 'Anu Malik', album: 'Baazigar', year: '1993' }
    expect(reviewHeading(VIDEO, album, [])).toEqual({ title: 'Baazigar', details: ['Anu Malik', '1993'] })
    const singer: Collection = { type: 'artist', name: '', artist: 'Kumar Sanu', album: '', year: '' }
    expect(reviewHeading(VIDEO, singer, [])).toEqual({ title: 'Kumar Sanu', details: [] })
    const empty: Collection = { type: 'collection', name: ' ', artist: '', album: '', year: '' }
    expect(reviewHeading(VIDEO, empty, []).title).toBe(VIDEO)
  })
})

describe('previous and next song', () => {
  const tracks = [track('1', 0, 100), track('2', 100, 200), track('3', 200, 300)]

  it('finds the song under the playhead', () => {
    expect(songAt(tracks, 's', 150)).toBe(1)
    expect(songAt(tracks, null, 150)).toBe(-1)
    expect(songAt(tracks, 's', 999)).toBe(-1)
  })

  it('restarts the song unless it has only just started', () => {
    expect(previousTarget(tracks, 1, 150)).toBe(1)
    expect(previousTarget(tracks, 1, 101)).toBe(0)
    expect(previousTarget(tracks, 0, 1)).toBe(0)
    expect(previousTarget(tracks, -1, 0)).toBe(0)
  })
})
