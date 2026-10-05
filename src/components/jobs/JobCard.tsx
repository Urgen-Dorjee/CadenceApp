import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Music2, RotateCcw, X, Trash2, ArrowRight, FolderOpen } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../services/api'
import { isRunning, type Job } from '../../types/job'
import StatusPill from '../ui/StatusPill'
import ProgressBar from '../ui/ProgressBar'

const TYPE_LABEL: Record<string, string> = {
  artist: 'Singer collection',
  album: 'Movie album',
  collection: 'Collection',
  single: 'Single song',
}

export function Thumbnail({ job, className }: { job: Job; className: string }) {
  const [failed, setFailed] = useState(false)
  if (!job.thumbnail || failed) {
    return (
      <div className={`${className} bg-raised flex items-center justify-center text-faint`} aria-hidden="true">
        <Music2 size={20} />
      </div>
    )
  }
  return (
    <img
      src={api.thumbnailUrl(job.id, job.updated_at)}
      alt=""
      onError={() => setFailed(true)}
      className={`${className} object-cover bg-raised`}
    />
  )
}

export default function JobCard({ job }: { job: Job }) {
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const running = isRunning(job)
  const reviewable = job.status === 'review' || job.status === 'completed'
  const collectionType = 'type' in job.collection ? TYPE_LABEL[job.collection.type] : null
  const included = job.tracks.filter((t) => t.include).length

  const run = (action: () => Promise<unknown>, failure: string) =>
    action().catch((e: Error) => toast.error(`${failure}: ${e.message}`))

  return (
    <article className="px-4 py-3 flex gap-4 items-center animate-fade-in hover:bg-raised/40 transition-colors">
      <Thumbnail job={job} className="w-24 h-[54px] rounded shrink-0" />

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-medium truncate" title={job.title || job.url}>
            {job.title || job.url}
          </h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted min-w-0">
          <StatusPill status={job.status} />
          {collectionType && <span>{collectionType}</span>}
          {job.tracks.length > 0 && (
            <span className="tnum">
              · {job.status === 'completed' ? `${job.outputs.length} saved` : `${included} songs`}
            </span>
          )}
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
        {reviewable && (
          <button className="btn-secondary" onClick={() => navigate(`/jobs/${job.id}`)}>
            {job.status === 'review' ? 'Review' : 'Open'} <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
        {job.status === 'completed' && job.outputs[0] && (
          <button
            className="btn-icon"
            title="Show in folder"
            aria-label="Show in folder"
            onClick={() => window.electronAPI?.showItemInFolder(job.outputs[0].path)}
          >
            <FolderOpen size={16} />
          </button>
        )}
        {(job.status === 'failed' || job.status === 'cancelled') && (
          <button className="btn-secondary" onClick={() => run(() => api.retryJob(job.id), 'Could not retry')}>
            <RotateCcw size={14} aria-hidden="true" /> Retry
          </button>
        )}
        {running && (
          <button
            className="btn-icon"
            title="Cancel"
            aria-label="Cancel"
            onClick={() => run(() => api.cancelJob(job.id), 'Could not cancel')}
          >
            <X size={16} />
          </button>
        )}
        {confirmDelete ? (
          <button
            className="btn-danger h-8"
            onBlur={() => setConfirmDelete(false)}
            autoFocus
            onClick={() => run(() => api.deleteJob(job.id), 'Could not remove')}
          >
            Remove
          </button>
        ) : (
          <button
            className="btn-icon"
            title="Remove from list (saved songs are kept)"
            aria-label="Remove from list"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </article>
  )
}
