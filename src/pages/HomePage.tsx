import { DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPaste, Loader2, Scissors, ListMusic, FolderTree, FolderOpen, Link2, FileAudio, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../services/api'
import { useAppStore } from '../stores/appStore'
import { sortedJobs, useJobsStore } from '../stores/jobsStore'
import { usePrefsStore } from '../stores/prefsStore'
import JobCard from '../components/jobs/JobCard'
import { newLinks, readyToSave, youtubeLinks } from '../lib/batch'
import type { Collection } from '../types/job'

const EMPTY_COLLECTION: Collection = { type: 'collection', name: '', artist: '', album: '', year: '' }

const STEPS = [
  { icon: ListMusic, title: 'Finds every song', text: 'Uses chapters, the description or comments, and listens for gaps when there are none.' },
  { icon: Scissors, title: 'Cuts cleanly', text: 'Each cut lands in the real gap between songs, so nothing starts or ends mid-note.' },
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
  const [clipboardLinks, setClipboardLinks] = useState<string[]>([])
  const [savingAll, setSavingAll] = useState(false)
  const [dragging, setDragging] = useState(false)
  // dragenter/dragleave fire for every child element crossed, so count them.
  const dragDepth = useRef(0)
  const ready = useAppStore((s) => s.backend === 'ready')
  const jobsMap = useJobsStore((s) => s.jobs)
  const jobs = sortedJobs(jobsMap)
  const typedLinks = youtubeLinks(url)
  const { ready: readyJobs, toCheck } = readyToSave(jobs)
  const prefs = usePrefsStore((s) => s.prefs)

  const checkClipboard = useCallback(async () => {
    const text = (await window.electronAPI?.readClipboard().catch(() => ''))?.trim() ?? ''
    setClipboardLinks(newLinks(youtubeLinks(text), Object.values(useJobsStore.getState().jobs)))
  }, [])

  useEffect(() => {
    checkClipboard()
    window.addEventListener('focus', checkClipboard)
    return () => window.removeEventListener('focus', checkClipboard)
  }, [checkClipboard])

  /** Start one split per link or file. They're analysed in the background, two at a time. */
  const startAll = async (sources: ({ url: string } | { path: string })[]) => {
    if (!sources.length) return
    setSubmitting(true)
    let started = 0
    const failures: string[] = []
    for (const source of sources) {
      try {
        useJobsStore.getState().upsert(await api.createJob(source))
        started += 1
      } catch (e) {
        const name = 'url' in source ? source.url : source.path.split(/[\\/]/).pop()
        failures.push(sources.length > 1 ? `${name}: ${(e as Error).message}` : (e as Error).message)
      }
    }
    setSubmitting(false)
    if (started > 1) toast.success(`Started ${started} splits. They're worked on two at a time.`)
    failures.forEach((f) => toast.error(f))
    return started
  }

  const startLinks = async (links: string[]) => {
    if (!links.length) {
      toast.error('Paste a YouTube video or playlist link.')
      return
    }
    const fresh = newLinks(links, Object.values(useJobsStore.getState().jobs))
    const skipped = links.length - fresh.length
    if (skipped) toast(`${skipped === 1 ? 'One link is' : `${skipped} links are`} already in your list.`)
    await startAll(fresh.map((u) => ({ url: u })))
    setUrl('')
    setClipboardLinks([])
  }

  /** Split audio or video files from this computer. The files themselves are never changed. */
  const startFiles = (paths: (string | null | undefined)[]) =>
    startAll(paths.filter((p): p is string => Boolean(p)).map((path) => ({ path })))

  const openFiles = async () => startFiles((await window.electronAPI?.selectMediaFiles()) ?? [])

  /** Save every reviewed split whose cuts are all confident. Splits with cuts to check are left for you. */
  const saveAllReady = async () => {
    let destination = ''
    if (prefs?.save_mode === 'ask' && readyJobs.some((j) => !j.destination)) {
      const picked = await window.electronAPI?.selectFolder({ defaultPath: prefs.library_dir, title: 'Save these splits to' })
      if (!picked) return
      destination = picked
    }
    setSavingAll(true)
    let queued = 0
    for (const job of readyJobs) {
      try {
        await api.exportJob(job.id, {
          tracks: job.tracks,
          collection: { ...EMPTY_COLLECTION, ...(job.collection as Partial<Collection>) },
          destination: job.destination || destination,
        })
        queued += 1
      } catch (e) {
        toast.error(`${job.title}: ${(e as Error).message}`)
      }
    }
    setSavingAll(false)
    if (queued) toast.success(`Saving ${queued} split${queued === 1 ? '' : 's'}, one after another.`)
    if (toCheck.length) {
      toast(`${toCheck.length} split${toCheck.length === 1 ? ' has' : 's have'} cuts to check first: ${toCheck.map((j) => j.title).join(', ')}`, {
        duration: 8000,
      })
    }
  }

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return
    dragDepth.current += 1
    setDragging(true)
  }
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (!ready) {
      toast('Cadence is still starting. Try again in a moment.')
      return
    }
    startFiles(Array.from(e.dataTransfer.files).map((f) => window.electronAPI?.pathForFile(f)))
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    startLinks(typedLinks)
  }

  return (
    <div
      className="max-w-5xl mx-auto px-8 py-8 flex flex-col gap-8 min-h-full"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-xl font-semibold tracking-tight">New split</h1>
        <p className="text-muted">
          Paste a YouTube link to a movie album, a singer collection or a playlist, or open an audio or video file from
          your computer.
        </p>
      </header>

      <section
        className={`panel overflow-hidden transition-shadow ${dragging ? 'ring-2 ring-accent border-accent' : ''}`}
        aria-label="Start a split"
      >
        {dragging && (
          <div className="flex items-center justify-center gap-2 h-11 bg-accent/10 text-accent text-[13px] font-medium" role="status">
            <FileAudio size={16} aria-hidden="true" /> Drop files to split them
          </div>
        )}
        <form onSubmit={onSubmit} className="flex gap-2 p-4">
          <label htmlFor="url" className="sr-only">YouTube link</label>
          <div className="relative flex-1">
            <Link2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
            <input
              id="url"
              className="field h-11 pl-9 text-[14px]"
              placeholder="https://www.youtube.com/watch?v=… (paste several to split them all)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <button type="submit" className="btn-primary h-11 px-5 text-[14px]" disabled={!ready || submitting || !url.trim()}>
            {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Scissors size={16} aria-hidden="true" />}
            {typedLinks.length > 1 ? `Split ${typedLinks.length} videos` : 'Split songs'}
          </button>
          <button
            type="button"
            className="btn-secondary h-11 px-4 text-[14px]"
            onClick={openFiles}
            disabled={!ready || submitting}
            title="Split audio or video files from this computer. You can also drop them here."
          >
            <FileAudio size={16} aria-hidden="true" /> Open a file…
          </button>
        </form>
        {clipboardLinks.length > 0 && (
          <div className="px-4 pb-3 -mt-1">
            <button
              type="button"
              onClick={() => startLinks(clipboardLinks)}
              disabled={!ready || submitting}
              className="flex items-center gap-2 h-7 pl-2.5 pr-3 rounded-full border border-line bg-raised text-xs text-muted hover:text-ink hover:border-line-strong transition-colors max-w-full animate-fade-in"
            >
              <ClipboardPaste size={13} aria-hidden="true" />
              {clipboardLinks.length === 1 ? (
                <>
                  <span className="shrink-0">Split the link you copied:</span>
                  <span className="truncate font-mono text-ink">{clipboardLinks[0]}</span>
                </>
              ) : (
                <span className="shrink-0">Split the {clipboardLinks.length} links you copied</span>
              )}
            </button>
          </div>
        )}
        <SaveToRow />
      </section>

      {jobs.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="jobs-heading">
          <div className="flex items-center justify-between min-h-8">
            <h2 id="jobs-heading" className="eyebrow">
              Recent splits <span className="text-faint tnum font-normal ml-1">{jobs.length}</span>
            </h2>
            {readyJobs.length > 1 && (
              <button
                className="btn-secondary"
                onClick={saveAllReady}
                disabled={savingAll}
                title={
                  toCheck.length
                    ? `Saves splits whose cuts all look right. ${toCheck.length} with cuts to check will wait for you.`
                    : 'Saves every split that is ready, with the songs as found'
                }
              >
                {savingAll ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
                Save all {readyJobs.length} ready
              </button>
            )}
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
