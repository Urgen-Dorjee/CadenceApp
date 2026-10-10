import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  ChevronDown, Loader2, Pause, Play, Repeat, Repeat1, RotateCcw, RotateCw, Shuffle, SkipBack, SkipForward, Volume2,
} from 'lucide-react'
import { api } from '../../services/api'
import { usePlayerStore } from '../../stores/playerStore'
import { useLyrics } from '../../hooks/useLyrics'
import { activeLine } from '../../lib/lrc'
import { formatTime } from '../../lib/time'
import { SongCover } from '../layout/PlayerBar'
import { MoreMenu, SeekBar, SleepMenu, SpeedMenu } from './PlayerControls'

type Tab = 'lyrics' | 'next'

/** The full player: large cover, controls, synced lyrics and what plays next. */
export default function NowPlaying() {
  const expanded = usePlayerStore((s) => s.expanded)
  const song = usePlayerStore((s) => s.queue[s.index])
  const { playing, index, queue, repeat, shuffle, toggle, next, previous, skip, cycleRepeat, toggleShuffle, setExpanded } = usePlayerStore()
  const [tab, setTab] = useState<Tab>('lyrics')

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, setExpanded])

  if (!expanded || !song) return null
  const artist = song.artist || song.album_artist || 'Unknown singer'
  const details = [song.album, song.year].filter(Boolean).join(' · ')
  const repeatLabel = repeat === 'one' ? 'Repeat this song' : repeat === 'all' ? 'Repeat all' : 'Repeat off'

  return (
    <div className="absolute inset-0 z-20 overflow-hidden bg-canvas animate-fade-in" role="dialog" aria-label="Now playing">
      {/* The cover, blurred, as a soft background */}
      {song.has_cover ? (
        <img
          src={api.songCoverUrl(song.id)}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-35 saturate-150 pointer-events-none"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-canvas/40 via-canvas/75 to-canvas pointer-events-none" aria-hidden="true" />

      <div className="relative h-full flex flex-col">
        <div className="flex items-center gap-3 px-6 pt-4">
          <button className="btn-icon" onClick={() => setExpanded(false)} aria-label="Close Now playing" title="Close (Esc)">
            <ChevronDown size={20} />
          </button>
          <p className="eyebrow">Now playing</p>
          <div className="flex-1" />
          <div className="inline-flex p-0.5 rounded-lg bg-sunken/70 ring-1 ring-inset ring-line" role="tablist">
            {(['lyrics', 'next'] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={clsx(
                  'h-7 px-3 rounded-md text-[12.5px] font-medium transition-all',
                  tab === t ? 'bg-raised text-ink shadow-sm ring-1 ring-line-strong' : 'text-muted hover:text-ink',
                )}
              >
                {t === 'lyrics' ? 'Lyrics' : `Up next · ${Math.max(0, queue.length - index - 1)}`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] gap-10 px-10 pb-8 pt-6">
          {/* Cover and controls */}
          <div className="flex flex-col justify-center gap-5 min-w-0 max-w-[400px] mx-auto w-full">
            <SongCover
              id={song.id}
              hasCover={!!song.has_cover}
              className="w-full aspect-square rounded-xl shadow-[0_24px_60px_-20px_rgb(0_0_0/0.7)] ring-1 ring-white/10"
            />
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-semibold leading-tight truncate" title={song.title}>{song.title}</h2>
              <p className="text-[15px] text-ink/80 truncate mt-1">{artist}</p>
              {details && <p className="text-[13px] text-muted truncate">{details}</p>}
            </div>
            <SeekBar />
            <div className="flex items-center justify-between">
              <button className={clsx('btn-icon', shuffle && 'text-accent')} onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={shuffle}>
                <Shuffle size={17} />
              </button>
              <button className="btn-icon" onClick={() => skip(-10)} aria-label="Back 10 seconds" title="Back 10 s (←)">
                <RotateCcw size={17} />
              </button>
              <button className="btn-icon" onClick={previous} aria-label="Previous song">
                <SkipBack size={20} fill="currentColor" />
              </button>
              <button
                className="w-14 h-14 rounded-full bg-ink text-canvas flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-transform"
                onClick={toggle}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-1" />}
              </button>
              <button className="btn-icon" onClick={() => next()} disabled={index + 1 >= queue.length && repeat !== 'all'} aria-label="Next song">
                <SkipForward size={20} fill="currentColor" />
              </button>
              <button className="btn-icon" onClick={() => skip(10)} aria-label="Forward 10 seconds" title="Forward 10 s (→)">
                <RotateCw size={17} />
              </button>
              <button className={clsx('btn-icon', repeat !== 'off' && 'text-accent')} onClick={cycleRepeat} aria-label={repeatLabel} title={repeatLabel}>
                {repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
              </button>
            </div>
            <div className="flex items-center justify-center gap-1">
              <SpeedMenu />
              <SleepMenu />
              <MoreMenu song={song} />
            </div>
          </div>

          {/* Lyrics or what's next */}
          <div className="min-h-0 hidden lg:flex flex-col">
            {tab === 'lyrics' ? <Lyrics songId={song.id} /> : <UpNext />}
          </div>
        </div>
      </div>
    </div>
  )
}

function Lyrics({ songId }: { songId: string }) {
  const time = usePlayerStore((s) => s.time)
  const seek = usePlayerStore((s) => s.seek)
  const { state, allowOnline } = useLyrics(songId, true)
  const lines = state.status === 'ready' ? state.lines : []
  const active = useMemo(() => activeLine(lines, time), [lines, time])
  const activeRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the line being sung in the middle. Only the lyrics scroll, never the page around them.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const line = activeRef.current
    const top = line ? line.offsetTop - list.clientHeight / 2 + line.clientHeight / 2 : 0
    list.scrollTo({ top, behavior: 'smooth' })
  }, [active, lines])

  if (state.status === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center text-muted">
        <Loader2 size={18} className="animate-spin" aria-label="Loading lyrics" />
      </div>
    )
  }
  if (state.status === 'error' || state.status === 'none') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
        <p className="font-display text-lg font-semibold">
          {state.status === 'error' ? "Couldn't load the lyrics" : 'No lyrics for this song'}
        </p>
        <p className="text-[13px] text-muted max-w-sm">
          {state.status === 'error'
            ? state.message
            : state.online
              ? "LRCLIB doesn't have lyrics for it either."
              : 'Cadence can look them up on LRCLIB, a free lyrics site. Only the song’s title, singer, album and length are sent.'}
        </p>
        {state.status === 'none' && !state.online && (
          <button className="btn-secondary" onClick={allowOnline}>
            Look up lyrics online
          </button>
        )}
      </div>
    )
  }
  if (!lines.length) {
    return (
      <div className="flex-1 overflow-auto pr-2">
        <p className="whitespace-pre-line text-[17px] leading-8 text-ink/85">{state.plain}</p>
        <p className="mt-6 text-xs text-faint">These lyrics aren't timed, so they don't follow the song.</p>
      </div>
    )
  }
  return (
    <div
      ref={listRef}
      className="relative flex-1 overflow-auto pr-2 [mask-image:linear-gradient(to_bottom,transparent,black_12%,black_88%,transparent)]"
    >
      <div className="py-[30vh] flex flex-col items-start gap-1">
        {lines.map((line, i) => (
          <button
            key={`${line.time}-${i}`}
            ref={i === active ? activeRef : undefined}
            onClick={() => seek(line.time)}
            className={clsx(
              'text-left font-display font-semibold leading-snug rounded-md px-2 py-1 transition-all duration-300 hover:bg-white/5',
              i === active ? 'text-[26px] text-ink' : 'text-[22px]',
              i < active ? 'text-ink/35' : i > active ? 'text-ink/55' : '',
            )}
            aria-current={i === active ? 'true' : undefined}
          >
            {line.text || '♪'}
          </button>
        ))}
      </div>
      <p className="pb-6 text-[11px] text-faint">
        {state.source === 'lrclib' ? 'Lyrics from LRCLIB' : 'Lyrics saved with the song'} · click a line to jump to it
      </p>
    </div>
  )
}

function UpNext() {
  const { queue, index, playing, jump, removeFromQueue } = usePlayerStore()
  const upcoming = queue.slice(index + 1)
  if (!upcoming.length) {
    return <p className="flex-1 flex items-center justify-center text-[13px] text-muted">Nothing after this song.</p>
  }
  return (
    <ol className="flex-1 overflow-auto pr-2 flex flex-col gap-0.5">
      <li className="eyebrow px-2 pb-2 flex items-center gap-2">
        <Volume2 size={12} className={clsx(playing ? 'text-accent' : 'text-faint')} aria-hidden="true" /> Then
      </li>
      {upcoming.map((s, i) => (
        <li key={`${s.id}-${index + 1 + i}`} className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-white/5">
          <button className="flex-1 min-w-0 flex items-center gap-3 text-left" onClick={() => jump(index + 1 + i)}>
            <SongCover id={s.id} hasCover={!!s.has_cover} className="w-10 h-10 rounded shrink-0" />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium truncate">{s.title}</span>
              <span className="block text-xs text-muted truncate">{s.artist || s.album_artist || s.album}</span>
            </span>
          </button>
          <span className="text-xs text-faint tnum font-mono">{formatTime(s.duration, false)}</span>
          <button
            className="btn-icon opacity-0 group-hover:opacity-100 focus:opacity-100"
            onClick={() => removeFromQueue(index + 1 + i)}
            aria-label={`Remove ${s.title} from the queue`}
          >
            ×
          </button>
        </li>
      ))}
    </ol>
  )
}
