/** Playlists and channels: what a link is, and sensible defaults for splitting one. */

export type LinkKind = 'video' | 'playlist' | 'channel'

/** One video of a playlist or channel. `state`: its songs were saved before, or a split for it is in the list. */
export interface ListedVideo {
  id: string
  url: string
  title: string
  duration: number
  state: '' | 'saved' | 'in_list'
}

export interface ListedLink {
  kind: LinkKind
  title: string
  entries: ListedVideo[]
}

/** How to split a playlist or channel. */
export type PlaylistMode = 'each' | 'album' | 'single'

/** Videos at least this long are treated as jukeboxes or full albums. */
export const LONG_VIDEO_S = 20 * 60

const CHANNEL_PATH = /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(\/[^/]*)?\/?$/

/** Same rules as the backend: a list= link is a playlist (even with a video in it), a channel page is a channel. */
export function linkKind(url: string): LinkKind {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return 'video'
  }
  if (parsed.searchParams.has('list')) return 'playlist'
  if (CHANNEL_PATH.test(parsed.pathname) && !parsed.searchParams.has('v')) return 'channel'
  return 'video'
}

/** True for a playlist link that also points at one video (watch?v=...&list=...). */
export function hasVideo(url: string): boolean {
  try {
    const parsed = new URL(url.trim())
    return parsed.searchParams.has('v') || parsed.hostname.endsWith('youtu.be')
  } catch {
    return false
  }
}

/** Mostly long videos means jukeboxes or albums (split each); mostly short ones means one song per video. */
export function defaultMode(listed: ListedLink): PlaylistMode {
  if (listed.kind === 'channel') return 'each'
  const known = listed.entries.map((e) => e.duration).filter((d) => d > 0).sort((a, b) => a - b)
  if (!known.length) return 'album'
  return known[Math.floor(known.length / 2)] >= LONG_VIDEO_S ? 'each' : 'album'
}

/** Videos ticked at first: not done before, and long ones only when `longOnly`. */
export function defaultSelection(entries: ListedVideo[], longOnly: boolean): Set<string> {
  return new Set(entries.filter((e) => !e.state && (!longOnly || e.duration >= LONG_VIDEO_S)).map((e) => e.id))
}
