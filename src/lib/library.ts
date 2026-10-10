import type { LibrarySong } from '../services/api'

export type LibrarySort = 'artist' | 'album' | 'title' | 'added'

export interface SongGroup {
  key: string
  name: string
  subtitle: string
  songs: LibrarySong[]
  /** A song in the group that has cover art, for the group's picture. */
  coverSong: LibrarySong | null
}

export function artistOf(song: LibrarySong): string {
  return song.artist || song.album_artist || 'Unknown artist'
}

export function albumOf(song: LibrarySong): string {
  return song.album || 'Unknown album'
}

/** Every search word must appear in the title, singer or album. */
export function filterSongs(songs: LibrarySong[], query: string): LibrarySong[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return songs
  return songs.filter((s) => {
    const haystack = `${s.title} ${s.artist} ${s.album_artist} ${s.album}`.toLowerCase()
    return words.every((w) => haystack.includes(w))
  })
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

export function sortSongs(songs: LibrarySong[], sort: LibrarySort): LibrarySong[] {
  const list = [...songs]
  switch (sort) {
    case 'title':
      return list.sort((a, b) => byText(a.title, b.title))
    case 'album':
      return list.sort((a, b) => byText(albumOf(a), albumOf(b)) || a.track - b.track || byText(a.title, b.title))
    case 'added':
      return list.sort((a, b) => b.added_at - a.added_at || byText(albumOf(a), albumOf(b)) || a.track - b.track)
    default:
      return list.sort(
        (a, b) => byText(artistOf(a), artistOf(b)) || byText(albumOf(a), albumOf(b)) || a.track - b.track || byText(a.title, b.title),
      )
  }
}

export function groupSongs(songs: LibrarySong[], by: 'artist' | 'album'): SongGroup[] {
  const groups = new Map<string, LibrarySong[]>()
  for (const song of songs) {
    const name = by === 'artist' ? artistOf(song) : albumOf(song)
    const key = name.toLowerCase()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(song)
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const sorted = sortSongs(list, 'album')
      const name = by === 'artist' ? artistOf(sorted[0]) : albumOf(sorted[0])
      const albums = new Set(sorted.map(albumOf)).size
      const year = sorted.find((s) => s.year)?.year ?? ''
      const subtitle =
        by === 'artist'
          ? `${sorted.length} song${sorted.length === 1 ? '' : 's'}${albums > 1 ? ` · ${albums} albums` : ''}`
          : [artistOf(sorted[0]), year].filter(Boolean).join(' · ')
      return { key, name, subtitle, songs: sorted, coverSong: sorted.find((s) => s.has_cover) ?? null }
    })
    .sort((a, b) => byText(a.name, b.name))
}

/** What another screen (the player) asks the Library to do when it opens. */
export interface LibraryIntent {
  open?: { kind: 'artist' | 'album'; key: string }
  edit?: LibrarySong[]
  send?: LibrarySong[]
}

/** Open a song's album or singer page in the Library. */
export function groupIntent(song: LibrarySong, kind: 'artist' | 'album'): LibraryIntent {
  return { open: { kind, key: (kind === 'album' ? albumOf(song) : artistOf(song)).toLowerCase() } }
}
