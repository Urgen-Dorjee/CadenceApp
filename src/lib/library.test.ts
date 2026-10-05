import { describe, expect, it } from 'vitest'
import type { LibrarySong } from '../services/api'
import { filterSongs, groupSongs, sortSongs } from './library'

function song(id: string, title: string, artist: string, album: string, track: number, extra: Partial<LibrarySong> = {}): LibrarySong {
  return { id, path: `C:/m/${id}.mp3`, title, artist, album, album_artist: '', year: '', track, duration: 200, format: 'mp3', has_cover: 0, added_at: 1, ...extra }
}

const songs = [
  song('1', 'Beta', 'Singer B', 'Film One', 2),
  song('2', 'Alpha', 'Singer A', 'Film One', 1, { has_cover: 1, year: '1995' }),
  song('3', 'Gamma', '', 'Film Two', 1, { album_artist: 'Singer A', added_at: 5 }),
]

describe('filterSongs', () => {
  it('requires every word, across title, singer and album', () => {
    expect(filterSongs(songs, 'film one').map((s) => s.id)).toEqual(['1', '2'])
    expect(filterSongs(songs, 'one singer b').map((s) => s.id)).toEqual(['1'])
    expect(filterSongs(songs, '  ')).toHaveLength(3)
  })
})

describe('sortSongs', () => {
  it('sorts by singer, using the album singer when a song has none', () => {
    expect(sortSongs(songs, 'artist').map((s) => s.id)).toEqual(['2', '3', '1'])
  })
  it('sorts albums by track number', () => {
    expect(sortSongs(songs, 'album').map((s) => s.id)).toEqual(['2', '1', '3'])
  })
  it('puts recently added first', () => {
    expect(sortSongs(songs, 'added')[0].id).toBe('3')
  })
  it('does not mutate the input', () => {
    const copy = [...songs]
    sortSongs(songs, 'title')
    expect(songs).toEqual(copy)
  })
})

describe('groupSongs', () => {
  it('groups by album with a cover and subtitle', () => {
    const albums = groupSongs(songs, 'album')
    expect(albums.map((g) => g.name)).toEqual(['Film One', 'Film Two'])
    expect(albums[0].songs.map((s) => s.title)).toEqual(['Alpha', 'Beta'])
    expect(albums[0].coverSong?.id).toBe('2')
    expect(albums[0].subtitle).toBe('Singer A · 1995')
  })
  it('groups by singer, counting albums', () => {
    const artists = groupSongs(songs, 'artist')
    expect(artists.map((g) => g.name)).toEqual(['Singer A', 'Singer B'])
    expect(artists[0].subtitle).toBe('2 songs · 2 albums')
  })
})
