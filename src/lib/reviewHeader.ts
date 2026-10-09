import type { Collection, Track } from '../types/job'

/**
 * What the review screen is titled: the song or album name as it will be saved, with the singer,
 * film and year underneath. The raw YouTube title (often full of actors and channel tags) is only a fallback.
 */
export function reviewHeading(videoTitle: string, collection: Collection, tracks: Track[]): { title: string; details: string[] } {
  const year = collection.year?.trim() ?? ''
  const artist = collection.artist?.trim() ?? ''
  if (collection.type === 'single') {
    const song = tracks[0]
    return {
      title: song?.title.trim() || videoTitle,
      details: [song?.artist.trim() || artist, collection.album?.trim() ?? '', year].filter(Boolean),
    }
  }
  const name = (collection.type === 'album' ? collection.album : collection.type === 'artist' ? artist : collection.name)?.trim()
  return {
    title: name || videoTitle,
    details: [collection.type === 'artist' ? '' : artist, year].filter(Boolean),
  }
}

/** The song at `time` in a source, or -1. */
export function songAt(tracks: Track[], sourceId: string | null, time: number): number {
  if (!sourceId) return -1
  return tracks.findIndex((t) => t.source_id === sourceId && time >= t.start && time < t.end)
}

/** Where "previous" goes: back to the start of this song, unless it has only just started. */
export function previousTarget(tracks: Track[], current: number, time: number): number {
  if (current === -1) return 0
  if (time - tracks[current].start > 3 || current === 0) return current
  return current - 1
}
