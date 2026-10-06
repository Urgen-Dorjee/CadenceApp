import type { Job } from '../types/job'
import { needsCheck } from './tracks'

// A YouTube link runs until whitespace, a quote or bracket, or the start of the next link
// (pasting several lines into a one-line field can join them together).
const LINK_RE = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s"'<>]+?(?=https?:\/\/|[\s"'<>]|$)/gi
const TRAILING_PUNCTUATION = /[),.;!]+$/

/** Every YouTube link in `text`, in order, without duplicates. */
export function youtubeLinks(text: string): string[] {
  const links = (text.match(LINK_RE) ?? []).map((l) => l.replace(TRAILING_PUNCTUATION, ''))
  return [...new Set(links)]
}

/** Links not already in the list of splits (failed or cancelled ones may be tried again). */
export function newLinks(links: string[], jobs: Job[]): string[] {
  const known = new Set(jobs.filter((j) => j.status !== 'failed' && j.status !== 'cancelled').map((j) => j.url))
  return links.filter((l) => !known.has(l))
}

/**
 * Splits that can be saved without looking: reviewed, audio still on disk, and no cut
 * marked "Check". Those with cuts to check are returned separately so they're never
 * saved unseen.
 */
export function readyToSave(jobs: Job[]): { ready: Job[]; toCheck: Job[] } {
  const reviewed = jobs.filter(
    (j) => j.status === 'review' && j.tracks.some((t) => t.include) && j.sources.every((s) => s.path),
  )
  return {
    ready: reviewed.filter((j) => !j.tracks.some(needsCheck)),
    toCheck: reviewed.filter((j) => j.tracks.some(needsCheck)),
  }
}
