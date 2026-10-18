import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { clsx } from 'clsx'
import {
  Captions, CaptionsOff, ExternalLink, ListVideo, Loader2, Maximize, Minimize, Pause, PictureInPicture2, Play,
  RotateCcw, RotateCw, SkipBack, SkipForward, Volume2, VolumeX, X,
} from 'lucide-react'
import { api, type LibraryVideo, type PlayerDetails } from '../../services/api'
import { useVideoPlayer } from '../../stores/videoPlayerStore'
import { AUDIO_START_EVENT, announceAudioStart } from '../../stores/playerStore'
import { languageName } from '../../lib/video'
import { SPEEDS, chapterAt, clock, courseOf, isWatched, remember, remembered, resumeAt } from '../../lib/videoPlayer'

const SAVE_EVERY_S = 5
const HIDE_CONTROLS_MS = 2500
const NEXT_IN_S = 5

/** The seek bar: what's played and buffered, chapter breaks, and the time and chapter under the pointer. */
function SeekBar({ time, duration, buffered, chapters, onSeek }: {
  time: number; duration: number; buffered: number; chapters: PlayerDetails['chapters']; onSeek: (t: number) => void
}) {
  const bar = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const at = (e: ReactPointerEvent) => {
    const r = bar.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration
  }
  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`
  const hoverChapter = hover !== null ? chapters[chapterAt(chapters, hover)] : undefined

  return (
    <div
      ref={bar}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${clock(time)} of ${clock(duration)}`}
      className="group relative h-4 flex items-center cursor-pointer outline-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
        onSeek(at(e))
      }}
      onPointerMove={(e) => {
        setHover(at(e))
        if (dragging) onSeek(at(e))
      }}
      onPointerUp={() => setDragging(false)}
      onPointerLeave={() => !dragging && setHover(null)}
    >
      <div className="relative w-full h-1 group-hover:h-1.5 transition-[height] rounded-full bg-white/25 overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: pct(buffered) }} />
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: pct(time) }} />
        {chapters.slice(1).map((c) => (
          <div key={c.start} className="absolute inset-y-0 w-[3px] -ml-px bg-black/70" style={{ left: pct(c.start) }} />
        ))}
      </div>
      <div
        className="absolute w-3 h-3 -ml-1.5 rounded-full bg-accent shadow opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ left: pct(time) }}
      />
      {hover !== null && (
        <div
          className="absolute bottom-5 -translate-x-1/2 px-2 py-1 rounded bg-black/85 text-white text-xs whitespace-nowrap pointer-events-none"
          style={{ left: pct(hover) }}
        >
          {hoverChapter?.title && <span className="block font-medium max-w-60 truncate">{hoverChapter.title}</span>}
          <span className="tnum">{clock(hover)}</span>
        </div>
      )}
    </div>
  )
}

/** A small menu that opens above its button. */
function Menu({ label, items, onPick, onClose }: {
  label: string; items: { id: string; label: string; on: boolean }[]; onPick: (id: string) => void; onClose: () => void
}) {
  return (
    <div
      role="menu"
      aria-label={label}
      className="absolute bottom-11 right-0 min-w-40 py-1 rounded-lg bg-black/90 border border-white/10 shadow-xl text-sm text-white"
      onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}
    >
      <p className="px-3 py-1 text-[11px] uppercase tracking-wide text-white/50">{label}</p>
      {items.map((it) => (
        <button
          key={it.id}
          role="menuitemradio"
          aria-checked={it.on}
          className={clsx('w-full text-left px-3 py-1.5 hover:bg-white/10', it.on && 'text-accent font-medium')}
          onClick={() => onPick(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

function IconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="w-9 h-9 rounded-full flex items-center justify-center text-white hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

function Player({ path }: { path: string }) {
  const open = useVideoPlayer((s) => s.open)
  const close = useVideoPlayer((s) => s.close)
  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [videos, setVideos] = useState<LibraryVideo[] | null>(null)
  const [details, setDetails] = useState<PlayerDetails | null>(null)
  const [missing, setMissing] = useState(false)
  const [cantPlay, setCantPlay] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [volume, setVolume] = useState(() => remembered('volume', 1))
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(() => remembered('rate', 1))
  const [captionLang, setCaptionLang] = useState<string>(() => remembered('captions', ''))
  const [trackUrl, setTrackUrl] = useState<string | null>(null)
  const [menu, setMenu] = useState<'speed' | 'cc' | null>(null)
  const [panel, setPanel] = useState(false)
  const [controls, setControls] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [resumed, setResumed] = useState<number | null>(null)
  const [nextIn, setNextIn] = useState<number | null>(null)
  const lastSaved = useRef(0)
  const hideTimer = useRef<number | undefined>(undefined)

  const current = videos?.find((v) => v.path === path)
  const course = useMemo(() => (videos && current ? courseOf(videos, current) : []), [videos, current])
  const index = course.findIndex((v) => v.path === path)
  const previous = index > 0 ? course[index - 1] : undefined
  const next = index >= 0 && index < course.length - 1 ? course[index + 1] : undefined
  const chapters = details?.chapters ?? []
  const chapter = chapterAt(chapters, time)
  const track = details?.subtitles.find((s) => s.lang === captionLang) ?? (captionLang === 'und' ? details?.subtitles.find((s) => !s.lang) : undefined)

  useEffect(() => {
    api.libraryVideos().then((list) => {
      setVideos(list)
      if (!list.some((v) => v.path === path)) setMissing(true)
    }).catch(() => setMissing(true))
  }, [path])

  useEffect(() => {
    if (!current) return
    api.playerDetails(current.key).then(setDetails).catch(() => setDetails({ duration: current.duration, chapters: [], subtitles: [] }))
  }, [current])

  // The chosen subtitles, loaded as a same-origin blob the <track> can read.
  useEffect(() => {
    setTrackUrl(null)
    if (!current || !track) return
    let url = ''
    let cancelled = false
    api.playerSubtitles(current.key, track.id).then((vtt) => {
      if (cancelled) return
      url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
      setTrackUrl(url)
    }).catch(() => undefined)
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [current, track])

  // The player draws the subtitles itself (above the controls when they show); the track only times them.
  const [cue, setCue] = useState('')
  useEffect(() => {
    setCue('')
    const t = videoRef.current?.textTracks[0]
    if (!t || !trackUrl) return
    t.mode = 'hidden'
    const onCue = () => setCue(Array.from(t.activeCues ?? []).map((c) => (c as VTTCue).text).join('\n'))
    t.addEventListener('cuechange', onCue)
    return () => t.removeEventListener('cuechange', onCue)
  }, [trackUrl])

  const save = useCallback((position: number) => {
    const v = videoRef.current
    if (!current || !v || !Number.isFinite(v.duration)) return
    lastSaved.current = position
    api.saveVideoProgress(current.key, position, v.duration).catch(() => undefined)
  }, [current])

  // Save the place when the player closes or moves to another video.
  useEffect(() => () => {
    const v = videoRef.current
    if (v && v.currentTime > 0) save(v.ended ? v.duration : v.currentTime)
  }, [save])

  // Another player (the music player, the review preview) starting pauses this one.
  useEffect(() => {
    const onOther = (e: Event) => (e as CustomEvent).detail !== 'video' && videoRef.current?.pause()
    window.addEventListener(AUDIO_START_EVENT, onOther)
    return () => window.removeEventListener(AUDIO_START_EVENT, onOther)
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // The "next video" countdown at the end of a course video.
  useEffect(() => {
    if (nextIn === null || !next) return
    if (nextIn <= 0) {
      open(next.path)
      return
    }
    const t = window.setTimeout(() => setNextIn(nextIn - 1), 1000)
    return () => window.clearTimeout(t)
  }, [nextIn, next, open])

  useEffect(() => {
    if (resumed === null) return
    const t = window.setTimeout(() => setResumed(null), 6000)
    return () => window.clearTimeout(t)
  }, [resumed])

  const showControls = useCallback(() => {
    setControls(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) {
        setControls(false)
        setMenu(null)
      }
    }, HIDE_CONTROLS_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  const v = () => videoRef.current
  const toggle = () => {
    const el = v()
    if (!el) return
    if (el.paused) el.play().catch(() => undefined)
    else el.pause()
  }
  const seek = (t: number) => {
    const el = v()
    if (el && Number.isFinite(t)) el.currentTime = Math.min(Math.max(0, t), el.duration || t)
  }
  const changeVolume = (value: number) => {
    const el = v()
    if (!el) return
    el.volume = Math.min(1, Math.max(0, value))
    el.muted = el.volume === 0
  }
  const changeRate = (value: number) => {
    const el = v()
    if (el) el.playbackRate = value
    setRate(value)
    remember('rate', value)
  }
  const chooseCaptions = (lang: string) => {
    setCaptionLang(lang)
    remember('captions', lang)
  }
  const toggleCaptions = () => {
    if (track) chooseCaptions('')
    else {
      const first = details?.subtitles[0]
      if (first) chooseCaptions(first.lang || 'und')
    }
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    else frameRef.current?.requestFullscreen().catch(() => undefined)
  }
  const pictureInPicture = () => {
    const el = v()
    if (!el) return
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => undefined)
    else el.requestPictureInPicture().catch(() => undefined)
  }
  const openElsewhere = async () => {
    v()?.pause()
    const problem = await window.electronAPI?.openFile(path)
    if (problem) setCantPlay(true)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const el = v()
    const target = e.target instanceof Element ? e.target : document.body
    if (!el || e.altKey || e.ctrlKey || e.metaKey || target.closest('[role="menu"], input')) return
    let handled = true
    switch (e.key) {
      case ' ':
        if (target.closest('button')) return
        toggle()
        break
      case 'k': toggle(); break
      case 'ArrowLeft': seek(el.currentTime - (e.shiftKey ? 30 : 5)); break
      case 'ArrowRight': seek(el.currentTime + (e.shiftKey ? 30 : 5)); break
      case 'j': seek(el.currentTime - 10); break
      case 'l': seek(el.currentTime + 10); break
      case 'ArrowUp': changeVolume(el.volume + 0.05); break
      case 'ArrowDown': changeVolume(el.volume - 0.05); break
      case 'm': el.muted = !el.muted; break
      case 'f': toggleFullscreen(); break
      case 'c': toggleCaptions(); break
      case '>': changeRate(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(rate) + 1)] ?? 1); break
      case '<': changeRate(SPEEDS[Math.max(0, SPEEDS.indexOf(rate) - 1)] ?? 1); break
      case 'N': if (next) open(next.path); break
      case 'P': if (previous) open(previous.path); break
      case 'Home': seek(0); break
      case 'End': seek(el.duration); break
      default:
        if (/^[0-9]$/.test(e.key)) seek((Number(e.key) / 10) * el.duration)
        else handled = false
    }
    if (handled) {
      e.preventDefault()
      showControls()
    }
  }

  // Keys work wherever focus is in the player (the latest handler, so it sees current state).
  const keyHandler = useRef(onKeyDown)
  keyHandler.current = onKeyDown
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const title = current?.title ?? ''
  const subtitleItems = [
    { id: '', label: 'Off', on: !track },
    ...(details?.subtitles ?? []).map((s) => ({
      id: s.lang || 'und',
      label: s.lang ? languageName(s.lang) : 'Subtitles',
      on: track?.id === s.id,
    })),
  ]

  return (
    <div className="flex h-full w-full bg-black text-white">
      <div
        ref={frameRef}
        className={clsx('relative flex-1 min-w-0 bg-black', !controls && playing && 'cursor-none')}
        onPointerMove={showControls}
        onPointerLeave={() => playing && setControls(false)}
      >
        {current && !cantPlay && (
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full"
            src={api.videoFileUrl(current.key)}
            poster={current.thumbnail && current.video_id ? api.videoThumbnailUrl(current.video_id) : undefined}
            autoPlay
            onClick={toggle}
            onDoubleClick={toggleFullscreen}
            onLoadedMetadata={(e) => {
              const el = e.currentTarget
              el.volume = volume
              el.playbackRate = rate
              setDuration(el.duration)
              const at = resumeAt(current.position, el.duration)
              if (at) {
                el.currentTime = at
                setResumed(at)
              }
            }}
            onDurationChange={(e) => setDuration(e.currentTarget.duration)}
            onTimeUpdate={(e) => {
              const t = e.currentTarget.currentTime
              setTime(t)
              if (Math.abs(t - lastSaved.current) >= SAVE_EVERY_S && !e.currentTarget.paused) save(t)
            }}
            onProgress={(e) => {
              const b = e.currentTarget.buffered
              if (b.length) setBuffered(b.end(b.length - 1))
            }}
            onPlay={() => {
              setPlaying(true)
              setNextIn(null)
              announceAudioStart('video')
              showControls()
            }}
            onPause={(e) => {
              setPlaying(false)
              setControls(true)
              save(e.currentTarget.currentTime)
            }}
            onWaiting={() => setWaiting(true)}
            onCanPlay={() => setWaiting(false)}
            onPlaying={() => setWaiting(false)}
            onVolumeChange={(e) => {
              setVolume(e.currentTarget.volume)
              setMuted(e.currentTarget.muted)
              remember('volume', e.currentTarget.volume)
            }}
            onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
            onEnded={(e) => {
              save(e.currentTarget.duration)
              if (next) setNextIn(NEXT_IN_S)
            }}
            onError={() => setCantPlay(true)}
          >
            {trackUrl && track && (
              <track key={trackUrl} kind="subtitles" src={trackUrl} srcLang={track.lang || 'und'} label={track.lang ? languageName(track.lang) : 'Subtitles'} default />
            )}
          </video>
        )}

        {(missing || cantPlay) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-6">
            <p className="text-lg font-semibold">{missing ? 'This video is no longer in your library.' : 'Cadence can’t play this video.'}</p>
            <p className="text-white/70 max-w-md">
              {missing
                ? 'Its file was moved or deleted.'
                : 'Its picture or sound is in a format Cadence’s player doesn’t support. Another player, such as VLC, can play it.'}
            </p>
            <div className="flex gap-2">
              {!missing && (
                <button className="btn-primary" onClick={openElsewhere}><ExternalLink size={14} aria-hidden="true" /> Open in another player</button>
              )}
              <button className="btn-secondary" onClick={close}>Close</button>
            </div>
          </div>
        )}

        {current && !cantPlay && waiting && (
          <Loader2 size={42} className="absolute left-1/2 top-1/2 -ml-[21px] -mt-[21px] animate-spin text-white/80 pointer-events-none" aria-label="Loading" />
        )}

        {cue && track && !cantPlay && (
          <div
            className={clsx('absolute inset-x-0 flex justify-center px-[8%] pointer-events-none transition-[bottom] duration-200', controls ? 'bottom-24' : 'bottom-8')}
            aria-live="off"
          >
            <p className="max-w-4xl text-center whitespace-pre-line rounded-md bg-black/75 px-3 py-1 text-white text-[clamp(15px,2.3vw,30px)] leading-snug">
              {cue.replace(/<[^>]+>/g, '')}
            </p>
          </div>
        )}

        {resumed !== null && (
          <div className="absolute left-1/2 -translate-x-1/2 top-16 flex items-center gap-3 px-4 py-2 rounded-full bg-black/80 text-sm">
            Carrying on from {clock(resumed)}
            <button className="text-accent font-medium hover:underline" onClick={() => { seek(0); setResumed(null) }}>Start over</button>
          </div>
        )}

        {nextIn !== null && next && (
          <div className="absolute right-6 bottom-24 w-80 p-4 rounded-xl bg-black/85 border border-white/10 flex flex-col gap-3">
            <p className="text-xs uppercase tracking-wide text-white/60">Next in {nextIn} s</p>
            <p className="font-medium line-clamp-2">{next.title}</p>
            <div className="flex gap-2">
              <button className="btn-primary h-8" onClick={() => open(next.path)}><Play size={13} aria-hidden="true" /> Play now</button>
              <button className="btn-secondary h-8" onClick={() => setNextIn(null)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Top: what's playing, and leaving the player. */}
        <div className={clsx('absolute inset-x-0 top-0 px-4 pt-3 pb-10 bg-gradient-to-b from-black/80 to-transparent flex items-start gap-3 transition-opacity', controls ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
          <div className="flex-1 min-w-0">
            <Dialog.Title className="font-semibold truncate">{title || 'Video'}</Dialog.Title>
            <Dialog.Description className="text-xs text-white/70 truncate">
              {current?.playlist && index >= 0 ? `${current.playlist} · ${index + 1} of ${course.length}` : current?.channel}
              {chapter >= 0 && chapters[chapter].title ? ` · ${chapters[chapter].title}` : ''}
            </Dialog.Description>
          </div>
          <IconButton label="Open in another player" onClick={openElsewhere}><ExternalLink size={17} /></IconButton>
          <Dialog.Close asChild>
            <button className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-accent" aria-label="Close player" title="Close (Esc)">
              <X size={19} />
            </button>
          </Dialog.Close>
        </div>

        {/* Bottom: the controls. */}
        {current && !cantPlay && (
          <div className={clsx('absolute inset-x-0 bottom-0 px-4 pt-10 pb-2 bg-gradient-to-t from-black/85 to-transparent transition-opacity', controls ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
            <SeekBar time={time} duration={duration} buffered={buffered} chapters={chapters} onSeek={seek} />
            <div className="flex items-center gap-1 mt-1">
              {course.length > 1 && (
                <IconButton label="Previous video (Shift+P)" onClick={() => previous && open(previous.path)} disabled={!previous}><SkipBack size={18} /></IconButton>
              )}
              <IconButton label={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={toggle}>
                {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
              </IconButton>
              {course.length > 1 && (
                <IconButton label="Next video (Shift+N)" onClick={() => next && open(next.path)} disabled={!next}><SkipForward size={18} /></IconButton>
              )}
              <IconButton label="Back 10 seconds (J)" onClick={() => seek(time - 10)}><RotateCcw size={17} /></IconButton>
              <IconButton label="Forward 10 seconds (L)" onClick={() => seek(time + 10)}><RotateCw size={17} /></IconButton>
              <div className="flex items-center gap-1 group/vol">
                <IconButton label={muted ? 'Unmute (M)' : 'Mute (M)'} onClick={() => { const el = v(); if (el) el.muted = !el.muted }}>
                  {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </IconButton>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  aria-label="Volume"
                  className="w-20 accent-[rgb(var(--accent))]"
                />
              </div>
              <span className="ml-2 text-xs tnum text-white/85">{clock(time)} / {clock(duration)}</span>
              <span className="flex-1" />
              <div className="relative">
                <button
                  className="h-9 px-2.5 rounded-full text-xs font-semibold tnum hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={`Speed ${rate}×`}
                  aria-haspopup="menu"
                  aria-expanded={menu === 'speed'}
                  title="Speed (< and >)"
                  onClick={() => setMenu(menu === 'speed' ? null : 'speed')}
                >
                  {rate}×
                </button>
                {menu === 'speed' && (
                  <Menu label="Speed" items={SPEEDS.map((s) => ({ id: String(s), label: s === 1 ? 'Normal' : `${s}×`, on: s === rate }))}
                    onPick={(id) => { changeRate(Number(id)); setMenu(null) }} onClose={() => setMenu(null)} />
                )}
              </div>
              {details && details.subtitles.length > 0 && (
                <div className="relative">
                  <IconButton label="Subtitles (C)" onClick={() => setMenu(menu === 'cc' ? null : 'cc')}>
                    {track ? <Captions size={19} /> : <CaptionsOff size={19} />}
                  </IconButton>
                  {menu === 'cc' && (
                    <Menu label="Subtitles" items={subtitleItems} onPick={(id) => { chooseCaptions(id); setMenu(null) }} onClose={() => setMenu(null)} />
                  )}
                </div>
              )}
              {(chapters.length > 0 || course.length > 1) && (
                <IconButton label={chapters.length ? 'Chapters' : 'Course'} onClick={() => setPanel(!panel)}><ListVideo size={18} /></IconButton>
              )}
              {document.pictureInPictureEnabled && (
                <IconButton label="Picture in picture" onClick={pictureInPicture}><PictureInPicture2 size={17} /></IconButton>
              )}
              <IconButton label={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'} onClick={toggleFullscreen}>
                {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
              </IconButton>
            </div>
          </div>
        )}
      </div>

      {panel && (
        <aside className="w-80 shrink-0 bg-[#111216] border-l border-white/10 flex flex-col min-h-0" aria-label="Chapters and course">
          <div className="flex items-center justify-between px-4 h-12 border-b border-white/10">
            <p className="font-semibold">{chapters.length ? 'Chapters' : 'Course'}</p>
            <button className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10" aria-label="Hide" onClick={() => setPanel(false)}><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {chapters.length > 0 && (
              <ol className="py-1">
                {chapters.map((c, i) => (
                  <li key={c.start}>
                    <button
                      className={clsx('w-full flex gap-3 px-4 py-2 text-left text-sm hover:bg-white/5', i === chapter && 'bg-accent/15 text-accent')}
                      onClick={() => seek(c.start)}
                      aria-current={i === chapter ? 'true' : undefined}
                    >
                      <span className="tnum text-white/50 w-14 shrink-0">{clock(c.start)}</span>
                      <span className="line-clamp-2">{c.title || `Chapter ${i + 1}`}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {course.length > 1 && (
              <>
                {chapters.length > 0 && <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-white/50">Course</p>}
                <ol className="py-1">
                  {course.map((c, i) => (
                    <li key={c.path}>
                      <button
                        className={clsx('w-full flex gap-3 px-4 py-2 text-left text-sm hover:bg-white/5', c.path === path && 'bg-accent/15 text-accent')}
                        onClick={() => c.path !== path && open(c.path)}
                        aria-current={c.path === path ? 'true' : undefined}
                      >
                        <span className="tnum text-white/50 w-6 shrink-0">{i + 1}</span>
                        <span className="flex-1 line-clamp-2">{c.title}</span>
                        {isWatched(c.position, c.duration) && <span className="text-[11px] text-white/50 shrink-0">Watched</span>}
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}

/** Cadence's own video player, over the whole window. Opened with useVideoPlayer().open(path). */
export default function VideoPlayer() {
  const path = useVideoPlayer((s) => s.path)
  const close = useVideoPlayer((s) => s.close)
  return (
    <Dialog.Root open={Boolean(path)} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Content
          aria-label="Video player"
          className="fixed inset-0 z-[60] bg-black outline-none"
          // Focus the player itself, not its first button, so Space plays rather than presses a button.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).focus()
          }}
        >
          {path && <Player key={path} path={path} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
