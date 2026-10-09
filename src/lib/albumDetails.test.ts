import { describe, expect, it } from 'vitest'
import type { Collection, Track } from '../types/job'
import { applyAlbumDetails, songsMatch } from './albumDetails'

const track = (id: string, include = true, artist = ''): Track => ({
  id, title: `Track ${id}`, artist, start: 0, end: 1, source_id: 's', origin: 'chapters', confidence: 1, include,
})
const collection: Collection = { type: 'collection', name: 'Jukebox', artist: '', album: '', year: '' }
const details = {
  album: 'Dilwale Dulhania Le Jayenge',
  artist: 'Jatin-Lalit',
  year: '1995',
  tracks: [{ title: 'Tujhe Dekha To', artist: 'Lata Mangeshkar & Kumar Sanu' }, { title: 'Mere Khwabon Mein', artist: '' }],
}

describe('applyAlbumDetails', () => {
  it('fills the album, singer and year', () => {
    const r = applyAlbumDetails([track('1')], collection, details, false)
    expect(r.collection).toMatchObject({ type: 'album', album: 'Dilwale Dulhania Le Jayenge', artist: 'Jatin-Lalit', year: '1995' })
    expect(r.named).toBe(0)
  })

  it('names the included songs in order, skipping left-out ones', () => {
    const tracks = [track('1'), track('x', false), track('2', true, 'Lata Mangeshkar')]
    const r = applyAlbumDetails(tracks, collection, details, true)
    expect(r.named).toBe(2)
    expect(r.tracks.map((t) => t.title)).toEqual(['Tujhe Dekha To', 'Track x', 'Mere Khwabon Mein'])
    expect(r.tracks[0].artist).toBe('Lata Mangeshkar & Kumar Sanu')
    expect(r.tracks[2].artist).toBe('Lata Mangeshkar') // the album gives no singer, so it stays
    expect(r.tracks[0].match).toEqual({ source: 'musicbrainz', album: 'Dilwale Dulhania Le Jayenge' })
    expect(tracks[0].title).toBe('Track 1') // input unchanged
  })

  it('leaves song names alone when the counts differ', () => {
    const r = applyAlbumDetails([track('1'), track('2'), track('3')], collection, details, true)
    expect(r.named).toBe(0)
    expect(r.tracks[0].title).toBe('Track 1')
  })
})

describe('songsMatch', () => {
  it('compares with the included songs', () => {
    expect(songsMatch({ track_count: 2 }, [track('1'), track('2'), track('3', false)])).toBe(true)
    expect(songsMatch({ track_count: 3 }, [track('1'), track('2')])).toBe(false)
    expect(songsMatch({ track_count: 0 }, [])).toBe(false)
  })
})
