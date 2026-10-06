import type { Collection, Preferences, Track } from '../types/job'

// Mirrors backend/services/library.py closely enough for a "Saves to" preview.
function sanitize(name: string) {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s{2,}/g, ' ').trim().replace(/[. ]+$/, '')
  return cleaned.slice(0, 120) || 'Untitled'
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
  const parts = rendered.split(/[\\/]+/).filter((p) => p.trim()).map(sanitize)
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
