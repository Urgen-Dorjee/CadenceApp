import { NavLink, useNavigate } from 'react-router-dom'
import { Plus, Library, Settings, FolderOpen, HardDrive } from 'lucide-react'
import { clsx } from 'clsx'
import { sortedJobs, useJobsStore } from '../../stores/jobsStore'
import { formatBytes, shortPath, usePrefsStore } from '../../stores/prefsStore'
import { isRunning } from '../../types/job'

const mainNav = [
  { to: '/', icon: Plus, label: 'New split', end: true },
  { to: '/library', icon: Library, label: 'Library', end: false },
]

function NavItem({ to, icon: Icon, label, end, badge }: { to: string; icon: typeof Plus; label: string; end: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          'no-drag flex items-center gap-2.5 h-8 px-2.5 rounded-md text-[13px] transition-colors',
          isActive ? 'bg-raised text-ink font-medium shadow-[inset_0_0_0_1px_rgb(var(--line))]' : 'text-muted hover:text-ink hover:bg-raised/60',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={15} className={isActive ? 'text-accent' : undefined} aria-hidden="true" />
          <span className="flex-1">{label}</span>
          {!!badge && (
            <span className="min-w-5 h-5 px-1.5 rounded-full bg-warn/15 text-warn text-[11px] font-semibold flex items-center justify-center tnum" title={`${badge} ready to review`}>
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

export default function Sidebar() {
  const navigate = useNavigate()
  const jobs = useJobsStore((s) => s.jobs)
  const prefs = usePrefsStore((s) => s.prefs)
  const storage = usePrefsStore((s) => s.storage)
  const reviewCount = Object.values(jobs).filter((j) => j.status === 'review').length
  const running = sortedJobs(jobs).filter(isRunning).slice(0, 4)
  const askEachTime = prefs?.save_mode === 'ask'

  return (
    <aside className="w-60 shrink-0 bg-chrome flex flex-col gap-4 px-3 pb-3" aria-label="Main navigation">
      <nav className="flex flex-col gap-0.5">
        {mainNav.map((item) => (
          <NavItem key={item.to} {...item} badge={item.to === '/' ? reviewCount : undefined} />
        ))}
      </nav>

      {running.length > 0 && (
        <section className="flex flex-col gap-1.5" aria-label="In progress">
          <h2 className="eyebrow px-2.5">In progress</h2>
          {running.map((job) => (
            <button
              key={job.id}
              onClick={() => navigate('/')}
              className="no-drag text-left px-2.5 py-1.5 rounded-md hover:bg-raised/60 flex flex-col gap-1"
            >
              <span className="text-xs truncate">{job.title || 'Reading video…'}</span>
              <span className="h-1 rounded-full bg-raised overflow-hidden" aria-hidden="true">
                <span className="block h-full bg-accent transition-[width] duration-300" style={{ width: `${job.progress}%` }} />
              </span>
            </button>
          ))}
        </section>
      )}

      <div className="flex-1" />

      {prefs && (
        <section className="rounded-lg border border-line bg-surface p-3 flex flex-col gap-2" aria-label="Where songs are saved">
          <div className="flex items-center justify-between">
            <h2 className="eyebrow">Saving to</h2>
            <button className="no-drag text-[11px] text-accent hover:underline" onClick={() => navigate('/settings#saving')}>
              Change
            </button>
          </div>
          {askEachTime ? (
            <p className="text-xs text-muted">You choose a folder each time you save.</p>
          ) : (
            <button
              className="no-drag flex items-center gap-2 text-left text-xs min-w-0 group"
              onClick={() => window.electronAPI?.openPath(prefs.library_dir)}
              title={`${prefs.library_dir}\nClick to open`}
            >
              <FolderOpen size={14} className="text-muted group-hover:text-accent shrink-0" aria-hidden="true" />
              <span className="truncate font-mono text-[11.5px] group-hover:text-ink text-muted">{shortPath(prefs.library_dir)}</span>
            </button>
          )}
          {storage && (
            <p className="flex items-center gap-2 text-[11px] text-faint tnum">
              <HardDrive size={12} aria-hidden="true" />
              {formatBytes(storage.free_bytes)} free
              {storage.downloads_bytes > 0 && <> · downloads {formatBytes(storage.downloads_bytes)}</>}
            </p>
          )}
        </section>
      )}

      <nav>
        <NavItem to="/settings" icon={Settings} label="Settings" end={false} />
      </nav>
    </aside>
  )
}
