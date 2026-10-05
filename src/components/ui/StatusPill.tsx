import { clsx } from 'clsx'
import type { JobStatus } from '../../types/job'

const LABELS: Record<JobStatus, string> = {
  queued: 'Queued',
  resolving: 'Reading',
  downloading: 'Downloading',
  analyzing: 'Finding songs',
  review: 'Ready to review',
  exporting: 'Saving',
  completed: 'Saved',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const TONES: Record<JobStatus, string> = {
  queued: 'bg-raised text-muted',
  resolving: 'bg-accent/15 text-accent',
  downloading: 'bg-accent/15 text-accent',
  analyzing: 'bg-accent/15 text-accent',
  exporting: 'bg-accent/15 text-accent',
  review: 'bg-warn/15 text-warn',
  completed: 'bg-ok/15 text-ok',
  failed: 'bg-danger/15 text-danger',
  cancelled: 'bg-raised text-muted',
}

export default function StatusPill({ status }: { status: JobStatus }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-medium', TONES[status])}>
      {['resolving', 'downloading', 'analyzing', 'exporting'].includes(status) && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />
      )}
      {LABELS[status]}
    </span>
  )
}
