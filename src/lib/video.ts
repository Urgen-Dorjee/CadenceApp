import type { Job, VideoOptions, VideoQuality } from '../types/job'

export const QUALITY_CHOICES: { id: VideoQuality; label: string }[] = [
  { id: 'best', label: 'Best' },
  { id: '2160', label: '4K' },
  { id: '1080', label: '1080p' },
  { id: '720', label: '720p' },
  { id: '480', label: '480p' },
  { id: 'audio', label: 'Sound only' },
]

/** Languages offered for subtitles, by their two- or three-letter code. */
export const LANGUAGES: Record<string, string> = {
  en: 'English', hi: 'Hindi', ne: 'Nepali', bo: 'Tibetan', ur: 'Urdu', bn: 'Bengali', ta: 'Tamil', te: 'Telugu',
  mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
  ar: 'Arabic', tr: 'Turkish', id: 'Indonesian', th: 'Thai', vi: 'Vietnamese', nl: 'Dutch', pl: 'Polish',
}

export function languageName(code: string): string {
  return LANGUAGES[code] ?? code.toUpperCase()
}

/** "820 MB", "3.1 GB". */
export function formatSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}

/**
 * The quality to pre-select: the chosen one if the video has it, else the nearest lower one,
 * else "Best available" (a video with only 240p or 360p), else the lowest the video has.
 */
export function nearestQuality(wanted: VideoQuality, available: VideoQuality[]): VideoQuality | undefined {
  if (!available.length) return undefined
  if (available.includes(wanted)) return wanted
  if (wanted === 'audio') return undefined
  const heights = available.filter((q) => /^\d+$/.test(q)).map(Number).sort((a, b) => b - a)
  if (wanted === 'best' && heights.length) return String(heights[0]) as VideoQuality
  const lower = heights.find((h) => h <= Number(wanted))
  if (lower) return String(lower) as VideoQuality
  if (available.includes('best')) return 'best'
  return heights.length ? (String(heights[heights.length - 1]) as VideoQuality) : undefined
}

/** One line describing a download's choices, e.g. "1080p MP4 · English, Hindi subtitles". */
export function optionsSummary(options: Partial<VideoOptions>): string {
  const quality = options.quality === 'audio'
    ? 'Sound only (M4A)'
    : `${options.quality === 'best' ? 'Best quality' : options.quality === '2160' ? '4K' : `${options.quality}p`} ${(options.container ?? 'mp4').toUpperCase()}`
  const subs = options.quality !== 'audio' && options.subtitles?.length
    ? `${options.subtitles.map(languageName).join(', ')} subtitles`
    : ''
  return [quality, subs].filter(Boolean).join(' · ')
}

/** A video job for a playlist or channel: a course of several videos. */
export function isCourse(job: Pick<Job, 'url'>): boolean {
  try {
    const url = new URL(job.url)
    return url.searchParams.has('list') || /^\/(@[^/]+|channel\/|c\/|user\/)/.test(url.pathname)
  } catch {
    return false
  }
}
