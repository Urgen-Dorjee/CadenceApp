import type { Collection, Job, Preferences, Track, VideoOptions } from '../types/job'
import type { AlbumDetails, AlbumRelease } from '../lib/albumDetails'
import type { ListedLink } from '../lib/playlists'

let baseURL = ''
let token = ''

export function configureApi(port: number, authToken: string) {
  baseURL = `http://127.0.0.1:${port}`
  token = authToken
}

export function isApiConfigured() {
  return Boolean(baseURL && token)
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseURL}${path}`, {
    method,
    headers: {
      'x-cadence-token': token,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') message = data.detail
      else if (Array.isArray(data.detail) && data.detail[0]?.msg) message = String(data.detail[0].msg).replace(/^Value error, /, '')
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

/** URL for <audio>/<img>, which can't send headers, so the token rides in the query. */
export function mediaUrl(path: string) {
  return `${baseURL}${path}?token=${encodeURIComponent(token)}`
}

export function websocketUrl() {
  return `${baseURL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`
}

export interface ReviewPayload {
  tracks: Track[]
  collection: Collection
  /** Folder for this split only; empty means the library folder. */
  destination?: string
  /** Saving again: overwrite last time's songs instead of adding "(2)" copies. */
  replace_previous?: boolean
}

/** A library song that a song of this split duplicates. */
export interface LibraryMatch {
  path: string
  title: string
  artist: string
  album: string
}

/** Tag changes for saved songs. Only the fields given are changed; "" removes a tag. */
export interface TagChanges {
  title?: string
  artist?: string
  album?: string
  album_artist?: string
  year?: string
  track?: number
}

export interface StorageInfo {
  library_dir: string
  library_exists: boolean
  free_bytes: number
  total_bytes: number
  downloads_bytes: number
  downloads_count: number
  work_dir: string
}

/** Progress of copying songs (WebSocket "send" messages). */
export interface SendProgress {
  task_id: string
  done: number
  total: number
  copied: number
  skipped: number
  failed: number
  current?: string
  finished?: boolean
  destination?: string
  errors?: string[]
}

export const SEND_EVENT = 'cadence:send'

export interface LibrarySong {
  id: string
  path: string
  title: string
  artist: string
  album: string
  album_artist: string
  year: string
  track: number
  duration: number
  format: string
  has_cover: number
  added_at: number
}

/** A video's details before downloading it whole ("Video ready"). */
export interface VideoDetails {
  kind: 'video'
  id: string
  title: string
  channel: string
  duration: number
  thumbnail: string
  chapters: { start: number; title: string }[]
  /** `sizes`: what would download for each file type; `size`: for MP4. */
  qualities: { id: VideoOptions['quality']; label: string; size: number; sizes?: Partial<Record<VideoOptions['container'], number>> }[]
  subtitles: { lang: string; name: string; auto: boolean }[]
  saved: boolean
}

/** A playlist or channel, before downloading its videos. */
export interface PlaylistDetails {
  kind: 'playlist'
  title: string
  count: number
  saved_count: number
  duration: number
  entries: { id: string; title: string; duration: number }[]
}

/** A video in the library's Videos tab. */
export interface LibraryVideo {
  path: string
  video_id: string
  title: string
  channel: string
  playlist: string
  playlist_index: number
  duration: number
  height: number
  ext: string
  size: number
  subtitles: string[]
  thumbnail: string
  saved_at: number
  /** Names the video in the player's URLs. */
  key: string
  /** Where it was left off in the player, in seconds (0 if never played). */
  position: number
}

/** What was done with a video link before (POST /links/history). */
export interface LinkHistory {
  video_id: string | null
  /** Splits and video downloads of this video still in the list. */
  jobs: { id: string; kind: 'music' | 'video'; status: Job['status']; saved: number; songs: number }[]
  /** Songs saved from it whose files are still there. */
  songs: { path: string; title: string; saved_at: number }[]
  /** Copies of it downloaded whole. */
  videos: { path: string; height: number; ext: string }[]
}

/** What the built-in player shows besides the picture. */
export interface PlayerDetails {
  duration: number
  chapters: { start: number; end: number; title: string }[]
  /** `source`: "file" for an .srt saved next to the video, "video" for one inside it. */
  subtitles: { id: string; lang: string; source: 'file' | 'video' }[]
}

export const api = {
  /** Lyrics saved with a song; with `online`, looked up on LRCLIB when none are saved. */
  songLyrics: (id: string, online: boolean) =>
    request<{ synced: string; plain: string; source: '' | 'saved' | 'lrclib' }>(
      'GET', `/api/library/songs/${encodeURIComponent(id)}/lyrics${online ? '?online=true' : ''}`,
    ),
  health: () => request<{ status: string; ffmpeg_available: boolean; yt_dlp_version: string; identify_built_in?: boolean }>('GET', '/api/health'),
  listJobs: () => request<Job[]>('GET', '/api/jobs'),
  /** Start a split from a YouTube link or a file on this computer. */
  createJob: (source: { url: string } | { path: string }) => request<Job>('POST', '/api/jobs', source),
  /** Download a whole video, playlist or course. Without `video`, the choices in Settings are used. */
  createVideoJob: (url: string, video?: VideoOptions) => request<Job>('POST', '/api/jobs', { url, kind: 'video', video }),
  videoDetails: (url: string) => request<VideoDetails | PlaylistDetails>('POST', '/api/video/info', { url }),
  pauseJob: (id: string) => request<{ status: string }>('POST', `/api/jobs/${id}/pause`),
  libraryVideos: () => request<LibraryVideo[]>('GET', '/api/library/videos'),
  removeVideo: (path: string, deleteFile: boolean) =>
    request<{ removed: boolean; deleted: boolean }>('POST', '/api/library/videos/remove', { path, delete_file: deleteFile }),
  videoFileUrl: (key: string) => mediaUrl(`/api/library/videos/${key}/file`),
  playerDetails: (key: string) => request<PlayerDetails>('GET', `/api/library/videos/${key}/details`),
  /** WebVTT text of one subtitle track. */
  playerSubtitles: async (key: string, trackId: string) => {
    const res = await fetch(mediaUrl(`/api/library/videos/${key}/subtitles/${encodeURIComponent(trackId)}`))
    if (!res.ok) throw new ApiError(`Couldn't load the subtitles (${res.status})`, res.status)
    return res.text()
  },
  saveVideoProgress: (key: string, position: number, duration: number) =>
    request<{ saved: boolean }>('PUT', `/api/library/videos/${key}/progress`, { position, duration }),
  videoThumbnailUrl: (videoId: string) => mediaUrl(`/api/library/videos/${encodeURIComponent(videoId)}/thumbnail`),
  saveReview: (id: string, payload: ReviewPayload) => request<Job>('PUT', `/api/jobs/${id}`, payload),
  exportJob: (id: string, payload: ReviewPayload) => request<{ status: string }>('POST', `/api/jobs/${id}/export`, payload),
  identifyJob: (id: string, payload: ReviewPayload) => request<{ tracks: Track[]; named: number }>('POST', `/api/jobs/${id}/identify`, payload),
  tidyNames: (id: string, payload: ReviewPayload) =>
    request<{ tracks: Track[]; collection: Collection; changed: number }>('POST', `/api/jobs/${id}/tidy-names`, payload),
  findDuplicates: (id: string, payload: ReviewPayload) =>
    request<Record<string, LibraryMatch[]>>('POST', `/api/jobs/${id}/duplicates`, payload),
  importTracklist: (id: string, text: string) =>
    request<{ tracks: Track[]; collection: Partial<Collection>; format: 'starts' | 'lengths' | 'cue'; snapped: boolean }>(
      'POST',
      `/api/jobs/${id}/tracklist`,
      { text },
    ),
  linkHistory: (url: string) => request<LinkHistory>('POST', '/api/links/history', { url }),
  expandLink: (url: string) => request<ListedLink>('POST', '/api/links/expand', { url }),
  setCover: (id: string, path: string) => request<Job>('POST', `/api/jobs/${id}/cover`, { path }),
  resetCover: (id: string) => request<Job>('DELETE', `/api/jobs/${id}/cover`),
  searchAlbums: (id: string, album: string, artist: string) =>
    request<{ releases: AlbumRelease[] }>('POST', `/api/jobs/${id}/album-search`, { album, artist }),
  applyAlbum: (id: string, releaseId: string, cover: boolean) =>
    request<AlbumDetails & { cover: boolean; job: Job }>('POST', `/api/jobs/${id}/album-apply`, { release_id: releaseId, cover }),
  retryJob: (id: string) => request<Job>('POST', `/api/jobs/${id}/retry`),
  cancelJob: (id: string) => request<{ status: string }>('POST', `/api/jobs/${id}/cancel`),
  deleteJob: (id: string) => request<{ status: string }>('DELETE', `/api/jobs/${id}`),
  getPreferences: () => request<Preferences>('GET', '/api/preferences'),
  savePreferences: (prefs: Preferences) => request<Preferences>('PUT', '/api/preferences', prefs),
  librarySongs: (sort = 'artist') => request<LibrarySong[]>('GET', `/api/library/songs?sort=${sort}`),
  editSongs: (ids: string[], changes: TagChanges) => request<LibrarySong[]>('PUT', '/api/library/songs', { ids, changes }),
  scanLibrary: () => request<{ added: number; updated: number; removed: number; total: number }>('POST', '/api/library/scan'),
  musicApp: () => request<{ folder: string | null; name: string | null }>('GET', '/api/library/music-app'),
  sendSongs: (body: { ids: string[]; target: 'folder' | 'music_app'; destination?: string; layout?: 'folders' | 'flat'; to_mp3?: boolean }) =>
    request<{ task_id: string; total: number; destination: string }>('POST', '/api/library/send', body),
  songAudioUrl: (id: string) => mediaUrl(`/api/library/songs/${id}/audio`),
  songCoverUrl: (id: string) => mediaUrl(`/api/library/songs/${id}/cover`),
  storage: () => request<StorageInfo>('GET', '/api/storage'),
  clearDownloads: () => request<{ freed_bytes: number; jobs_cleared: number }>('POST', '/api/storage/clear-downloads'),
  updateYtDlp: () => request<{ updated: boolean; restart_required: boolean }>('POST', '/api/yt-dlp/update'),
  peaks: (jobId: string, sourceId: string) =>
    request<{ duration: number; peaks: number[] }>('GET', `/api/jobs/${jobId}/sources/${sourceId}/peaks`),
  windowPeaks: (jobId: string, sourceId: string, start: number, end: number, points: number) =>
    request<{ start: number; end: number; peaks: number[] }>(
      'GET',
      `/api/jobs/${jobId}/sources/${sourceId}/peaks?start=${start.toFixed(3)}&end=${end.toFixed(3)}&points=${points}`,
    ),
  sourceAudioUrl: (jobId: string, sourceId: string) => mediaUrl(`/api/jobs/${jobId}/sources/${sourceId}/audio`),
  thumbnailUrl: (jobId: string, updatedAt: number) => `${mediaUrl(`/api/jobs/${jobId}/thumbnail`)}&v=${updatedAt}`,
}
