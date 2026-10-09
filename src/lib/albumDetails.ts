import type { Collection, Track } from '../types/job'

/** One album found on MusicBrainz. */
export interface AlbumRelease {
  id: string
  title: string
  artist: string
  year: string
  country: string
  track_count: number
  type: string
  score: number
  cover_url: string
}

/** The chosen album's details. */
export interface AlbumDetails {
  album: string
  artist: string
  year: string
  tracks: { title: string; artist: string }[]
}

/** True when the album's songs can be matched to the included songs one by one. */
export function songsMatch(details: Pick<AlbumDetails, 'tracks'> | { track_count: number }, tracks: Track[]): boolean {
  const count = 'tracks' in details ? details.tracks.length : details.track_count
  return count > 0 && count === tracks.filter((t) => t.include).length
}

/**
 * Use an album's name, singer and year for the split and, with `useSongNames`, its song
 * names (and singers) for the included songs in order. Songs the album gives no singer
 * for keep theirs. Returns new arrays; the inputs aren't changed.
 */
export function applyAlbumDetails(
  tracks: Track[],
  collection: Collection,
  details: AlbumDetails,
  useSongNames: boolean,
): { tracks: Track[]; collection: Collection; named: number } {
  const next: Collection = {
    ...collection,
    type: 'album',
    album: details.album || collection.album,
    artist: details.artist || collection.artist,
    year: details.year || collection.year,
  }
  if (!useSongNames || !songsMatch(details, tracks)) return { tracks, collection: next, named: 0 }
  let i = 0
  const named = tracks.map((t) => {
    if (!t.include) return t
    const song = details.tracks[i++]
    return {
      ...t,
      title: song.title || t.title,
      artist: song.artist || t.artist,
      match: { source: 'musicbrainz' as const, album: details.album },
    }
  })
  return { tracks: named, collection: next, named: i }
}
