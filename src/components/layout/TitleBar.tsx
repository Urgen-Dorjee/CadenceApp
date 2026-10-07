import { useLocation } from 'react-router-dom'
import { AudioLines } from 'lucide-react'
import { clsx } from 'clsx'
import { useJobsStore } from '../../stores/jobsStore'
import { isMac } from '../../lib/platform'

function pageTitle(pathname: string, jobTitle?: string) {
  if (pathname.startsWith('/jobs/')) return jobTitle ? `Review · ${jobTitle}` : 'Review'
  if (pathname.startsWith('/library')) return 'Library'
  if (pathname.startsWith('/settings')) return 'Settings'
  return 'New split'
}

/** Custom title bar. Windows and Linux draw min/max/close on the right (titleBarOverlay); macOS its traffic lights on the left. */
export default function TitleBar() {
  const { pathname } = useLocation()
  const jobId = pathname.startsWith('/jobs/') ? pathname.split('/')[2] : ''
  const jobTitle = useJobsStore((s) => (jobId ? s.jobs[jobId]?.title : undefined))

  return (
    <header className="drag h-10 shrink-0 flex items-center bg-chrome select-none">
      <div className={clsx('w-60 shrink-0 flex items-center gap-2.5 px-4', isMac() && 'pl-[84px] w-[300px]')}>
        <span className="w-6 h-6 rounded-[7px] bg-gradient-to-b from-accent to-accent/70 text-accent-ink flex items-center justify-center" aria-hidden="true">
          <AudioLines size={14} strokeWidth={2.5} />
        </span>
        <span className="font-display text-[13px] font-semibold tracking-tight">Cadence</span>
      </div>
      <p className={clsx('flex-1 min-w-0 truncate text-xs text-muted', isMac() ? 'pr-4' : 'pr-40')}>{pageTitle(pathname, jobTitle)}</p>
    </header>
  )
}
