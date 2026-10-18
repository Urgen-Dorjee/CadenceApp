import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { clsx } from 'clsx'
import { Download, ListVideo, Loader2, Play, Video, X } from 'lucide-react'
import { api, type PlaylistDetails, type VideoDetails } from '../../services/api'
import type { VideoOptions } from '../../types/job'
import { formatDuration } from '../../lib/time'
import { formatSize, languageName, nearestQuality, optionsSummary } from '../../lib/video'
import { linkKind } from '../../lib/playlists'
import VideoOptionsPanel from './VideoOptionsPanel'

/** A quality's download size for the chosen file type. */
function sizeFor(q: VideoDetails['qualities'][number], container: VideoOptions['container']): number {
  return q.sizes?.[container] ?? q.size
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-flow-col auto-cols-fr gap-1 p-[3px] rounded-lg bg-sunken border border-line">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={clsx('h-8 rounded-md text-xs transition-colors', value === o.id ? 'bg-raised text-ink font-semibold shadow-[inset_0_0_0_1px_rgb(var(--accent))]' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function VideoChoices({ details, options, onChange }: { details: VideoDetails; options: VideoOptions; onChange: (o: VideoOptions) => void }) {
  const set = (patch: Partial<VideoOptions>) => onChange({ ...options, ...patch })
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <section aria-labelledby="quality-head" className="rounded-lg border border-line bg-surface overflow-hidden">
        <h3 id="quality-head" className="eyebrow px-4 pt-3 pb-2">Quality</h3>
        <div role="radiogroup" aria-labelledby="quality-head" className="flex flex-col">
          {details.qualities.map((q) => {
            const on = options.quality === q.id
            return (
              <button
                key={q.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ quality: q.id })}
                className={clsx('flex items-center gap-3 px-4 py-2.5 border-t border-line text-left transition-colors', on ? 'bg-accent/[0.08]' : 'hover:bg-raised/50')}
              >
                <span className={clsx('w-4 h-4 rounded-full shrink-0', on ? 'border-[5px] border-accent' : 'border-[1.5px] border-line-strong')} aria-hidden="true" />
                <span className="flex-1 flex flex-col">
                  <span className="font-medium">{q.label}</span>
                  {q.id === '1080' && <span className="text-xs text-muted">Recommended: sharp on any screen</span>}
                  {q.id === 'audio' && <span className="text-xs text-muted">For listening to a lecture or talk</span>}
                </span>
                <span className="font-mono text-xs text-muted">{sizeFor(q, options.container) ? `about ${formatSize(sizeFor(q, options.container))}` : ''}</span>
              </button>
            )
          })}
        </div>
        {options.quality !== 'audio' && (
          <div className="px-4 py-3 border-t border-line">
            <Segmented label="File type" value={options.container} onChange={(v) => set({ container: v })}
              options={[{ id: 'mp4', label: 'MP4: plays everywhere' }, { id: 'mkv', label: 'MKV' }]} />
          </div>
        )}
      </section>

      <div className="flex flex-col gap-4">
        {options.quality !== 'audio' && (
          <section aria-labelledby="subs-head" className="rounded-lg border border-line bg-surface p-4 flex flex-col gap-2.5">
            <h3 id="subs-head" className="eyebrow">Subtitles</h3>
            {details.subtitles.length === 0 && <p className="text-[13px] text-muted">This video has no subtitles.</p>}
            {details.subtitles.map((s) => (
              <label key={s.lang} className="flex items-center gap-2 text-[13px] cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-[rgb(var(--accent))] w-4 h-4"
                  checked={options.subtitles.includes(s.lang)}
                  onChange={(e) => set({
                    subtitles: e.target.checked ? [...options.subtitles, s.lang] : options.subtitles.filter((c) => c !== s.lang),
                    auto_subtitles: options.auto_subtitles || (e.target.checked && s.auto),
                  })}
                />
                {s.name || languageName(s.lang)}
                {s.auto && <span className="text-[11px] text-muted">automatic</span>}
              </label>
            ))}
            {details.subtitles.length > 0 && (
              <Segmented label="How subtitles are saved" value={options.subtitle_mode} onChange={(v) => set({ subtitle_mode: v })}
                options={[{ id: 'embed', label: 'Inside the video' }, { id: 'srt', label: '.srt files' }, { id: 'both', label: 'Both' }]} />
            )}
          </section>
        )}

        {details.chapters.length > 0 && (
          <section aria-labelledby="chapters-head" className="rounded-lg border border-line bg-surface p-4 flex flex-col gap-2">
            <label id="chapters-head" className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="accent-[rgb(var(--accent))] w-4 h-4" checked={options.chapters} onChange={(e) => set({ chapters: e.target.checked })} />
              <span className="eyebrow">Keep the {details.chapters.length} chapters</span>
            </label>
            <ol className="flex flex-col gap-1 max-h-36 overflow-y-auto">
              {details.chapters.map((c) => (
                <li key={`${c.start}-${c.title}`} className="flex gap-3 text-[13px]">
                  <span className="w-14 shrink-0 font-mono text-xs text-muted tnum">{formatDuration(c.start)}</span>
                  <span className="truncate">{c.title}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  )
}

/**
 * "Video ready": what a link holds before downloading it whole. A video shows each quality
 * with its file size, its subtitles and chapters; a playlist or course shows how many videos
 * it has and how many were saved before.
 */
export default function VideoReadyDialog({ link, initial, folder, onClose, onStart, savedPath, onPlay }: {
  link: string | null
  initial: VideoOptions
  folder: string
  onClose: () => void
  onStart: (link: string, options: VideoOptions) => Promise<void>
  /** A copy of this video downloaded before, which can be played instead. */
  savedPath?: string | null
  onPlay?: (path: string) => void
}) {
  const [details, setDetails] = useState<VideoDetails | PlaylistDetails | null>(null)
  const [error, setError] = useState('')
  const [options, setOptions] = useState(initial)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!link) return
    let live = true
    setDetails(null)
    setError('')
    setOptions(initial)
    api.videoDetails(link).then(
      (d) => {
        if (!live) return
        setDetails(d)
        if (d.kind === 'video') {
          const available = d.qualities.map((q) => q.id)
          const langs = new Set(d.subtitles.map((s) => s.lang))
          setOptions((o) => ({
            ...o,
            quality: o.quality === 'audio' ? 'audio' : nearestQuality(o.quality, available) ?? o.quality,
            subtitles: o.subtitles.filter((c) => langs.has(c)),
          }))
        }
      },
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per link
  }, [link])

  const start = async () => {
    if (!link) return
    setStarting(true)
    try {
      await onStart(link, options)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const chosen = details?.kind === 'video' ? details.qualities.find((q) => q.id === options.quality) : undefined
  const toDownload = details?.kind === 'playlist' ? details.count - details.saved_count : 1

  return (
    <Dialog.Root open={Boolean(link)} onOpenChange={(open) => !open && !starting && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="panel fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(860px,calc(100vw-32px))] max-h-[calc(100vh-48px)] overflow-y-auto p-5 flex flex-col gap-5 shadow-2xl">
          <div className="flex items-start gap-3">
            <Dialog.Title className="flex-1 font-display text-lg font-semibold">
              {(details ? details.kind === 'playlist' : linkKind(link ?? '') !== 'video') ? 'Download this playlist' : 'Download this video'}
            </Dialog.Title>
            <Dialog.Close className="btn-icon" aria-label="Close" disabled={starting}><X size={16} /></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Choose the quality, subtitles and extras, then download.</Dialog.Description>

          {!details && !error && (
            <div className="flex items-center gap-2 text-muted py-10 justify-center" role="status">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Reading the video's details…
            </div>
          )}
          {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}

          {details?.kind === 'video' && (
            <>
              <div className="flex flex-wrap gap-5 items-start">
                <div className="relative w-64 aspect-video rounded-lg overflow-hidden bg-raised border border-line shrink-0">
                  {details.thumbnail ? (
                    <img src={details.thumbnail} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  ) : (
                    <Video size={32} className="absolute inset-0 m-auto text-faint" aria-hidden="true" />
                  )}
                  <span className="absolute right-2 bottom-2 h-5 px-1.5 rounded bg-black/75 text-[11px] font-semibold flex items-center tnum">
                    {formatDuration(details.duration)}
                  </span>
                </div>
                <div className="flex-1 min-w-[260px] flex flex-col gap-2">
                  <h3 className="font-display text-[17px] font-semibold leading-snug">{details.title}</h3>
                  <p className="text-muted">{details.channel}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {details.chapters.length > 0 && <span className="kbd">{details.chapters.length} chapters</span>}
                    {details.subtitles.length > 0 && <span className="kbd">Subtitles: {details.subtitles.length} languages</span>}
                    {details.saved && (
                      <span className="inline-flex items-center h-5 px-1.5 rounded border border-warn/40 bg-warn/10 text-[11px] text-warn">
                        Already in your library
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {savedPath && onPlay && (
                <div className="flex items-center gap-3 rounded-md border border-line bg-raised/60 px-3 py-2" role="status">
                  <p className="flex-1 text-[13px]">You downloaded this video before. Play it, or download it again in another quality.</p>
                  <button className="btn-secondary h-7 px-2.5" onClick={() => onPlay(savedPath)}>
                    <Play size={13} aria-hidden="true" /> Play
                  </button>
                </div>
              )}
              <VideoChoices details={details} options={options} onChange={setOptions} />
            </>
          )}

          {details?.kind === 'playlist' && (
            <>
              <div className="flex items-center gap-4 rounded-lg border border-line bg-surface p-4">
                <ListVideo size={28} className="text-accent shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{details.title}</h3>
                  <p className="text-xs text-muted">
                    {details.count} videos · {formatDuration(details.duration)} in all
                    {details.saved_count > 0 && ` · ${details.saved_count} already saved and skipped`}
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-line bg-surface">
                <VideoOptionsPanel value={options} onChange={setOptions} />
              </div>
              <p className="text-xs text-muted">
                The videos are saved in order, as numbered files in their own folder, with a short pause between them so YouTube
                doesn't block the downloads. A video that doesn't have the chosen quality gets the next lower one.
              </p>
            </>
          )}

          {details && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <p className="flex-1 min-w-[240px] text-xs text-muted">
                Saves to <span className="font-mono text-ink">{folder}</span> · {optionsSummary(options)}
              </p>
              <button className="btn-ghost" onClick={onClose} disabled={starting}>Cancel</button>
              <button className="btn-primary h-10 px-5" onClick={start} disabled={starting || toDownload <= 0}>
                {starting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                {details.kind === 'playlist'
                  ? toDownload > 0 ? `Download ${toDownload} video${toDownload === 1 ? '' : 's'}` : 'All saved already'
                  : `Download${chosen && sizeFor(chosen, options.container) ? ` (about ${formatSize(sizeFor(chosen, options.container))})` : ''}`}
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

