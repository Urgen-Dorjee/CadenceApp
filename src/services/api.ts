import type { Collection, Job, Preferences, Track } from '../types/job'

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

export interface StorageInfo {
  library_dir: string
  library_exists: boolean
  free_bytes: number
  total_bytes: number
  downloads_bytes: number
  downloads_count: number
  work_dir: string
}

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

export const api = {
  health: () => request<{ status: string; ffmpeg_available: boolean; yt_dlp_version: string }>('GET', '/api/health'),
  listJobs: () => request<Job[]>('GET', '/api/jobs'),
  /** Start a split from a YouTube link or a file on this computer. */
  createJob: (source: { url: string } | { path: string }) => request<Job>('POST', '/api/jobs', source),
  saveReview: (id: string, payload: ReviewPayload) => request<Job>('PUT', `/api/jobs/${id}`, payload),
  exportJob: (id: string, payload: ReviewPayload) => request<{ status: string }>('POST', `/api/jobs/${id}/export`, payload),
  identifyJob: (id: string, payload: ReviewPayload) => request<{ tracks: Track[]; named: number }>('POST', `/api/jobs/${id}/identify`, payload),
  tidyNames: (id: string, payload: ReviewPayload) =>
    request<{ tracks: Track[]; collection: Collection; changed: number }>('POST', `/api/jobs/${id}/tidy-names`, payload),
  importTracklist: (id: string, text: string) =>
    request<{ tracks: Track[]; collection: Partial<Collection>; format: 'starts' | 'lengths' | 'cue'; snapped: boolean }>(
      'POST',
      `/api/jobs/${id}/tracklist`,
      { text },
    ),
  retryJob: (id: string) => request<Job>('POST', `/api/jobs/${id}/retry`),
  cancelJob: (id: string) => request<{ status: string }>('POST', `/api/jobs/${id}/cancel`),
  deleteJob: (id: string) => request<{ status: string }>('DELETE', `/api/jobs/${id}`),
  getPreferences: () => request<Preferences>('GET', '/api/preferences'),
  savePreferences: (prefs: Preferences) => request<Preferences>('PUT', '/api/preferences', prefs),
  librarySongs: (sort = 'artist') => request<LibrarySong[]>('GET', `/api/library/songs?sort=${sort}`),
  scanLibrary: () => request<{ added: number; updated: number; removed: number; total: number }>('POST', '/api/library/scan'),
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
  thumbnailUrl: (jobId: string, updatedAt: number) => `${mediaUrl(`/api/jobs/${jobId}/thumbnail`)}&v=${Math.floor(updatedAt)}`,
}
