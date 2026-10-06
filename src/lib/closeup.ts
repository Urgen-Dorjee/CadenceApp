/** View logic for the cut close-up: which 16 s of audio to show, and which cuts fall inside it. */
import type { Track } from '../types/job'

export const HALF_WINDOW = 8
/** While following playback, a new view starts this many seconds before the playhead. */
export const FOLLOW_LEAD = 2
/** Page forward when the playhead gets this close to the right edge. */
export const FOLLOW_MARGIN = 1

export interface View {
  start: number
  end: number
}

export function windowAround(center: number): View {
  const start = Math.max(0, center - HALF_WINDOW)
  return { start, end: start + 2 * HALF_WINDOW }
}

/**
 * Centre for the next view while playing, or null to keep the current one.
 * The view pages forward like a DAW: the playhead moves across, and when it nears
 * the right edge (or jumps outside, after a seek) the next view starts just before it.
 */
export function followPlayhead(view: View | null, playhead: number): number | null {
  if (view && playhead >= view.start && playhead <= view.end - FOLLOW_MARGIN) return null
  return Math.max(0, playhead - FOLLOW_LEAD) + HALF_WINDOW
}

export interface Cut {
  /** Index of the song that starts at this cut. */
  index: number
  time: number
}

/** Cuts shared by two neighbouring songs of `sourceId` that fall inside the view. */
export function cutsInView(tracks: Track[], sourceId: string, view: View): Cut[] {
  const cuts: Cut[] = []
  tracks.forEach((t, i) => {
    const prev = tracks[i - 1]
    if (!prev || t.source_id !== sourceId || prev.source_id !== sourceId) return
    if (Math.abs(prev.end - t.start) > 0.5) return
    if (t.start >= view.start && t.start <= view.end) cuts.push({ index: i, time: t.start })
  })
  return cuts
}

/** The cut within `tolerance` seconds of `time`, nearest first, or null. */
export function cutNear(cuts: Cut[], time: number, tolerance: number): Cut | null {
  let best: Cut | null = null
  for (const c of cuts) {
    if (Math.abs(c.time - time) <= tolerance && (!best || Math.abs(c.time - time) < Math.abs(best.time - time))) best = c
  }
  return best
}

/**
 * The cut the close-up is about while a song plays: whichever of the playing song's
 * own cuts (where it starts, where it ends) is nearer the playhead.
 */
export function cutForPlayingSong(tracks: Track[], playingIndex: number, cutIndexes: number[], playhead: number): number | null {
  if (playingIndex < 0) return null
  const startCut = cutIndexes.includes(playingIndex) ? playingIndex : null
  const endCut = cutIndexes.includes(playingIndex + 1) ? playingIndex + 1 : null
  if (startCut === null || endCut === null) return startCut ?? endCut
  return playhead - tracks[startCut].start <= tracks[endCut].start - playhead ? startCut : endCut
}
