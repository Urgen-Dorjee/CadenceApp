export type JobStatus =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'analyzing'
  | 'review'
  | 'exporting'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type TrackOrigin = 'chapters' | 'description' | 'comment' | 'silence' | 'playlist' | 'single' | 'manual' | 'pasted' | 'cue'

export interface Track {
  id: string
  title: string
  artist: string
  start: number
  end: number
  source_id: string
  origin: TrackOrigin
  confidence: number
  include: boolean
  /** Set when the name came from a lookup, e.g. AcoustID. */
  match?: { source: 'acoustid' | 'claude'; score?: number; album?: string } | null
}

export type CollectionType = 'artist' | 'album' | 'collection' | 'single'

export interface Collection {
  type: CollectionType
  name: string
  artist: string
  album: string
  year: string
  confidence?: number
}

export interface Source {
  id: string
  title: string
  url: string
  duration: number
  path: string
  thumbnail: string | null
  /** A file on this computer rather than a download. Never deleted by Cadence. */
  local?: boolean
}

export interface Output {
  track_id: string
  title: string
  path: string
}

export interface Job {
  id: string
  url: string
  status: JobStatus
  progress: number
  message: string
  error: string | null
  title: string
  thumbnail: string | null
  collection: Collection | Record<string, never>
  sources: Source[]
  tracks: Track[]
  outputs: Output[]
  destination: string
  /** The .m3u8 playlist written by the last save, if any. */
  playlist?: string
  /** Cover image the user chose for this split; empty means the video's thumbnail. */
  cover?: string
  created_at: number
  updated_at: number
}

export interface Preferences {
  library_dir: string
  save_mode: 'library' | 'ask'
  open_when_done: boolean
  keep_downloads: boolean
  write_playlist: boolean
  square_cover: boolean
  identify_songs: boolean
  acoustid_key: string
  tidy_names: boolean
  anthropic_api_key: string
  audio_format: 'mp3' | 'flac' | 'm4a' | 'opus'
  audio_bitrate: number
  edge_fade_ms: number
  snap_window_s: number
  trim_silence: boolean
  song_fade_in_s: number
  song_fade_out_s: number
  /** "tags": ReplayGain tags, audio unchanged. "normalize": one fixed gain per song. */
  loudness: 'off' | 'tags' | 'normalize'
  loudness_target: number
  artist_template: string
  album_template: string
  collection_template: string
  single_template: string
}

export const RUNNING_STATUSES: JobStatus[] = ['queued', 'resolving', 'downloading', 'analyzing', 'exporting']

export function isRunning(job: Pick<Job, 'status'>): boolean {
  return RUNNING_STATUSES.includes(job.status)
}
