import type { LibraryVideo, PlayerDetails } from '../services/api'

/** Speeds the player offers. */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

/** A video counts as watched once there is less than this left (or 95% is played). */
const WATCHED_LEFT_S = 30

export function isWatched(position: number, duration: number): boolean {
  return duration > 0 && position > 0 && (duration - position <= WATCHED_LEFT_S || position / duration >= 0.95)
}

/** Where to carry on from: the saved place, unless it is in the first few seconds or the video was finished. */
export function resumeAt(position: number, duration: number): number {
  if (position < 10 || !duration || isWatched(position, duration)) return 0
  return position
}

/** The part of a played video to show on its card (0 when unplayed, 1 when watched). */
export function watchedFraction(position: number, duration: number): number {
  if (!duration || position <= 0) return 0
  return isWatched(position, duration) ? 1 : Math.min(1, position / duration)
}

/** Index of the chapter playing at `time`, or -1. */
export function chapterAt(chapters: PlayerDetails['chapters'], time: number): number {
  for (let i = chapters.length - 1; i >= 0; i--) if (time >= chapters[i].start) return i
  return -1
}

/** The videos of the same course (playlist and channel), in order; just the video itself otherwise. */
export function courseOf(videos: LibraryVideo[], current: LibraryVideo): LibraryVideo[] {
  if (!current.playlist) return [current]
  return videos
    .filter((v) => v.playlist === current.playlist && v.channel === current.channel)
    .sort((a, b) => a.playlist_index - b.playlist_index)
}

/** "1:02:03" / "4:05": a clock without tenths. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Read a remembered player choice (volume, speed, subtitle language); storage can be unavailable. */
export function remembered<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`cadence.video.${key}`)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function remember(key: string, value: unknown): void {
  try {
    localStorage.setItem(`cadence.video.${key}`, JSON.stringify(value))
  } catch {
    /* not remembered; the player still works */
  }
}
