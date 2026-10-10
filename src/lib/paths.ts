import type { Collection, Preferences, Track } from '../types/job'

// Mirrors backend/services/library.py closely enough for a "Saves to" preview.
const MAX_FOLDER = 60
const MAX_FILE = 100

/** Cut to `limit` characters at a word boundary when there is one nearby (like the backend). */
export function shorten(name: string, limit: number) {
  if (name.length <= limit) return name
  let cut = name.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  if (space >= limit * 0.6) cut = cut.slice(0, space)
  return cut.replace(/[\s.,;:\-–—…&+|]+$/, '') || name.slice(0, limit)
}

function sanitize(name: string, limit: number) {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s{2,}/g, ' ').trim().replace(/[. ]+$/, '')
  return shorten(cleaned, limit).replace(/[. ]+$/, '') || 'Untitled'
}

function templateFor(type: Collection['type'], prefs: Preferences) {
  return {
    artist: prefs.artist_template,
    album: prefs.album_template,
    collection: prefs.collection_template,
    single: prefs.single_template,
  }[type]
}

export function previewPath(track: Track, number: number, collection: Collection, prefs: Preferences): string {
  const album = collection.album || collection.name || 'Unknown Album'
  const values: Record<string, string> = {
    artist: track.artist || collection.artist || 'Unknown Artist',
    album,
    collection: collection.name || album,
    year: collection.year,
    year_suffix: collection.year ? ` (${collection.year})` : '',
    title: track.title || `Track ${number}`,
  }
  const rendered = templateFor(collection.type, prefs).replace(/\{(\w+)(?::0?(\d+))?\}/g, (_m, key: string, pad?: string) => {
    if (key === 'track') return pad ? String(number).padStart(Number(pad), '0') : String(number)
    return (values[key] ?? '').replace(/[\\/]+/g, ' ')
  })
  const pieces = rendered.split(/[\\/]+/).filter((p) => p.trim())
  const parts = pieces.map((p, i) => sanitize(p, i === pieces.length - 1 ? MAX_FILE : MAX_FOLDER))
  const sep = prefs.library_dir.includes('\\') ? '\\' : '/'
  // "Original" keeps each video's own file type, which isn't known until saving.
  const ext = prefs.audio_format === 'original' ? '' : `.${prefs.audio_format}`
  return [prefs.library_dir.replace(/[\\/]+$/, ''), ...parts].join(sep) + ext
}

export function folderOf(path: string) {
  return path.replace(/[\\/][^\\/]*$/, '')
}

/** Lets long paths wrap after a folder separator instead of mid-word. */
export function breakablePath(path: string) {
  return path.replace(/([\\/])/g, '$1​')
}
