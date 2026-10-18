import { DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPaste, Loader2, Scissors, ListMusic, FolderTree, FolderOpen, Link2, FileAudio, Download, Music2, Video, Gauge, Captions, ListVideo } from 'lucide-react'
import { clsx } from 'clsx'
import toast from 'react-hot-toast'
import { api, type LinkHistory } from '../services/api'
import { useAppStore } from '../stores/appStore'
import { sortedJobs, useJobsStore } from '../stores/jobsStore'
import { usePrefsStore } from '../stores/prefsStore'
import JobCard from '../components/jobs/JobCard'
import VideoJobCard from '../components/video/VideoJobCard'
import VideoOptionsPanel from '../components/video/VideoOptionsPanel'
import VideoReadyDialog from '../components/video/VideoReadyDialog'
import PlaylistDialog, { type PlaylistChoice } from '../components/PlaylistDialog'
import SavedBeforeDialog from '../components/SavedBeforeDialog'
import { useVideoPlayer } from '../stores/videoPlayerStore'
import { newLinks, readyToSave, youtubeLinks } from '../lib/batch'
import { linkKind } from '../lib/playlists'
import { isVideoJob, videoDefaults, type Collection, type VideoOptions } from '../types/job'

const EMPTY_COLLECTION: Collection = { type: 'collection', name: '', artist: '', album: '', year: '' }

const STEPS = [
  { icon: ListMusic, title: 'Finds every song', text: 'Uses chapters, the description or comments, and listens for gaps when there are none.' },
  { icon: Scissors, title: 'Cuts cleanly', text: 'Each cut lands in the real gap between songs, and only where the songs differ.' },
  { icon: FolderTree, title: 'Files them for you', text: 'Singer collections go into Artists, movie albums into Albums, tagged with cover art.' },
]

const VIDEO_STEPS = [
  { icon: Gauge, title: 'Pick quality before downloading', text: 'Each quality is shown with its file size, so a 4K documentary never fills the disk by surprise.' },
  { icon: Captions, title: 'Subtitles and chapters come too', text: 'Captions in your languages, and chapters your player can jump between.' },
  { icon: ListVideo, title: 'Courses stay in order', text: 'A playlist saves as numbered files in its own folder, and skips videos already saved.' },
]

type Mode = 'music' | 'video'

/** The big Music | Video switch at the top of New download. */
function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const tab = (m: Mode, Icon: typeof Music2, title: string, text: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => onChange(m)}
      className={clsx(
        'flex items-center gap-3 px-4 py-3 rounded-md text-left transition-colors',
        mode === m ? 'bg-raised text-ink shadow-[inset_0_0_0_1px_rgb(var(--accent))]' : 'text-muted hover:text-ink',
      )}
    >
      <Icon size={20} className={mode === m ? 'text-accent' : undefined} aria-hidden="true" />
      <span className="flex flex-col">
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="text-xs opacity-80">{text}</span>
      </span>
    </button>
  )
  return (
    <div role="group" aria-label="What to download" className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-sunken border border-line">
      {tab('music', Music2, 'Music', 'Split into songs, tag and file them')}
      {tab('video', Video, 'Video', 'Save the whole video: lectures, documentaries, talks')}
    </div>
  )
}

function SaveToRow({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  const prefs = usePrefsStore((s) => s.prefs)
  const update = usePrefsStore((s) => s.update)
  if (!prefs) return null
  const video = mode === 'video'

  const change = async () => {
    const folder = await window.electronAPI?.selectFolder({
      defaultPath: video ? prefs.video_dir : prefs.library_dir, title: video ? 'Save videos to' : 'Save songs to',
    })
    if (!folder) return
    try {
      await update(video ? { video_dir: folder } : { library_dir: folder, save_mode: 'library' })
      toast.success(`${video ? 'Videos' : 'Songs'} will be saved there from now on`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (video) {
    return (
      <div className="flex items-center gap-3 px-4 h-11 border-t border-line text-xs">
        <FolderOpen size={14} className="text-muted shrink-0" aria-hidden="true" />
        <span className="text-muted shrink-0">Save to</span>
        <button
          className="flex-1 min-w-0 text-left font-mono text-[12px] truncate text-ink hover:text-accent"
          onClick={() => window.electronAPI?.openPath(prefs.video_dir)}
          title="Open this folder"
        >
          {prefs.video_dir}
        </button>
        <button className="btn-ghost h-7 px-2" onClick={change}>Change folder</button>
        <button className="btn-ghost h-7 px-2" onClick={() => navigate('/settings#video')}>Options</button>
      </div>
    )
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
  const navigate = useNavigate()
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
  const updatePrefs = usePrefsStore((s) => s.update)
  const mode: Mode = prefs?.download_mode ?? 'music'
  const video = mode === 'video'
  const [videoOptions, setVideoOptions] = useState<VideoOptions | null>(null)
  const [videoLink, setVideoLink] = useState<string | null>(null)
  const options = videoOptions ?? (prefs ? videoDefaults(prefs) : null)

  const setMode = (m: Mode) => {
    if (m !== mode) updatePrefs({ download_mode: m }).catch((e: Error) => toast.error(e.message))
  }

  const checkClipboard = useCallback(async () => {
    const text = (await window.electronAPI?.readClipboard().catch(() => ''))?.trim() ?? ''
    const kind = usePrefsStore.getState().prefs?.download_mode ?? 'music'
    setClipboardLinks(newLinks(youtubeLinks(text), Object.values(useJobsStore.getState().jobs), kind))
  }, [])

  useEffect(() => {
    checkClipboard()
  }, [mode, checkClipboard])

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
    const atOnce = usePrefsStore.getState().prefs?.parallel_splits ?? 2
    if (started > 1) toast.success(`Started ${started} splits. They're worked on ${atOnce === 1 ? 'one at a time' : `${atOnce} at a time`}.`)
    failures.forEach((f) => toast.error(f))
    return started
  }

  /** Download whole videos. One link opens "Video ready" (quality, subtitles) unless turned off in Settings. */
  const startVideos = async (links: string[]) => {
    if (!options || !links.length) return
    if (links.length === 1 && prefs?.video_ask !== false) {
      setVideoLink(links[0])
      setUrl('')
      setClipboardLinks([])
      return
    }
    setSubmitting(true)
    let started = 0
    for (const link of links) {
      try {
        useJobsStore.getState().upsert(await api.createVideoJob(link, options))
        started += 1
      } catch (e) {
        toast.error(links.length > 1 ? `${link}: ${(e as Error).message}` : (e as Error).message)
      }
    }
    setSubmitting(false)
    if (started) toast.success(started === 1 ? 'Downloading the video. Follow it in Downloads.' : `Downloading ${started} videos. Follow them in Downloads.`)
    setUrl('')
    setClipboardLinks([])
  }

  const [savedBefore, setSavedBefore] = useState<{ link: string; history: LinkHistory } | null>(null)
  const [savedVideo, setSavedVideo] = useState<string | null>(null)
  const openPlayer = useVideoPlayer((s) => s.open)

  /**
   * One video link seen before: carry on with it rather than start over. Returns true when
   * handled (opened its split or download, or asked what to do), false to download it as usual.
   */
  const carryOn = async (link: string): Promise<boolean> => {
    let history: LinkHistory
    try {
      history = await api.linkHistory(link)
    } catch {
      return false
    }
    const kind = video ? 'video' : 'music'
    const job = history.jobs.find((j) => j.kind === kind && j.status !== 'failed' && j.status !== 'cancelled')
    setSavedVideo(null)
    if (!video) {
      if (job) {
        setUrl('')
        if (job.status === 'review' || job.status === 'completed') {
          navigate(`/jobs/${job.id}`)
          toast(job.status === 'completed' && job.saved < job.songs
            ? `You split this video before: ${job.saved} of ${job.songs} songs are saved. Pick up where you left off.`
            : 'You split this video before. Here it is.')
        } else {
          navigate('/downloads')
          toast('That video is already being split. Follow it in Downloads.')
        }
        return true
      }
      if (history.songs.length) {
        setUrl('')
        setSavedBefore({ link, history })
        return true
      }
      return false
    }
    if (job && job.status !== 'completed') {
      setUrl('')
      navigate('/downloads')
      toast('That video is already downloading. Follow it in Downloads.')
      return true
    }
    const copy = history.videos[0]
    if (copy && prefs?.video_ask === false) {
      setUrl('')
      toast('You downloaded this video before. Playing it.')
      openPlayer(copy.path)
      return true
    }
    // "Video ready" offers to play the copy, or to download it again in another quality.
    setSavedVideo(copy?.path ?? null)
    return false
  }

  const startLinks = async (links: string[]) => {
    if (!links.length) {
      toast.error('Paste a YouTube video or playlist link.')
      return
    }
    if (links.length === 1 && linkKind(links[0]) === 'video') {
      if (await carryOn(links[0])) return
      if (video) return startVideos(links)
      await startAll([{ url: links[0] }])
      setUrl('')
      setClipboardLinks([])
      return
    }
    if (video) {
      const fresh = newLinks(links, Object.values(useJobsStore.getState().jobs), 'video')
      const skipped = links.length - fresh.length
      if (skipped) toast(`${skipped === 1 ? 'That link is' : `${skipped} links are`} already downloading or downloaded.`)
      return startVideos(fresh)
    }
    const fresh = newLinks(links, Object.values(useJobsStore.getState().jobs))
    const skipped = links.length - fresh.length
    if (skipped) toast(`${skipped === 1 ? 'One link is' : `${skipped} links are`} already in your list.`)
    // Playlists and channels open a dialog to choose how to split them, one after another.
    const lists = fresh.filter((u) => linkKind(u) !== 'video')
    await startAll(fresh.filter((u) => linkKind(u) === 'video').map((u) => ({ url: u })))
    if (lists.length) setPlaylistQueue((queue) => [...queue, ...lists])
    setUrl('')
    setClipboardLinks([])
  }

  const [playlistQueue, setPlaylistQueue] = useState<string[]>([])
  const listLink = useCallback((link: string) => api.expandLink(link), [])
  const startPlaylist = async (choice: PlaylistChoice) => {
    if (choice.mode === 'each') {
      if (!(await startAll(choice.urls.map((u) => ({ url: u }))))) throw new Error("None of these videos could be started.")
      return
    }
    let target = choice.url
    if (choice.mode === 'single') {
      const parsed = new URL(choice.url)
      const video = parsed.searchParams.get('v') ?? parsed.pathname.slice(1)
      target = `https://www.youtube.com/watch?v=${video}`
    }
    if (!(await startAll([{ url: target }]))) throw new Error("That couldn't be started.")
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
        <h1 className="font-display text-xl font-semibold tracking-tight">New download</h1>
        <p className="text-muted">
          {video
            ? 'Paste a link to any YouTube video, playlist or course. The whole video is saved, with subtitles and chapters.'
            : 'Paste a YouTube link to a movie album, a singer collection or a playlist, or open an audio or video file from your computer.'}
        </p>
      </header>

      <ModeSwitch mode={mode} onChange={setMode} />

      <section
        className={`panel overflow-hidden transition-shadow ${dragging ? 'ring-2 ring-accent border-accent' : ''}`}
        aria-label="Start a split"
      >
        {dragging && (
          <div className="flex items-center justify-center gap-2 h-11 bg-accent/10 text-accent text-[13px] font-medium" role="status">
            <FileAudio size={16} aria-hidden="true" /> Drop files to split them into songs
          </div>
        )}
        <form onSubmit={onSubmit} className="flex gap-2 p-4">
          <label htmlFor="url" className="sr-only">YouTube link</label>
          <div className="relative flex-1">
            <Link2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
            <input
              id="url"
              className="field h-11 pl-9 text-[14px]"
              placeholder={video ? 'https://www.youtube.com/watch?v=… (a video, playlist or course)' : 'https://www.youtube.com/watch?v=… (paste several to split them all)'}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <button type="submit" className="btn-primary h-11 px-5 text-[14px]" disabled={!ready || submitting || !url.trim()}>
            {submitting ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : video ? (
              <Download size={16} aria-hidden="true" />
            ) : (
              <Scissors size={16} aria-hidden="true" />
            )}
            {video
              ? typedLinks.length > 1 ? `Download ${typedLinks.length} videos` : 'Download video'
              : typedLinks.length > 1 ? `Split ${typedLinks.length} videos` : 'Split songs'}
          </button>
          {!video && (
            <button
              type="button"
              className="btn-secondary h-11 px-4 text-[14px]"
              onClick={openFiles}
              disabled={!ready || submitting}
              title="Split audio or video files from this computer. You can also drop them here."
            >
              <FileAudio size={16} aria-hidden="true" /> Open a file…
            </button>
          )}
        </form>
        {video && options && <VideoOptionsPanel value={options} onChange={setVideoOptions} />}
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
                  <span className="shrink-0">{video ? 'Download the link you copied:' : 'Split the link you copied:'}</span>
                  <span className="truncate font-mono text-ink">{clipboardLinks[0]}</span>
                </>
              ) : (
                <span className="shrink-0">{video ? 'Download' : 'Split'} the {clipboardLinks.length} links you copied</span>
              )}
            </button>
          </div>
        )}
        <SaveToRow mode={mode} />
      </section>

      {jobs.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="jobs-heading">
          <div className="flex items-center justify-between min-h-8">
            <h2 id="jobs-heading" className="eyebrow">
              Recent <span className="text-faint tnum font-normal ml-1">{jobs.length}</span>
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
            {jobs.slice(0, 20).map((job) => (isVideoJob(job) ? <VideoJobCard key={job.id} job={job} /> : <JobCard key={job.id} job={job} showKind />))}
          </div>
        </section>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3" aria-label="How it works">
          {(video ? VIDEO_STEPS : STEPS).map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex flex-col gap-2 p-4 rounded-lg border border-dashed border-line">
              <Icon size={18} className="text-accent" aria-hidden="true" />
              <h3 className="font-medium">{title}</h3>
              <p className="text-[13px] text-muted">{text}</p>
            </div>
          ))}
        </section>
      )}
      {options && prefs && (
        <VideoReadyDialog
          link={videoLink}
          initial={options}
          folder={prefs.video_dir}
          onClose={() => setVideoLink(null)}
          savedPath={savedVideo}
          onPlay={(path) => {
            setVideoLink(null)
            openPlayer(path)
          }}
          onStart={async (link, chosen) => {
            useJobsStore.getState().upsert(await api.createVideoJob(link, chosen))
            toast.success('Downloading. Follow it in Downloads.')
          }}
        />
      )}
      <SavedBeforeDialog
        history={savedBefore?.history ?? null}
        onClose={() => setSavedBefore(null)}
        onShow={(paths) => {
          setSavedBefore(null)
          navigate('/library', { state: { only: paths } })
        }}
        onSplitAgain={async () => {
          const link = savedBefore?.link
          setSavedBefore(null)
          if (link) await startAll([{ url: link }])
        }}
      />
      <PlaylistDialog
        link={playlistQueue[0] ?? null}
        onClose={() => setPlaylistQueue((queue) => queue.slice(1))}
        onList={listLink}
        onStart={startPlaylist}
      />
    </div>
  )
}
