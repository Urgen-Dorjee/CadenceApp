import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pause, Play, Scissors, Download, Loader2, X, FolderOpen, CheckCircle2, AlertTriangle, Fingerprint, Sparkles, ListMusic, Undo2, Redo2, Keyboard, Library } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, type LibraryMatch } from '../services/api'
import { useJobsStore } from '../stores/jobsStore'
import { usePrefsStore } from '../stores/prefsStore'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { formatTime, formatDuration } from '../lib/time'
import { canMergeWithNext, mergeWithNext, moveEnd, moveStart, needsCheck, needsName, splitAt, updateTrack } from '../lib/tracks'
import { folderOf, previewPath } from '../lib/paths'
import { cutForPlayingSong } from '../lib/closeup'
import { modKey } from '../lib/platform'
import { canRedo, canUndo, record, redo, startHistory, undo, type History } from '../lib/history'
import type { Collection, Track } from '../types/job'
import { Thumbnail } from '../components/jobs/JobCard'
import StatusPill from '../components/ui/StatusPill'
import ProgressBar from '../components/ui/ProgressBar'
import WaveformOverview from '../components/review/WaveformOverview'
import CutCloseUp from '../components/review/CutCloseUp'
import TrackRow from '../components/review/TrackRow'
import CollectionPanel from '../components/review/CollectionPanel'
import TracklistDialog from '../components/review/TracklistDialog'
import AlbumLookupDialog, { type AlbumChoice } from '../components/review/AlbumLookupDialog'
import { applyAlbumDetails } from '../lib/albumDetails'
import ShortcutsDialog from '../components/review/ShortcutsDialog'
import SaveAgainDialog from '../components/review/SaveAgainDialog'

const EMPTY_COLLECTION: Collection = { type: 'collection', name: '', artist: '', album: '', year: '' }

/** Everything the review screen lets you change; undo and redo step through it. */
interface Draft {
  tracks: Track[]
  collection: Collection
  /** Folder for this split only; empty means the library folder. */
  folder: string
}

const EMPTY_DRAFT: Draft = { tracks: [], collection: EMPTY_COLLECTION, folder: '' }
const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b)

export default function ReviewPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [identifying, setIdentifying] = useState(false)
  const [tidying, setTidying] = useState(false)
  const [tracklistOpen, setTracklistOpen] = useState(false)
  const [albumOpen, setAlbumOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [saveAgainOpen, setSaveAgainOpen] = useState(false)
  const job = useJobsStore((s) => s.jobs[id])
  const loaded = useJobsStore((s) => s.loaded)
  const player = useAudioPlayer(id)

  const [history, setHistory] = useState<History<Draft>>(() => startHistory(EMPTY_DRAFT))
  const { tracks, collection, folder } = history.present
  // What the backend has saved. "Save changes" shows while the draft differs from it,
  // so undoing back to the saved state hides it again.
  const [saved, setSaved] = useState<Draft>(EMPTY_DRAFT)
  const dirty = useMemo(() => !sameDraft(history.present, saved), [history.present, saved])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const prefs = usePrefsStore((s) => s.prefs)
  const [busy, setBusy] = useState(false)
  const syncedStatus = useRef<string | null>(null)

  /** Record a change. Changes with the same `key` in quick succession are one undo step. */
  const change = useCallback((fn: (d: Draft) => Draft, key?: string) => setHistory((h) => record(h, fn(h.present), key)), [])
  const setCollection = useCallback(
    (patch: Partial<Collection>) => change((d) => ({ ...d, collection: { ...d.collection, ...patch } }), `collection-${Object.keys(patch).join()}`),
    [change],
  )
  const setFolder = useCallback((value: string) => change((d) => ({ ...d, folder: value })), [change])

  // Load the job into the editable draft when it first arrives or finishes a stage.
  useEffect(() => {
    if (!job) return
    const editable = job.status === 'review' || job.status === 'completed'
    if (editable && syncedStatus.current !== job.status && !dirty) {
      const draft = { tracks: job.tracks, collection: { ...EMPTY_COLLECTION, ...job.collection }, folder: job.destination || '' }
      setHistory(startHistory(draft))
      setSaved(draft)
    }
    syncedStatus.current = job.status
  }, [job, dirty])

  const sources = job?.sources ?? []
  const singleSource = sources.length === 1 ? sources[0] : null
  const exporting = job?.status === 'exporting'
  const [peaks, setPeaks] = useState<number[] | null>(null)

  useEffect(() => {
    if (!singleSource) return
    let cancelled = false
    api.peaks(id, singleSource.id).then((d) => !cancelled && setPeaks(d.peaks)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, singleSource?.id])
  // Songs already in the library, checked again a moment after names, singers or times change.
  const [duplicates, setDuplicates] = useState<Record<string, LibraryMatch[]>>({})
  const dupeKey = JSON.stringify(tracks.map((t) => [t.id, t.title, t.artist, Math.round(t.end - t.start), t.include]))
  const reviewable = job?.status === 'review' || job?.status === 'completed'
  useEffect(() => {
    if (!reviewable || !tracks.length) return
    let cancelled = false
    const timer = setTimeout(() => {
      api.findDuplicates(id, { tracks, collection }).then((d) => !cancelled && setDuplicates(d)).catch(() => {})
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, dupeKey, reviewable])
  const duplicateIds = tracks.filter((t) => t.include && duplicates[t.id]).map((t) => t.id)
  const describeMatch = (matches: LibraryMatch[]) =>
    `Already in your library: ${matches.map((m) => [m.artist, m.title].filter(Boolean).join(' - ') + (m.album ? ` (${m.album})` : '')).join('; ')}`

  const included = tracks.filter((t) => t.include)
  const flagged = tracks.filter(needsCheck).length
  const showArtist = collection.type !== 'artist'

  const edit = useCallback(
    (fn: (t: Track[]) => Track[], key?: string) => change((d) => ({ ...d, tracks: fn(d.tracks) }), key),
    [change],
  )

  const onChange = useCallback(
    (trackId: string, patch: Partial<Track>) => edit((t) => updateTrack(t, trackId, patch), `track-${trackId}-${Object.keys(patch).join()}`),
    [edit],
  )
  const onStart = useCallback(
    (index: number, time: number) => edit((t) => moveStart(t, index, time), `start-${tracks[index]?.id}`),
    [edit, tracks],
  )
  const onEnd = useCallback(
    (index: number, time: number) => {
      const duration = sources.find((s) => s.id === tracks[index]?.source_id)?.duration ?? Infinity
      edit((t) => moveEnd(t, index, time, duration), `end-${tracks[index]?.id}`)
    },
    [edit, sources, tracks],
  )
  const onMerge = useCallback((index: number) => edit((t) => mergeWithNext(t, index)), [edit])

  const playingTrackId = useMemo(() => {
    if (!player.playing) return null
    return tracks.find((t) => t.source_id === player.sourceId && player.time >= t.start && player.time < t.end)?.id ?? null
  }, [player.playing, player.sourceId, player.time, tracks])

  const onPlay = useCallback(
    (track: Track) => {
      if (playingTrackId === track.id) player.toggle(track.source_id)
      else player.playRange(track.source_id, track.start, track.end)
    },
    [player, playingTrackId],
  )
  const onPreviewCut = useCallback((track: Track) => player.playRange(track.source_id, track.start - 4, track.start + 4), [player])

  // Cuts shared by two neighbouring songs, as indexes of the song that starts there.
  const cutIndexes = useMemo(
    () => tracks.map((_, i) => i).filter((i) => i > 0 && canMergeWithNext(tracks, i - 1)),
    [tracks],
  )
  const selectedIndex = tracks.findIndex((t) => t.id === selectedId)
  const selectedCut = cutIndexes.indexOf(selectedIndex)

  // The cut shown in the close-up. Paused, it's the one you selected (kept by song id
  // so it survives edits). Playing, it's the playing song's cut nearest the playhead,
  // and that one stays shown after playback stops.
  const playingIndex = tracks.findIndex((t) => t.id === playingTrackId)
  const followCut = player.playing ? cutForPlayingSong(tracks, playingIndex, cutIndexes, player.time) : null
  const [closeUpId, setCloseUpId] = useState<string | null>(null)
  useEffect(() => {
    if (!player.playing && selectedCut !== -1) setCloseUpId(tracks[selectedIndex].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])
  useEffect(() => {
    if (followCut !== null) setCloseUpId(tracks[followCut].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followCut])
  useEffect(() => {
    if (playingTrackId) setSelectedId(playingTrackId)
  }, [playingTrackId])
  const closeUpIndex = followCut ?? tracks.findIndex((t) => t.id === closeUpId)
  const closeUpCut = cutIndexes.indexOf(closeUpIndex)

  /** Go to another cut. While playing, jump to just before it so you hear and see the split. */
  const goToCut = (position: number) => {
    const index = cutIndexes[position]
    if (index === undefined) return
    const track = tracks[index]
    setCloseUpId(track.id)
    if (player.playing) player.playRange(track.source_id, Math.max(0, track.start - 3))
    else setSelectedId(track.id)
  }
  const nextToCheck = cutIndexes.findIndex((i, pos) => pos > closeUpCut && needsCheck(tracks[i]))

  const splitHere = () => {
    if (!player.sourceId) return
    const before = tracks.length
    const next = splitAt(tracks, player.sourceId, player.time)
    if (next.length === before) {
      toast('Move the playhead inside a song, at least a second from its edges.')
      return
    }
    edit(() => next)
  }

  const selectSong = (index: number) => {
    const track = tracks[Math.max(0, Math.min(tracks.length - 1, index))]
    if (!track) return
    setSelectedId(track.id)
    document.querySelector(`[data-track-id="${track.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  // Keyboard shortcuts (see ShortcutsDialog). The handler is replaced every render so it
  // always sees the current songs; the listener itself is added once.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  onKeyRef.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement
    const typing = Boolean(el.closest('input:not([type=checkbox]):not([type=range]), textarea, select, [contenteditable="true"]'))
    if (shortcutsOpen || tracklistOpen || albumOpen || saveAgainOpen || exporting || el.closest('[role="dialog"]')) return
    const key = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || key === 'y')) {
      if (typing) return // the field's own undo
      e.preventDefault()
      setHistory((h) => (key === 'y' || e.shiftKey ? redo(h) : undo(h)))
      return
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return
    const closeUpTrack = closeUpCut !== -1 ? tracks[closeUpIndex] : null
    const selected = selectedIndex !== -1 ? tracks[selectedIndex] : null
    const handled = (() => {
      switch (e.key) {
        case ' ':
          if (el.closest('button, [role="slider"]')) return false
          if (tracks[0]) player.toggle(tracks[0].source_id)
          return true
        case 'ArrowLeft':
        case 'ArrowRight':
          if (!closeUpTrack || el.closest('[role="slider"]')) return false
          onStart(closeUpIndex, closeUpTrack.start + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 0.1))
          return true
        case '[':
          goToCut(closeUpCut === -1 ? 0 : closeUpCut - 1)
          return true
        case ']':
          goToCut(closeUpCut === -1 ? 0 : closeUpCut + 1)
          return true
        case 'ArrowUp':
        case 'ArrowDown':
          selectSong(selectedIndex === -1 ? 0 : selectedIndex + (e.key === 'ArrowDown' ? 1 : -1))
          return true
        case 'Enter':
          if (!selected || el.closest('button, a')) return false
          onPlay(selected)
          return true
        case '?':
          setShortcutsOpen(true)
          return true
      }
      switch (key) {
        case 'h':
          if (!closeUpTrack) return false
          onPreviewCut(closeUpTrack)
          return true
        case 'x':
          if (!selected) return false
          onChange(selected.id, { include: !selected.include })
          return true
        case 's':
          splitHere()
          return true
        case 'j':
          if (!selected || !canMergeWithNext(tracks, selectedIndex)) return false
          onMerge(selectedIndex)
          return true
      }
      return false
    })()
    if (handled) e.preventDefault()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const askOnSave = prefs?.save_mode === 'ask' && !folder
  const destination = useMemo(() => {
    if (!prefs || !included.length) return null
    return folderOf(previewPath(included[0], 1, collection, { ...prefs, library_dir: folder || prefs.library_dir }))
  }, [prefs, included, collection, folder])
  const audioRemoved = sources.some((s) => !s.path)

  const chooseFolder = async () => {
    const picked = await window.electronAPI?.selectFolder({ defaultPath: folder || prefs?.library_dir, title: 'Save this split to' })
    if (picked) setFolder(picked)
  }

  const changeCover = async () => {
    const path = await window.electronAPI?.selectImage()
    if (!path) return
    try {
      useJobsStore.getState().upsert(await api.setCover(id, path))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const resetCover = () =>
    api.resetCover(id).then(useJobsStore.getState().upsert).catch((e: Error) => toast.error(e.message))

  const payload = (destinationOverride?: string) => ({ tracks, collection, destination: destinationOverride ?? folder })

  const unnamedCount = tracks.filter((t) => t.include && needsName(t)).length

  const identifySongs = async () => {
    if (!prefs?.acoustid_key) {
      toast('Add your free AcoustID key in Settings to identify songs.')
      navigate('/settings#names')
      return
    }
    setIdentifying(true)
    const before = history.present
    try {
      const result = await api.identifyJob(id, payload())
      if (!result.named) {
        toast("None of these songs were recognised. You can still name them yourself.")
        return
      }
      edit(() => result.tracks)
      toast.success(
        (t) => (
          <span className="flex items-center gap-3">
            Named {result.named} song{result.named === 1 ? '' : 's'}
            <button
              className="text-accent font-medium hover:underline"
              onClick={() => {
                change(() => before)
                toast.dismiss(t.id)
              }}
            >
              Undo
            </button>
          </span>
        ),
        { duration: 8000 },
      )
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setIdentifying(false)
    }
  }

  const tidyNames = async () => {
    if (!prefs?.anthropic_api_key) {
      toast('Add your Anthropic API key in Settings to tidy names with Claude.')
      navigate('/settings#claude')
      return
    }
    setTidying(true)
    const before = history.present
    try {
      const result = await api.tidyNames(id, payload())
      change((d) => ({ ...d, tracks: result.tracks, collection: { ...EMPTY_COLLECTION, ...result.collection } }))
      toast.success(
        (t) => (
          <span className="flex items-center gap-3">
            {result.changed ? `Tidied ${result.changed} name${result.changed === 1 ? '' : 's'}` : 'Names already look tidy'}
            <button
              className="text-accent font-medium hover:underline"
              onClick={() => {
                change(() => before)
                toast.dismiss(t.id)
              }}
            >
              Undo
            </button>
          </span>
        ),
        { duration: 8000 },
      )
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setTidying(false)
    }
  }

  /** Use an album from MusicBrainz: its name, singer and year, its song names if chosen, and its cover. */
  const applyAlbum = async ({ release, useSongNames, useCover }: AlbumChoice) => {
    const before = history.present
    const coverBefore = job?.cover ?? ''
    const details = await api.applyAlbum(id, release.id, useCover)
    useJobsStore.getState().upsert(details.job)
    const result = applyAlbumDetails(tracks, collection, details, useSongNames)
    change((d) => ({ ...d, tracks: result.tracks, collection: result.collection }))
    const parts = [
      'album details',
      result.named ? `${result.named} song name${result.named === 1 ? '' : 's'}` : '',
      details.cover ? 'cover' : '',
    ].filter(Boolean)
    toast.success(
      (t) => (
        <span className="flex items-center gap-3">
          Used {parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]} from “{details.album}”
          <button
            className="text-accent font-medium hover:underline"
            onClick={() => {
              change(() => before)
              toast.dismiss(t.id)
              if (details.cover) {
                // The cover isn't part of the draft: put the previous one back too.
                const restore = coverBefore ? api.setCover(id, coverBefore) : api.resetCover(id)
                restore.then(useJobsStore.getState().upsert).catch((e: Error) => toast.error(e.message))
              }
            }}
          >
            Undo
          </button>
        </span>
      ),
      { duration: 8000 },
    )
    if (useCover && !details.cover) toast("This album has no cover art on MusicBrainz, so the cover wasn't changed.")
  }

  /** Replace the songs with a pasted tracklist. Throws so the dialog can show what's wrong. */
  const importTracklist = async (text: string) => {
    const before = history.present
    const result = await api.importTracklist(id, text)
    if (player.playing && tracks[0]) player.toggle(tracks[0].source_id)
    change((d) => ({ ...d, tracks: result.tracks, collection: { ...d.collection, ...result.collection } }))
    setSelectedId(null)
    const count = result.tracks.length
    toast.success(
      (t) => (
        <span className="flex items-center gap-3">
          {count} song{count === 1 ? '' : 's'} from your tracklist{result.snapped ? ', cuts moved to the gaps' : ''}
          <button
            className="text-accent font-medium hover:underline"
            onClick={() => {
              change(() => before)
              toast.dismiss(t.id)
            }}
          >
            Undo
          </button>
        </span>
      ),
      { duration: 8000 },
    )
  }

  const save = async () => {
    setBusy(true)
    try {
      await api.saveReview(id, payload())
      setSaved(history.present)
      toast.success('Changes saved')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Save the songs. A split saved before asks first whether to replace those songs. */
  const onSaveClick = () => {
    if (job?.status === 'completed' && job.outputs.length) setSaveAgainOpen(true)
    else exportSongs(false)
  }

  const exportSongs = async (replacePrevious: boolean) => {
    let target = folder
    if (prefs?.save_mode === 'ask' && !target) {
      const picked = await window.electronAPI?.selectFolder({ defaultPath: prefs.library_dir, title: 'Save these songs to' })
      if (!picked) return
      target = picked
      setFolder(picked)
    }
    setBusy(true)
    try {
      // The download is deleted after saving when it isn't kept, and a file that is playing can't be deleted.
      if (player.playing && prefs?.keep_downloads === false) {
        player.toggle(tracks[0].source_id)
        toast('Playback stopped: the download is removed after saving. Turn on Keep downloads in Settings to keep listening.')
      }
      await api.exportJob(id, { ...payload(target), replace_previous: replacePrevious })
      setSaved({ ...history.present, folder: target })
      syncedStatus.current = 'exporting'
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!job) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted">
        {loaded ? <p>This job no longer exists.</p> : <Loader2 className="animate-spin" aria-label="Loading" />}
        <Link to="/" className="btn-secondary">Back to New split</Link>
      </div>
    )
  }

  if (job.status !== 'review' && job.status !== 'completed' && job.status !== 'exporting') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted px-8 text-center">
        <StatusPill status={job.status} />
        <p>{job.error || job.message || 'Still working on this one.'}</p>
        <Link to="/" className="btn-secondary">Back to New split</Link>
      </div>
    )
  }

  const totalDuration = sources.reduce((sum, s) => sum + (s.duration || 0), 0)

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-canvas/95 backdrop-blur border-b border-line px-8 py-4 flex items-center gap-4">
        <Link to="/" className="btn-icon" aria-label="Back to New split">
          <ArrowLeft size={18} />
        </Link>
        <Thumbnail job={job} className="w-20 h-12 rounded shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-lg font-semibold truncate" title={job.title}>{job.title}</h1>
          <p className="text-xs text-muted flex items-center gap-2">
            <span className="tnum">{tracks.length} songs · {formatDuration(totalDuration)}</span>
            {flagged > 0 && !exporting && (
              <span className="inline-flex items-center gap-1 text-warn">
                <AlertTriangle size={12} aria-hidden="true" /> {flagged} to check
              </span>
            )}
          </p>
        </div>
        {exporting ? (
          <div className="flex items-center gap-3 w-80">
            <div className="flex-1 flex flex-col gap-1 min-w-0">
              <ProgressBar value={job.progress} label="Saving songs" />
              <p className="text-xs text-muted truncate">{job.message}</p>
            </div>
            <button className="btn-icon" aria-label="Cancel saving" onClick={() => api.cancelJob(id).catch(() => {})}>
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button className="btn-icon" onClick={() => setHistory(undo)} disabled={!canUndo(history)} aria-label="Undo" title={`Undo (${modKey()}+Z)`}>
              <Undo2 size={16} />
            </button>
            <button className="btn-icon" onClick={() => setHistory(redo)} disabled={!canRedo(history)} aria-label="Redo" title={`Redo (${modKey()}+Shift+Z)`}>
              <Redo2 size={16} />
            </button>
            {dirty && (
              <button className="btn-ghost" onClick={save} disabled={busy}>
                Save changes
              </button>
            )}
            <button
              className="btn-primary"
              onClick={onSaveClick}
              disabled={busy || included.length === 0 || audioRemoved}
              title={audioRemoved ? 'The downloaded audio was removed after saving' : undefined}
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
              {job.status === 'completed' ? 'Save again' : `Save ${included.length} song${included.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </header>

      <div className="px-8 py-6 flex flex-col gap-5 max-w-6xl w-full mx-auto">
        {job.status === 'completed' && !dirty && (
          <div className="panel px-4 py-3 flex items-center gap-3 border-ok/40 bg-ok/5" role="status">
            <CheckCircle2 size={18} className="text-ok shrink-0" aria-hidden="true" />
            <p className="flex-1 text-sm">{job.message}</p>
            {job.outputs[0] && (
              <button className="btn-secondary" onClick={() => window.electronAPI?.showItemInFolder(job.outputs[0].path)}>
                <FolderOpen size={14} aria-hidden="true" /> Show in folder
              </button>
            )}
          </div>
        )}
        {audioRemoved && (
          <div className="panel px-4 py-3 flex items-center gap-3" role="status">
            <AlertTriangle size={16} className="text-muted shrink-0" aria-hidden="true" />
            <p className="text-[13px] text-muted">
              The downloaded audio was removed after saving to free up space, so this split can't be saved again or played here.
              To keep it next time, turn on "Keep downloaded audio" in Settings.
            </p>
          </div>
        )}
        {job.error && !exporting && (
          <div className="panel px-4 py-3 flex items-center gap-3 border-danger/40 bg-danger/5" role="alert">
            <AlertTriangle size={18} className="text-danger shrink-0" aria-hidden="true" />
            <p className="text-sm">{job.error}</p>
          </div>
        )}

        <CollectionPanel
          collection={collection}
          onChange={setCollection}
          destination={destination}
          customFolder={Boolean(folder)}
          askOnSave={askOnSave}
          onChooseFolder={chooseFolder}
          onResetFolder={() => setFolder('')}
          coverUrl={job.thumbnail ? api.thumbnailUrl(job.id, job.updated_at) : null}
          coverSource={!job.cover ? 'video' : /cover-musicbrainz-[0-9a-f-]+\.jpg$/.test(job.cover) ? 'musicbrainz' : 'custom'}
          onFindAlbum={() => setAlbumOpen(true)}
          squareCover={prefs?.square_cover ?? true}
          onChangeCover={changeCover}
          onResetCover={resetCover}
          disabled={exporting}
        />

        {/* Player + overview */}
        <section className="panel p-4 flex flex-col gap-3" aria-label="Songs">
          <div className="flex items-center gap-3">
            <button
              className="w-9 h-9 rounded-full bg-accent text-accent-ink flex items-center justify-center hover:bg-accent/90 transition-colors"
              onClick={() => tracks[0] && player.toggle(tracks[0].source_id)}
              aria-label={player.playing ? 'Pause' : 'Play'}
            >
              {player.playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
            </button>
            <span className="font-mono text-sm tnum text-muted w-24">{formatTime(player.time)}</span>
            <div className="flex-1" />
            {singleSource && (
              <button
                className="btn-secondary h-8"
                onClick={() => setTracklistOpen(true)}
                disabled={exporting}
                title="Paste a tracklist or open a .cue file"
              >
                <ListMusic size={14} aria-hidden="true" /> Tracklist
              </button>
            )}
            <button
              className="btn-secondary h-8"
              onClick={tidyNames}
              disabled={tidying || exporting}
              title="Clean up song and album names with Claude (sends text only, never audio)"
            >
              {tidying ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
              {tidying ? 'Tidying…' : 'Tidy names'}
            </button>
            {unnamedCount > 0 && (
              <button
                className="btn-secondary h-8"
                onClick={identifySongs}
                disabled={identifying || exporting || audioRemoved}
                title="Look up songs named “Track …” by their sound on AcoustID"
              >
                {identifying ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Fingerprint size={14} aria-hidden="true" />}
                {identifying ? 'Identifying…' : `Identify ${unnamedCount} song${unnamedCount === 1 ? '' : 's'}`}
              </button>
            )}
            <button
              className="btn-secondary h-8"
              onClick={splitHere}
              disabled={!player.sourceId || exporting}
              title="Split the song under the playhead into two"
            >
              <Scissors size={14} aria-hidden="true" /> Split at playhead
            </button>
          </div>

          {singleSource && (
            <WaveformOverview
              tracks={tracks}
              duration={singleSource.duration}
              peaks={peaks}
              playhead={player.sourceId === singleSource.id ? player.time : null}
              selectedId={selectedId}
              disabled={exporting}
              onSeek={(t) => player.seek(singleSource.id, t)}
              onSelect={setSelectedId}
              onMoveCut={onStart}
            />
          )}

          {singleSource && closeUpCut !== -1 && (
            <CutCloseUp
              jobId={id}
              tracks={tracks}
              index={closeUpIndex}
              cutNumber={closeUpCut + 1}
              cutCount={cutIndexes.length}
              playhead={player.sourceId === singleSource.id ? player.time : null}
              playing={player.playing && player.sourceId === singleSource.id}
              disabled={exporting}
              onMoveCut={onStart}
              onHearCut={onPreviewCut}
              onSeek={(t) => player.playRange(singleSource.id, t)}
              onPrevCut={() => goToCut(closeUpCut - 1)}
              onNextCut={() => goToCut(closeUpCut + 1)}
              onNextToCheck={nextToCheck !== -1 ? () => goToCut(nextToCheck) : null}
            />
          )}
          {singleSource && closeUpCut === -1 && cutIndexes.length > 0 && (
            <p className="text-xs text-muted">
              Select a song, or click a cut marker, to fine-tune where it starts.
              {flagged > 0 && (
                <button className="ml-2 text-warn hover:underline" onClick={() => goToCut(cutIndexes.findIndex((i) => needsCheck(tracks[i])))}>
                  Check the first flagged cut
                </button>
              )}
            </p>
          )}

          {duplicateIds.length > 0 && !exporting && (
            <div className="flex items-center gap-3 rounded-md border border-warn/40 bg-warn/5 px-3 py-2" role="status">
              <Library size={15} className="text-warn shrink-0" aria-hidden="true" />
              <p className="flex-1 text-[13px]">
                {duplicateIds.length === 1 ? '1 song is' : `${duplicateIds.length} songs are`} already in your library.
              </p>
              <button
                className="btn-secondary h-7 px-2.5"
                onClick={() => edit((t) => t.map((x) => (duplicateIds.includes(x.id) ? { ...x, include: false } : x)))}
              >
                Skip {duplicateIds.length === 1 ? 'it' : 'them'}
              </button>
            </div>
          )}
          <div className="overflow-x-auto -mx-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-faint border-b border-line">
                  <th className="pl-4 pr-1 py-2 font-medium">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-[rgb(var(--accent))]"
                      checked={included.length === tracks.length && tracks.length > 0}
                      ref={(el) => {
                        if (el) el.indeterminate = included.length > 0 && included.length < tracks.length
                      }}
                      onChange={(e) => edit((t) => t.map((x) => ({ ...x, include: e.target.checked })))}
                      aria-label="Include all songs"
                    />
                  </th>
                  <th className="py-2 font-medium text-right pr-1">#</th>
                  <th className="py-2"><span className="sr-only">Play</span></th>
                  <th className="py-2 px-2 font-medium">Title</th>
                  {showArtist && <th className="py-2 px-2 font-medium">Singer</th>}
                  <th className="py-2 px-2 font-medium text-right">Start</th>
                  <th className="py-2 px-2 font-medium text-right">End</th>
                  <th className="py-2 pr-3 font-medium text-right">Length</th>
                  <th className="py-2 font-medium">Cut</th>
                  <th className="py-2 pr-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((track, index) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    index={index}
                    isPlaying={playingTrackId === track.id}
                    isSelected={selectedId === track.id}
                    canMerge={canMergeWithNext(tracks, index)}
                    hasCutBefore={index > 0 && canMergeWithNext(tracks, index - 1)}
                    showArtist={showArtist}
                    inLibrary={track.include && duplicates[track.id] ? describeMatch(duplicates[track.id]) : undefined}
                    onChange={onChange}
                    onStart={onStart}
                    onEnd={onEnd}
                    onPlay={onPlay}
                    onPreviewCut={onPreviewCut}
                    onMerge={onMerge}
                    onSelect={setSelectedId}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <TracklistDialog open={tracklistOpen} onOpenChange={setTracklistOpen} onImport={importTracklist} />
          <AlbumLookupDialog
            open={albumOpen}
            onOpenChange={setAlbumOpen}
            initialAlbum={collection.album || collection.name || job.title || ''}
            initialArtist={collection.artist}
            includedCount={tracks.filter((t) => t.include).length}
            onSearch={async (album, artist) => (await api.searchAlbums(id, album, artist)).releases}
            onApply={applyAlbum}
          />
          <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
          <SaveAgainDialog open={saveAgainOpen} onOpenChange={setSaveAgainOpen} savedCount={job.outputs.length} onChoose={exportSongs} />
          <p className="text-xs text-faint flex items-center gap-2 flex-wrap">
            <span>
              Space plays or pauses, ←/→ move the cut, {modKey()}+Z undoes. In a time field, ↑/↓ nudges by 0.1 s (hold Shift for 1 s).
              Songs that share a cut move together.
            </span>
            <button className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => setShortcutsOpen(true)}>
              <Keyboard size={13} aria-hidden="true" /> All shortcuts <kbd className="kbd">?</kbd>
            </button>
          </p>
        </section>
      </div>
    </div>
  )
}
