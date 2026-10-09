import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { clsx } from 'clsx'
import { ListVideo, Loader2, X } from 'lucide-react'
import { formatDuration } from '../lib/time'
import {
  defaultMode,
  defaultSelection,
  hasVideo,
  LONG_VIDEO_S,
  MIX_LIMIT,
  type ListedLink,
  type ListedVideo,
  type PlaylistMode,
} from '../lib/playlists'

/** What to start for a playlist or channel link. */
export type PlaylistChoice =
  | { mode: 'each'; urls: string[] }
  | { mode: 'album' | 'single'; url: string }

/**
 * Choose how to split a playlist or channel: each video on its own (jukeboxes, full albums),
 * all videos as one album (one song per video), or just the video the link points at.
 * Videos split before are marked and not ticked.
 */
export default function PlaylistDialog({
  link,
  onClose,
  onList,
  onStart,
}: {
  /** The playlist or channel link, or null when closed. */
  link: string | null
  onClose: () => void
  onList: (url: string) => Promise<ListedLink>
  onStart: (choice: PlaylistChoice) => Promise<void>
}) {
  const [listed, setListed] = useState<ListedLink | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<PlaylistMode>('each')
  const [longOnly, setLongOnly] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!link) return
    let cancelled = false
    setListed(null)
    setError('')
    onList(link)
      .then((result) => {
        if (cancelled) return
        const long = result.kind === 'channel'
        setListed(result)
        setMode(defaultMode(result))
        setLongOnly(long)
        // A channel can have hundreds of long videos: let the user pick rather than tick them all.
        setSelected(result.kind === 'channel' ? new Set() : defaultSelection(result.entries, long))
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [link, onList])

  const shown = useMemo(
    () => (listed?.entries ?? []).filter((e) => !longOnly || e.duration >= LONG_VIDEO_S || e.duration === 0),
    [listed, longOnly],
  )
  const chosen = shown.filter((e) => selected.has(e.id))
  const totalSeconds = chosen.reduce((sum, e) => sum + e.duration, 0)
  // YouTube's best audio is about 130-160 kbps: roughly 1.2 MB a minute.
  const downloadGb = (totalSeconds / 60) * 1.2 / 1024
  const pointsAtVideo = link ? hasVideo(link) : false
  const isChannel = listed?.kind === 'channel'
  const kindName = isChannel ? 'Channel' : listed?.kind === 'mix' ? 'YouTube Mix' : 'Playlist'

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const setLong = (value: boolean) => {
    setLongOnly(value)
    if (!listed) return
    if (isChannel) setSelected((prev) => new Set([...prev].filter((id) => listed.entries.some((e) => e.id === id && (!value || e.duration >= LONG_VIDEO_S)))))
    else setSelected(defaultSelection(listed.entries, value))
  }

  const start = async () => {
    if (!link) return
    setStarting(true)
    setError('')
    try {
      await onStart(mode === 'each' ? { mode, urls: chosen.map((e) => e.url) } : { mode, url: link })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const startLabel =
    mode === 'each'
      ? `Split ${chosen.length} video${chosen.length === 1 ? '' : 's'}`
      : mode === 'album'
        ? `Make one album of ${listed?.entries.length ?? 0} songs`
        : 'Split this video'

  return (
    <Dialog.Root open={Boolean(link)} onOpenChange={(open) => !open && !starting && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="panel fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(680px,calc(100vw-32px))] max-h-[calc(100vh-48px)] p-5 flex flex-col gap-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <ListVideo size={18} className="mt-0.5 text-muted shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <Dialog.Title className="font-display text-base font-semibold truncate">
                {listed ? listed.title || kindName : 'Reading the list…'}
              </Dialog.Title>
              <Dialog.Description className="text-[13px] text-muted mt-1">
                {listed
                  ? `${kindName} · ${listed.entries.length} video${listed.entries.length === 1 ? '' : 's'}${
                      isChannel && listed.entries.length >= 500
                        ? ' (the newest 500)'
                        : listed.kind === 'mix' && listed.entries.length >= MIX_LIMIT
                          ? ` (a Mix never ends: the first ${MIX_LIMIT})`
                          : ''
                    }`
                  : 'Listing the videos. Nothing is downloaded yet.'}
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-icon" aria-label="Close" disabled={starting}>
              <X size={16} />
            </Dialog.Close>
          </div>

          {!listed && !error && (
            <div className="flex items-center gap-2 text-[13px] text-muted py-6 justify-center">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Reading the list…
            </div>
          )}

          {listed && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="How to split">
                <ModeButton
                  active={mode === 'each'}
                  onClick={() => setMode('each')}
                  label="Split each video"
                  hint="Jukeboxes and full albums: each video becomes its own split"
                />
                {!isChannel && (
                  <ModeButton
                    active={mode === 'album'}
                    onClick={() => setMode('album')}
                    label="One album"
                    hint="Each video is one song: save them together as one album"
                  />
                )}
                {pointsAtVideo && (
                  <ModeButton
                    active={mode === 'single'}
                    onClick={() => setMode('single')}
                    label="Just this video"
                    hint="Only the video the link points at"
                  />
                )}
              </div>

              {mode === 'each' && (
                <>
                  <div className="flex items-center gap-3 text-[13px]">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={longOnly} onChange={(e) => setLong(e.target.checked)} />
                      Only videos of 20 minutes or more (jukeboxes and albums)
                    </label>
                    <div className="flex-1" />
                    <button className="text-accent hover:underline" onClick={() => setSelected(new Set(shown.filter((e) => e.state !== 'in_list').map((e) => e.id)))}>
                      All
                    </button>
                    <button className="text-accent hover:underline" onClick={() => setSelected(new Set())}>
                      None
                    </button>
                  </div>
                  <ul className="flex flex-col overflow-y-auto min-h-0 border border-line rounded-md divide-y divide-line" aria-label="Videos">
                    {shown.length === 0 && <li className="px-3 py-4 text-[13px] text-muted">No videos match.</li>}
                    {shown.map((e) => (
                      <VideoRow key={e.id} video={e} checked={selected.has(e.id)} onToggle={() => toggle(e.id)} />
                    ))}
                  </ul>
                  <p className="text-xs text-faint">
                    Videos are downloaded and split in the background, a few at a time (Settings → Saving songs → Splits at a
                    time). Each one waits for you to review it; <span className="text-muted">Save all ready</span> saves the
                    ones whose cuts all look right.
                  </p>
                </>
              )}
            </>
          )}

          {error && (
            <p className="text-[13px] text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <p className="flex-1 text-xs text-muted tnum">
              {mode === 'each' && chosen.length > 0 && totalSeconds > 0 &&
                `${formatDuration(totalSeconds)} of audio · about ${downloadGb >= 1 ? `${downloadGb.toFixed(1)} GB` : `${Math.max(1, Math.round(downloadGb * 1024))} MB`} to download`}
            </p>
            <button className="btn-ghost" onClick={onClose} disabled={starting}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={start}
              disabled={!listed || starting || (mode === 'each' && chosen.length === 0)}
            >
              {starting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {startLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ModeButton({ active, onClick, label, hint }: { active: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={clsx(
        'text-left rounded-md border px-3 py-2 transition-colors',
        active ? 'border-accent bg-accent/10' : 'border-line hover:border-faint',
      )}
    >
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-xs text-muted">{hint}</span>
    </button>
  )
}

function VideoRow({ video, checked, onToggle }: { video: ListedVideo; checked: boolean; onToggle: () => void }) {
  const inList = video.state === 'in_list'
  return (
    <li>
      <label className={clsx('flex items-center gap-3 px-3 py-1.5 text-[13px]', inList ? 'opacity-60' : 'hover:bg-raised cursor-pointer')}>
        <input type="checkbox" checked={checked && !inList} disabled={inList} onChange={onToggle} />
        <span className="flex-1 min-w-0 truncate" title={video.title}>
          {video.title || video.id}
        </span>
        {video.state === 'saved' && <span className="text-xs text-accent shrink-0">Saved before</span>}
        {inList && <span className="text-xs text-muted shrink-0">In your list</span>}
        <span className="text-xs text-muted tnum shrink-0 w-20 text-right whitespace-nowrap">{video.duration ? formatDuration(video.duration) : ''}</span>
      </label>
    </li>
  )
}
