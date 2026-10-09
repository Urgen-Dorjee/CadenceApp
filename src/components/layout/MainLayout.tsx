import { ReactNode, useEffect } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'
import TitleBar from './TitleBar'
import Sidebar from './Sidebar'
import PlayerBar from './PlayerBar'
import WelcomeDialog from './WelcomeDialog'
import { usePrefsStore } from '../../stores/prefsStore'
import { useAppStore } from '../../stores/appStore'
import { sortedJobs, useJobsStore } from '../../stores/jobsStore'
import { isRunning } from '../../types/job'

function StatusBar() {
  const backend = useAppStore((s) => s.backend)
  const error = useAppStore((s) => s.backendError)
  const ffmpeg = useAppStore((s) => s.ffmpegAvailable)
  const ytDlp = useAppStore((s) => s.ytDlpVersion)
  const active = useJobsStore((s) => sortedJobs(s.jobs).find(isRunning))
  const update = useAppStore((s) => s.update)

  const tone = backend === 'error' || (backend === 'ready' && !ffmpeg) ? 'bad' : backend === 'starting' || backend === 'restarting' ? 'wait' : 'ok'
  const label =
    backend === 'starting'
      ? 'Starting audio engine…'
      : backend === 'restarting'
        ? 'Audio engine stopped unexpectedly. Restarting…'
      : backend === 'error'
        ? 'Audio engine stopped'
        : !ffmpeg
          ? 'FFmpeg missing'
          : 'Ready'

  return (
    <footer className="h-7 shrink-0 bg-chrome flex items-center gap-4 px-4 text-[11px] text-faint select-none" role="status">
      <span className="flex items-center gap-1.5">
        <span
          className={clsx(
            'w-1.5 h-1.5 rounded-full',
            tone === 'ok' && 'bg-ok',
            tone === 'wait' && 'bg-warn animate-pulse',
            tone === 'bad' && 'bg-danger',
          )}
          aria-hidden="true"
        />
        {label}
      </span>
      {active && (
        <span className="truncate text-muted">
          {active.title ? `${active.title}: ` : ''}
          {active.message}
        </span>
      )}
      <span className="ml-auto flex items-center gap-3 font-mono">
        {update.state === 'downloading' && <span className="font-sans">Downloading update {update.percent ?? 0}%</span>}
        {update.state === 'available' && update.message && (
          <a
            className="font-sans h-5 px-2 rounded bg-accent text-accent-ink font-medium hover:brightness-110 inline-flex items-center"
            href={update.message}
            target="_blank"
            rel="noreferrer"
            title={`Cadence ${update.version} is available. Download it from GitHub.`}
          >
            Cadence {update.version} available
          </a>
        )}
        {update.state === 'ready' && (
          <button
            className="font-sans h-5 px-2 rounded bg-accent text-accent-ink font-medium hover:brightness-110"
            onClick={() => window.electronAPI?.installUpdate()}
            title={`Cadence ${update.version} is ready. Restart to install it.`}
          >
            Restart to update
          </button>
        )}
        {ytDlp && <span>yt-dlp {ytDlp}</span>}
        {error && <span className="text-danger truncate max-w-80">{error}</span>}
      </span>
    </footer>
  )
}

function EngineAlert() {
  const backend = useAppStore((s) => s.backend)
  const error = useAppStore((s) => s.backendError)
  const ffmpeg = useAppStore((s) => s.ffmpegAvailable)
  if (backend === 'error' || (backend === 'ready' && !ffmpeg)) {
    return (
      <div role="alert" className="flex items-center gap-2 px-6 py-2 text-xs text-danger border-b border-danger/25 bg-danger/10">
        <AlertTriangle size={13} aria-hidden="true" />
        {backend === 'error'
          ? `The audio engine didn't start: ${error}`
          : 'FFmpeg is missing, so songs can’t be cut. Run "npm run setup:ffmpeg" and restart Cadence.'}
      </div>
    )
  }
  return null
}

/** The welcome screen, for new users only: no settings saved yet and no splits. */
function Welcome() {
  const prefs = usePrefsStore((s) => s.prefs)
  const update = usePrefsStore((s) => s.update)
  const jobsLoaded = useJobsStore((s) => s.loaded)
  const hasJobs = useJobsStore((s) => Object.keys(s.jobs).length > 0)
  const pending = Boolean(prefs && !prefs.onboarded && jobsLoaded)

  // Someone with splits already knows Cadence: don't show it, and don't show it later either.
  useEffect(() => {
    if (pending && hasJobs) update({ onboarded: true }).catch(() => {})
  }, [pending, hasJobs, update])

  if (!pending || hasJobs || !prefs) return null
  return (
    <WelcomeDialog
      initial={{ library_dir: prefs.library_dir, audio_format: prefs.audio_format, loudness: prefs.loudness === 'off' ? 'tags' : prefs.loudness }}
      onFinish={async (choices) => {
        try {
          await update({ ...choices, save_mode: 'library', onboarded: true })
        } catch (e) {
          toast.error((e as Error).message)
        }
      }}
    />
  )
}

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 btn-primary">
        Skip to main content
      </a>
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0 bg-canvas rounded-tl-xl border-l border-t border-line overflow-hidden">
          <EngineAlert />
          <main id="main-content" className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
      <PlayerBar />
      <StatusBar />
      <Welcome />
    </div>
  )
}
