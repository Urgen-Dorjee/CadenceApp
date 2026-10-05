import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pause, Play, Scissors, Download, Loader2, X, FolderOpen, CheckCircle2, AlertTriangle, Fingerprint, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../services/api'
import { useJobsStore } from '../stores/jobsStore'
import { usePrefsStore } from '../stores/prefsStore'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { formatTime, formatDuration } from '../lib/time'
import { canMergeWithNext, mergeWithNext, moveEnd, moveStart, needsCheck, needsName, splitAt, updateTrack } from '../lib/tracks'
import { folderOf, previewPath } from '../lib/paths'
import type { Collection, Track } from '../types/job'
import { Thumbnail } from '../components/jobs/JobCard'
import StatusPill from '../components/ui/StatusPill'
import ProgressBar from '../components/ui/ProgressBar'
import WaveformOverview from '../components/review/WaveformOverview'
import CutCloseUp from '../components/review/CutCloseUp'
import TrackRow from '../components/review/TrackRow'
import CollectionPanel from '../components/review/CollectionPanel'

const EMPTY_COLLECTION: Collection = { type: 'collection', name: '', artist: '', album: '', year: '' }

export default function ReviewPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [identifying, setIdentifying] = useState(false)
  const [tidying, setTidying] = useState(false)
  const job = useJobsStore((s) => s.jobs[id])
  const loaded = useJobsStore((s) => s.loaded)
  const player = useAudioPlayer(id)

  const [tracks, setTracks] = useState<Track[]>([])
  const [collection, setCollection] = useState<Collection>(EMPTY_COLLECTION)
  const [dirty, setDirty] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const prefs = usePrefsStore((s) => s.prefs)
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const syncedStatus = useRef<string | null>(null)

  // Load the job into the editable draft when it first arrives or finishes a stage.
  useEffect(() => {
    if (!job) return
    const editable = job.status === 'review' || job.status === 'completed'
    if (editable && syncedStatus.current !== job.status && !dirty) {
      setTracks(job.tracks)
      setCollection({ ...EMPTY_COLLECTION, ...job.collection })
      setFolder(job.destination || '')
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
  const included = tracks.filter((t) => t.include)
  const flagged = tracks.filter(needsCheck).length
  const showArtist = collection.type !== 'artist'

  const edit = useCallback((fn: (t: Track[]) => Track[]) => {
    setTracks((prev) => fn(prev))
    setDirty(true)
  }, [])

  const onChange = useCallback((trackId: string, patch: Partial<Track>) => edit((t) => updateTrack(t, trackId, patch)), [edit])
  const onStart = useCallback((index: number, time: number) => edit((t) => moveStart(t, index, time)), [edit])
  const onEnd = useCallback(
    (index: number, time: number) => {
      const duration = sources.find((s) => s.id === tracks[index]?.source_id)?.duration ?? Infinity
      edit((t) => moveEnd(t, index, time, duration))
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
  const selectCut = (position: number) => {
    const index = cutIndexes[position]
    if (index !== undefined) setSelectedId(tracks[index].id)
  }
  const nextToCheck = cutIndexes.findIndex((i, pos) => pos > selectedCut && needsCheck(tracks[i]))

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

  // Space plays or pauses when you're not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.code !== 'Space' || el.closest('input, textarea, button, select, [role="slider"]')) return
      e.preventDefault()
      const fallback = tracks[0]?.source_id
      if (fallback) player.toggle(fallback)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player, tracks])

  const askOnSave = prefs?.save_mode === 'ask' && !folder
  const destination = useMemo(() => {
    if (!prefs || !included.length) return null
    return folderOf(previewPath(included[0], 1, collection, { ...prefs, library_dir: folder || prefs.library_dir }))
  }, [prefs, included, collection, folder])
  const audioRemoved = sources.some((s) => !s.path)

  const chooseFolder = async () => {
    const picked = await window.electronAPI?.selectFolder({ defaultPath: folder || prefs?.library_dir, title: 'Save this split to' })
    if (picked) {
      setFolder(picked)
      setDirty(true)
    }
  }

  const payload = (destinationOverride?: string) => ({ tracks, collection, destination: destinationOverride ?? folder })

  const unnamedCount = tracks.filter((t) => t.include && needsName(t)).length

  const identifySongs = async () => {
    if (!prefs?.acoustid_key) {
      toast('Add your free AcoustID key in Settings to identify songs.')
      navigate('/settings#names')
      return
    }
    setIdentifying(true)
    const before = tracks
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
                edit(() => before)
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
    const before = { tracks, collection }
    try {
      const result = await api.tidyNames(id, payload())
      setTracks(result.tracks)
      setCollection({ ...EMPTY_COLLECTION, ...result.collection })
      setDirty(true)
      toast.success(
        (t) => (
          <span className="flex items-center gap-3">
            {result.changed ? `Tidied ${result.changed} name${result.changed === 1 ? '' : 's'}` : 'Names already look tidy'}
            <button
              className="text-accent font-medium hover:underline"
              onClick={() => {
                setTracks(before.tracks)
                setCollection(before.collection)
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

  const save = async () => {
    setBusy(true)
    try {
      await api.saveReview(id, payload())
      setDirty(false)
      toast.success('Changes saved')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const exportSongs = async () => {
    let target = folder
    if (prefs?.save_mode === 'ask' && !target) {
      const picked = await window.electronAPI?.selectFolder({ defaultPath: prefs.library_dir, title: 'Save these songs to' })
      if (!picked) return
      target = picked
      setFolder(picked)
    }
    setBusy(true)
    try {
      player.playing && player.toggle(tracks[0].source_id)
      await api.exportJob(id, payload(target))
      setDirty(false)
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
            {dirty && (
              <button className="btn-ghost" onClick={save} disabled={busy}>
                Save changes
              </button>
            )}
            <button
              className="btn-primary"
              onClick={exportSongs}
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
          onChange={(patch) => {
            setCollection((c) => ({ ...c, ...patch }))
            setDirty(true)
          }}
          destination={destination}
          customFolder={Boolean(folder)}
          askOnSave={askOnSave}
          onChooseFolder={chooseFolder}
          onResetFolder={() => {
            setFolder('')
            setDirty(true)
          }}
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

          {singleSource && selectedCut !== -1 && (
            <CutCloseUp
              jobId={id}
              tracks={tracks}
              index={selectedIndex}
              cutNumber={selectedCut + 1}
              cutCount={cutIndexes.length}
              playhead={player.sourceId === singleSource.id ? player.time : null}
              disabled={exporting}
              onMoveCut={onStart}
              onHearCut={onPreviewCut}
              onPrevCut={() => selectCut(selectedCut - 1)}
              onNextCut={() => selectCut(selectedCut + 1)}
              onNextToCheck={nextToCheck !== -1 ? () => selectCut(nextToCheck) : null}
            />
          )}
          {singleSource && selectedCut === -1 && cutIndexes.length > 0 && (
            <p className="text-xs text-muted">
              Select a song, or click a cut marker, to fine-tune where it starts.
              {flagged > 0 && (
                <button className="ml-2 text-warn hover:underline" onClick={() => selectCut(cutIndexes.findIndex((i) => needsCheck(tracks[i])))}>
                  Check the first flagged cut
                </button>
              )}
            </p>
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
          <p className="text-xs text-faint">
            Space plays or pauses. In a time field, ↑/↓ nudges by 0.1 s (hold Shift for 1 s). Songs that share a cut move together.
          </p>
        </section>
      </div>
    </div>
  )
}
