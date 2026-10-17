import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { FolderOpen, Loader2, Play, Search, Trash2, Video } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, type LibraryVideo } from '../../services/api'
import { useAppStore } from '../../stores/appStore'
import { useJobsStore } from '../../stores/jobsStore'
import { usePrefsStore } from '../../stores/prefsStore'
import { formatDuration } from '../../lib/time'
import { formatSize, languageName } from '../../lib/video'
import { trashName } from '../../lib/platform'

type Filter = 'all' | 'courses' | 'subtitles'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'courses', label: 'Courses' },
  { id: 'subtitles', label: 'With subtitles' },
]

function resolution(v: LibraryVideo): string {
  if (!v.height) return v.ext.toUpperCase()
  return v.height >= 2000 ? '4K' : `${v.height}p`
}

function Thumb({ video }: { video: LibraryVideo }) {
  const [failed, setFailed] = useState(false)
  if (!video.thumbnail || !video.video_id || failed) {
    return <Video size={30} className="text-faint" aria-hidden="true" />
  }
  return <img src={api.videoThumbnailUrl(video.video_id)} alt="" onError={() => setFailed(true)} className="absolute inset-0 w-full h-full object-cover" />
}

function VideoCard({ video, onRemove }: { video: LibraryVideo; onRemove: (v: LibraryVideo, deleteFile: boolean) => void }) {
  const [confirm, setConfirm] = useState(false)
  const play = async () => {
    const problem = await window.electronAPI?.openFile(video.path)
    if (problem) toast.error(problem)
  }
  const meta = [video.playlist ? `${video.playlist} · ${video.playlist_index}` : video.channel, video.subtitles.length ? `CC ${video.subtitles.map(languageName).join(', ')}` : '']
    .filter(Boolean)
    .join(' · ')

  return (
    <article className="group flex flex-col gap-2">
      <button
        type="button"
        onClick={play}
        className="relative aspect-video rounded-lg overflow-hidden bg-raised border border-line flex items-center justify-center focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`Play ${video.title}`}
      >
        <Thumb video={video} />
        <span className="absolute inset-0 bg-black/0 group-hover:bg-black/35 transition-colors flex items-center justify-center">
          <Play size={30} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="currentColor" aria-hidden="true" />
        </span>
        <span className="absolute left-2 top-2 h-[18px] px-1.5 rounded bg-black/70 text-[10.5px] font-bold text-white flex items-center">{resolution(video)}</span>
        {video.duration > 0 && (
          <span className="absolute right-2 bottom-2 h-[18px] px-1.5 rounded bg-black/75 text-[11px] font-semibold text-white flex items-center tnum">
            {formatDuration(video.duration)}
          </span>
        )}
      </button>
      <div className="flex gap-2 items-start">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium leading-snug line-clamp-2" title={video.title}>{video.title}</h3>
          <p className="text-xs text-muted truncate" title={meta}>{meta}</p>
          <p className="text-[11px] text-faint tnum">{formatSize(video.size)}</p>
        </div>
        <div className="flex gap-0.5 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button className="btn-icon w-7 h-7" title="Show in folder" aria-label={`Show ${video.title} in folder`} onClick={() => window.electronAPI?.showItemInFolder(video.path)}>
            <FolderOpen size={14} />
          </button>
          <button className="btn-icon w-7 h-7" title="Remove" aria-label={`Remove ${video.title}`} onClick={() => setConfirm(true)}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {confirm && (
        <div className="flex flex-wrap gap-1.5 animate-fade-in" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setConfirm(false)}>
          <button className="btn-danger h-7 px-2 text-xs" autoFocus onClick={() => onRemove(video, true)}>Move to {trashName()}</button>
          <button className="btn-secondary h-7 px-2 text-xs" onClick={() => onRemove(video, false)}>Only remove from list</button>
          <button className="btn-ghost h-7 px-2 text-xs" onClick={() => setConfirm(false)}>Keep</button>
        </div>
      )}
    </article>
  )
}

/** The library's Videos tab: every whole video Cadence downloaded. */
export default function VideoLibrary({ tabs }: { tabs: ReactNode }) {
  const navigate = useNavigate()
  const ready = useAppStore((s) => s.backend === 'ready')
  const prefs = usePrefsStore((s) => s.prefs)
  const update = usePrefsStore((s) => s.update)
  const finished = useJobsStore((s) => Object.values(s.jobs).filter((j) => j.kind === 'video').reduce((n, j) => n + j.outputs.length, 0))
  const [videos, setVideos] = useState<LibraryVideo[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const load = useCallback(() => api.libraryVideos().then(setVideos).catch((e: Error) => toast.error(e.message)), [])
  useEffect(() => {
    if (ready) load()
  }, [ready, load, finished])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (videos ?? []).filter((v) =>
      (filter === 'all' || (filter === 'courses' ? Boolean(v.playlist) : v.subtitles.length > 0))
      && (!q || `${v.title} ${v.channel} ${v.playlist}`.toLowerCase().includes(q)),
    ).sort((a, b) => (a.playlist && a.playlist === b.playlist ? a.playlist_index - b.playlist_index : b.saved_at - a.saved_at))
  }, [videos, filter, query])

  const remove = async (video: LibraryVideo, deleteFile: boolean) => {
    try {
      const r = await api.removeVideo(video.path, deleteFile)
      setVideos((old) => old?.filter((v) => v.path !== video.path) ?? null)
      toast.success(r.deleted ? `Moved “${video.title}” to the ${trashName()}` : `Removed “${video.title}” from the list. The file is kept.`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const startDownloading = async () => {
    await update({ download_mode: 'video' }).catch(() => undefined)
    navigate('/')
  }

  if (videos === null) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin text-muted" aria-label="Loading videos" />
      </div>
    )
  }

  const total = videos.reduce((t, v) => t + v.duration, 0)
  return (
    <div className="max-w-6xl mx-auto px-8 py-8 flex flex-col gap-6">
      <header className="flex items-end gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight">Library</h1>
          <p className="text-muted tnum">
            {videos.length} video{videos.length === 1 ? '' : 's'}{total > 0 && ` · ${formatDuration(total)}`}
          </p>
        </div>
        {tabs}
        {prefs && (
          <button className="btn-ghost" onClick={() => window.electronAPI?.openPath(prefs.video_dir)}>
            <FolderOpen size={14} aria-hidden="true" /> Open folder
          </button>
        )}
      </header>

      {videos.length === 0 ? (
        <div className="max-w-xl mx-auto py-16 flex flex-col items-center gap-3 text-center">
          <Video size={32} className="text-faint" aria-hidden="true" />
          <h2 className="font-display text-lg font-semibold">No videos yet</h2>
          <p className="text-muted">Videos you download whole (lectures, documentaries, courses) appear here.</p>
          <button className="btn-primary mt-2" onClick={startDownloading}>Download a video</button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1.5" role="group" aria-label="Show">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={clsx(
                    'h-7 px-3 rounded-full text-xs border transition-colors',
                    filter === f.id ? 'bg-accent/15 text-accent border-accent/40' : 'text-muted border-line-strong hover:text-ink',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
              <label htmlFor="video-search" className="sr-only">Search videos</label>
              <input id="video-search" className="field pl-8" placeholder="Search videos, channels or courses" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="text-muted">Nothing matches.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-4 gap-y-6">
              {shown.map((v) => <VideoCard key={v.path} video={v} onRemove={remove} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
