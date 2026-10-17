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
  /** A video download stopped by the user; Resume carries on where it stopped. */
  | 'paused'

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
  match?: { source: 'acoustid' | 'claude' | 'musicbrainz'; score?: number; album?: string } | null
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
  /** Video downloads: the YouTube id of the saved video. */
  video_id?: string
}

export type VideoQuality = 'best' | '2160' | '1440' | '1080' | '720' | '480' | 'audio'

/** Choices for one whole-video download. */
export interface VideoOptions {
  quality: VideoQuality
  container: 'mp4' | 'mkv'
  subtitles: string[]
  auto_subtitles: boolean
  subtitle_mode: 'embed' | 'srt' | 'both'
  chapters: boolean
  thumbnail: boolean
  description: boolean
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
  /** "music": split into songs. "video": the whole video downloaded. */
  kind?: 'music' | 'video'
  /** A video download's choices. */
  options?: Partial<VideoOptions>
  created_at: number
  updated_at: number
}

export interface Preferences {
  /** Splits downloaded and analysed at the same time (1-4). */
  parallel_splits: number
  library_dir: string
  save_mode: 'library' | 'ask'
  open_when_done: boolean
  keep_downloads: boolean
  write_playlist: boolean
  square_cover: boolean
  lyrics: 'off' | 'embed' | 'lrc'
  /** YouTube sign-in: '' none, a browser to read cookies from, or 'file' for cookies_file. */
  cookies_from: '' | 'firefox' | 'chrome' | 'edge' | 'brave' | 'file'
  cookies_file: string
  proxy: string
  /** The welcome screen was completed. */
  onboarded: boolean
  identify_songs: boolean
  acoustid_key: string
  tidy_names: boolean
  anthropic_api_key: string
  audio_format: 'mp3' | 'flac' | 'm4a' | 'opus' | 'original'
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
  video_dir: string
  video_quality: VideoQuality
  video_container: 'mp4' | 'mkv'
  video_subtitles: string[]
  video_auto_subtitles: boolean
  video_subtitle_mode: 'embed' | 'srt' | 'both'
  video_chapters: boolean
  video_thumbnail: boolean
  video_description: boolean
  video_layout: 'channel' | 'flat'
  video_skip_saved: boolean
  /** Pause between videos of a playlist (it waits this to twice this), 0 = none. */
  video_pause_s: number
  video_rate_limit_mb: number
  /** Show the "Video ready" screen before each download. */
  video_ask: boolean
  download_mode: 'music' | 'video'
}

/** The starting choices for a video download, from Settings. */
export function videoDefaults(prefs: Preferences): VideoOptions {
  return {
    quality: prefs.video_quality,
    container: prefs.video_container,
    subtitles: prefs.video_subtitles,
    auto_subtitles: prefs.video_auto_subtitles,
    subtitle_mode: prefs.video_subtitle_mode,
    chapters: prefs.video_chapters,
    thumbnail: prefs.video_thumbnail,
    description: prefs.video_description,
  }
}

export function isVideoJob(job: Pick<Job, 'kind'>): boolean {
  return job.kind === 'video'
}

export const RUNNING_STATUSES: JobStatus[] = ['queued', 'resolving', 'downloading', 'analyzing', 'exporting']

export function isRunning(job: Pick<Job, 'status'>): boolean {
  return RUNNING_STATUSES.includes(job.status)
}
