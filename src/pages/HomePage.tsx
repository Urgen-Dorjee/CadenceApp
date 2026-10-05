import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPaste, Loader2, Scissors, ListMusic, FolderTree, FolderOpen, Link2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../services/api'
import { useAppStore } from '../stores/appStore'
import { sortedJobs, useJobsStore } from '../stores/jobsStore'
import { usePrefsStore } from '../stores/prefsStore'
import JobCard from '../components/jobs/JobCard'

const YOUTUBE_RE = /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/\S+$/i

const STEPS = [
  { icon: ListMusic, title: 'Finds every song', text: 'Uses chapters, the description or comments, and listens for gaps when there are none.' },
  { icon: Scissors, title: 'Cuts cleanly', text: 'Each cut lands on the quietest moment between songs, so nothing starts or ends mid-note.' },
  { icon: FolderTree, title: 'Files them for you', text: 'Singer collections go into Artists, movie albums into Albums, tagged with cover art.' },
]

function SaveToRow() {
  const navigate = useNavigate()
  const prefs = usePrefsStore((s) => s.prefs)
  const update = usePrefsStore((s) => s.update)
  if (!prefs) return null

  const change = async () => {
    const folder = await window.electronAPI?.selectFolder({ defaultPath: prefs.library_dir, title: 'Save songs to' })
    if (!folder) return
    try {
      await update({ library_dir: folder, save_mode: 'library' })
      toast.success('Songs will be saved there from now on')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 h-11 border-t border-line text-xs">
      <FolderOpen size={14} className="text-muted shrink-0" aria-hidden="true" />
      <span className="text-muted shrink-0">Save to</span>
      {prefs.save_mode === 'ask' ? (
        <span className="flex-1 text-ink">You'll choose a folder when you save</span>
      ) : (
        <button
          className="flex-1 min-w-0 text-left font-mono text-[12px] truncate text-ink hover:text-accent"
          onClick={() => window.electronAPI?.openPath(prefs.library_dir)}
          title="Open this folder"
        >
          {prefs.library_dir}
        </button>
      )}
      <button className="btn-ghost h-7 px-2" onClick={change}>Change folder</button>
      <button className="btn-ghost h-7 px-2" onClick={() => navigate('/settings#saving')}>Options</button>
    </div>
  )
}

export default function HomePage() {
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null)
  const ready = useAppStore((s) => s.backend === 'ready')
  const jobsMap = useJobsStore((s) => s.jobs)
  const jobs = sortedJobs(jobsMap)

  const checkClipboard = useCallback(async () => {
    const text = (await window.electronAPI?.readClipboard().catch(() => ''))?.trim() ?? ''
    const known = Object.values(useJobsStore.getState().jobs).some((j) => j.url === text)
    setClipboardUrl(YOUTUBE_RE.test(text) && !known ? text : null)
  }, [])

  useEffect(() => {
    checkClipboard()
    window.addEventListener('focus', checkClipboard)
    return () => window.removeEventListener('focus', checkClipboard)
  }, [checkClipboard])

  const start = async (link: string) => {
    const value = link.trim()
    if (!YOUTUBE_RE.test(value)) {
      toast.error('Paste a YouTube video or playlist link.')
      return
    }
    setSubmitting(true)
    try {
      const job = await api.createJob(value)
      useJobsStore.getState().upsert(job)
      setUrl('')
      setClipboardUrl(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    start(url)
  }

  return (
    <div className="max-w-5xl mx-auto px-8 py-8 flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-xl font-semibold tracking-tight">New split</h1>
        <p className="text-muted">Paste a YouTube link to a movie album, a singer collection or a playlist.</p>
      </header>

      <section className="panel overflow-hidden" aria-label="Start a split">
        <form onSubmit={onSubmit} className="flex gap-2 p-4">
          <label htmlFor="url" className="sr-only">YouTube link</label>
          <div className="relative flex-1">
            <Link2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
            <input
              id="url"
              className="field h-11 pl-9 text-[14px]"
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <button type="submit" className="btn-primary h-11 px-5 text-[14px]" disabled={!ready || submitting || !url.trim()}>
            {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Scissors size={16} aria-hidden="true" />}
            Split songs
          </button>
        </form>
        {clipboardUrl && (
          <div className="px-4 pb-3 -mt-1">
            <button
              type="button"
              onClick={() => start(clipboardUrl)}
              disabled={!ready || submitting}
              className="flex items-center gap-2 h-7 pl-2.5 pr-3 rounded-full border border-line bg-raised text-xs text-muted hover:text-ink hover:border-line-strong transition-colors max-w-full animate-fade-in"
            >
              <ClipboardPaste size={13} aria-hidden="true" />
              <span className="shrink-0">Split the link you copied:</span>
              <span className="truncate font-mono text-ink">{clipboardUrl}</span>
            </button>
          </div>
        )}
        <SaveToRow />
      </section>

      {jobs.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="jobs-heading">
          <div className="flex items-baseline justify-between">
            <h2 id="jobs-heading" className="eyebrow">Recent splits</h2>
            <span className="text-xs text-faint tnum">{jobs.length}</span>
          </div>
          <div className="panel divide-y divide-line overflow-hidden">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        </section>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3" aria-label="How it works">
          {STEPS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex flex-col gap-2 p-4 rounded-lg border border-dashed border-line">
              <Icon size={18} className="text-accent" aria-hidden="true" />
              <h3 className="font-medium">{title}</h3>
              <p className="text-[13px] text-muted">{text}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
