import type { Track } from '../types/job'

const CONTIGUOUS = 0.5
const MIN_LENGTH = 1

function newId() {
  return Math.random().toString(16).slice(2, 10)
}

function contiguous(a: Track, b: Track) {
  return a.source_id === b.source_id && Math.abs(a.end - b.start) <= CONTIGUOUS
}

/**
 * Move the start of track `index`. When it shares a cut with the previous song,
 * that song's end moves too, so songs never overlap or leave a gap.
 */
export function moveStart(tracks: Track[], index: number, time: number): Track[] {
  const next = tracks.map((t) => ({ ...t }))
  const track = next[index]
  const prev = index > 0 ? next[index - 1] : null
  const linked = prev && contiguous(tracks[index - 1], tracks[index])
  const min = linked ? prev!.start + MIN_LENGTH : 0
  const clamped = Math.min(Math.max(time, min), track.end - MIN_LENGTH)
  track.start = round(clamped)
  track.origin = 'manual'
  track.confidence = 1
  if (linked) prev!.end = track.start
  return next
}

/** Move the end of track `index`, keeping the next song's start attached if they share a cut. */
export function moveEnd(tracks: Track[], index: number, time: number, sourceDuration: number): Track[] {
  const next = tracks.map((t) => ({ ...t }))
  const track = next[index]
  const after = index + 1 < next.length ? next[index + 1] : null
  const linked = after && contiguous(tracks[index], tracks[index + 1])
  const max = linked ? after!.end - MIN_LENGTH : sourceDuration
  const clamped = Math.max(Math.min(time, max), track.start + MIN_LENGTH)
  track.end = round(clamped)
  track.origin = 'manual'
  track.confidence = 1
  if (linked) after!.start = track.end
  return next
}

/** Split the song that contains `time` into two songs at that point. */
export function splitAt(tracks: Track[], sourceId: string, time: number): Track[] {
  const index = tracks.findIndex(
    (t) => t.source_id === sourceId && time > t.start + MIN_LENGTH && time < t.end - MIN_LENGTH,
  )
  if (index === -1) return tracks
  const original = tracks[index]
  const first: Track = { ...original, end: round(time), origin: 'manual', confidence: 1 }
  const second: Track = { ...original, id: newId(), title: 'Untitled song', start: round(time), origin: 'manual', confidence: 1 }
  return [...tracks.slice(0, index), first, second, ...tracks.slice(index + 1)]
}

export function canMergeWithNext(tracks: Track[], index: number): boolean {
  return index + 1 < tracks.length && contiguous(tracks[index], tracks[index + 1])
}

/** Join a song with the one after it (for a false cut in the middle of a song). */
export function mergeWithNext(tracks: Track[], index: number): Track[] {
  if (!canMergeWithNext(tracks, index)) return tracks
  const merged: Track = { ...tracks[index], end: tracks[index + 1].end, origin: 'manual', confidence: 1 }
  return [...tracks.slice(0, index), merged, ...tracks.slice(index + 2)]
}

export function updateTrack(tracks: Track[], id: string, patch: Partial<Track>): Track[] {
  return tracks.map((t) => (t.id === id ? { ...t, ...patch } : t))
}

/** Cuts the user should look at: low confidence, unchanged by the user. */
export function needsCheck(track: Track): boolean {
  return track.include && track.confidence < 0.7
}

function round(t: number) {
  return Math.round(t * 1000) / 1000
}

const PLACEHOLDER_TITLE = /^(track|song|untitled( song)?)\s*\d*$/i

/** Placeholder names like "Track 3" that identification may replace. Mirrors the backend. */
export function needsName(track: Track): boolean {
  return !track.title.trim() || PLACEHOLDER_TITLE.test(track.title.trim())
}
