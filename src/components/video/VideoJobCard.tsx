import { useState } from 'react'
import { FolderOpen, Pause, Play, RotateCcw, Trash2, Video, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../services/api'
import { isRunning, type Job } from '../../types/job'
import { isCourse, optionsSummary } from '../../lib/video'
import { useVideoPlayer } from '../../stores/videoPlayerStore'
import StatusPill from '../ui/StatusPill'
import ProgressBar from '../ui/ProgressBar'

export function KindBadge({ kind }: { kind: 'music' | 'video' | 'course' }) {
  const tone = kind === 'music' ? 'bg-accent/15 text-accent' : kind === 'video' ? 'bg-seg2/15 text-seg2' : 'bg-seg3/15 text-seg3'
  return <span className={`inline-flex items-center h-[18px] px-1.5 rounded text-[10.5px] font-bold tracking-wide uppercase ${tone}`}>{kind}</span>
}

function VideoThumb({ job }: { job: Job }) {
  const [failed, setFailed] = useState(false)
  if (!job.thumbnail || failed) {
    return (
      <div className="w-24 h-[54px] rounded shrink-0 bg-raised flex items-center justify-center text-seg2" aria-hidden="true">
        <Video size={20} />
      </div>
    )
  }
  return <img src={api.thumbnailUrl(job.id, job.updated_at)} alt="" onError={() => setFailed(true)} className="w-24 h-[54px] rounded shrink-0 object-cover bg-raised" />
}

/** A whole-video download in the list: progress, pause and resume, then play or show it. */
export default function VideoJobCard({ job, showKind = true }: { job: Job; showKind?: boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const running = isRunning(job)
  const course = isCourse(job)
  const saved = job.outputs.length
  const first = job.outputs[0]

  const run = (action: () => Promise<unknown>, failure: string) =>
    action().catch((e: Error) => toast.error(`${failure}: ${e.message}`))

  const openPlayer = useVideoPlayer((s) => s.open)
  // Sound-only downloads (M4A) play in the system's player; videos in Cadence's own.
  const play = async () => {
    if (!first) return
    if (job.options?.quality !== 'audio') return openPlayer(first.path)
    const problem = await window.electronAPI?.openFile(first.path)
    if (problem) toast.error(problem)
  }

  return (
    <article className="px-4 py-3 flex gap-4 items-center animate-fade-in hover:bg-raised/40 transition-colors">
      <VideoThumb job={job} />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {showKind && <KindBadge kind={course ? 'course' : 'video'} />}
          <h3 className="font-medium truncate" title={job.title || job.url}>{job.title || job.url}</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted min-w-0">
          <StatusPill status={job.status} />
          <span className="truncate">{optionsSummary(job.options ?? {})}</span>
          {course && saved > 0 && <span className="tnum shrink-0">· {saved} saved</span>}
        </div>
        {running ? (
          <div className="flex flex-col gap-1">
            <ProgressBar value={job.progress} label={job.message} />
            <p className="text-xs text-muted truncate">{job.message}</p>
          </div>
        ) : job.error ? (
          <p className="text-xs text-danger line-clamp-2">{job.error}</p>
        ) : (
          job.message && <p className="text-xs text-muted truncate">{job.message}</p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {job.status === 'completed' && first && (
          <button className="btn-primary" onClick={play}>
            <Play size={13} aria-hidden="true" /> Play
          </button>
        )}
        {first && (
          <button className="btn-icon" title="Show in folder" aria-label="Show in folder" onClick={() => window.electronAPI?.showItemInFolder(first.path)}>
            <FolderOpen size={16} />
          </button>
        )}
        {running && job.status === 'downloading' && (
          <button className="btn-icon" title="Pause" aria-label="Pause" onClick={() => run(() => api.pauseJob(job.id), 'Could not pause')}>
            <Pause size={15} />
          </button>
        )}
        {job.status === 'paused' && (
          <button className="btn-secondary" onClick={() => run(() => api.retryJob(job.id), 'Could not resume')}>
            <Play size={13} aria-hidden="true" /> Resume
          </button>
        )}
        {(job.status === 'failed' || job.status === 'cancelled') && (
          <button className="btn-secondary" onClick={() => run(() => api.retryJob(job.id), 'Could not retry')}>
            <RotateCcw size={14} aria-hidden="true" /> {job.status === 'failed' ? 'Try again' : 'Start again'}
          </button>
        )}
        {running && (
          <button className="btn-icon" title="Cancel" aria-label="Cancel" onClick={() => run(() => api.cancelJob(job.id), 'Could not cancel')}>
            <X size={16} />
          </button>
        )}
        {!running && (confirmDelete ? (
          <button className="btn-danger h-8" onBlur={() => setConfirmDelete(false)} autoFocus onClick={() => run(() => api.deleteJob(job.id), 'Could not remove')}>
            Remove
          </button>
        ) : (
          <button className="btn-icon" title="Remove from list (saved videos are kept)" aria-label="Remove from list" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={15} />
          </button>
        ))}
      </div>
    </article>
  )
}
