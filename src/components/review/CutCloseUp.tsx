import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight, Ear, AlertTriangle, Loader2, Play } from 'lucide-react'
import { api } from '../../services/api'
import type { Track } from '../../types/job'
import { formatTime } from '../../lib/time'
import { SEGMENT_TOKENS, drawBars, prepareCanvas, segmentAt, tokenColor } from '../../lib/waveform'
import { cutNear, cutsInView, followPlayhead, windowAround, type Cut } from '../../lib/closeup'
import { useElementWidth } from '../../hooks/useElementWidth'

const SEGMENT_TEXT = ['text-seg1', 'text-seg2', 'text-seg3', 'text-seg4']

const HEIGHT = 84
/** Room above the bars for the cut time labels. */
const LABEL_SPACE = 18
/** How close (in pixels) a press must be to a cut to drag it instead of seeking. */
const GRAB_PX = 8

interface Props {
  jobId: string
  tracks: Track[]
  /** Index of the song whose start is the cut being inspected. */
  index: number
  cutNumber: number
  cutCount: number
  playhead: number | null
  playing: boolean
  disabled: boolean
  /** Move the cut at the start of tracks[index]. */
  onMoveCut: (index: number, time: number) => void
  onHearCut: (track: Track) => void
  onSeek: (time: number) => void
  onPrevCut: () => void
  onNextCut: () => void
  onNextToCheck: (() => void) | null
}

/**
 * Zoomed 16 s view for placing cuts exactly.
 *
 * Paused, it centres on the selected cut. Playing, it follows the playhead and
 * pages forward, so you can watch a song run up to and across the next cut.
 * Every cut in view is drawn with its time; drag one to move it, click anywhere
 * else to play from there.
 */
export default function CutCloseUp(p: Props) {
  const track = p.tracks[p.index]
  const previous = p.tracks[p.index - 1]
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [center, setCenter] = useState(track.start)
  const [view, setView] = useState<{ start: number; end: number; peaks: number[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [drag, setDrag] = useState<Cut | null>(null)
  const [hoverCut, setHoverCut] = useState(false)
  const following = p.playing && p.playhead !== null
  const timeOf = (c: Cut) => (drag?.index === c.index ? drag.time : c.time)

  // The window asked for. Decisions use it, not the last one loaded, so a slow
  // fetch never triggers a new request on every frame.
  const requested = windowAround(center)

  // Paused: centre on the selected cut when another one is chosen, or when it's moved near the edge.
  // Pausing itself leaves the view where it is.
  const cut = drag?.index === p.index ? drag.time : track.start
  useEffect(() => {
    if (!following) setCenter(track.start)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id])
  useEffect(() => {
    if (!following && (cut < requested.start + 2 || cut > requested.end - 2)) setCenter(cut)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cut])

  // Playing: follow the playhead, paging forward before it reaches the edge.
  useEffect(() => {
    if (!following) return
    const next = followPlayhead(requested, p.playhead!)
    if (next !== null) setCenter(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following, p.playhead, center])

  useEffect(() => {
    if (!width) return
    let cancelled = false
    setLoading(true)
    const { start, end } = windowAround(center)
    api
      .windowPeaks(p.jobId, track.source_id, start, end, Math.min(4000, width))
      .then((data) => !cancelled && setView(data))
      .catch(() => !cancelled && setView(null))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.round(center * 10), track.source_id, width])

  const cuts = useMemo(() => (view ? cutsInView(p.tracks, track.source_id, view) : []), [p.tracks, track.source_id, view])

  // Waveform: rounded bars in the colour of their song, matching the overview.
  // Bars already played are bright, the rest dimmed, so progress reads at a glance.
  const playhead = p.playhead
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || !view) return
    const ctx = prepareCanvas(canvas, width, HEIGHT)
    const span = view.end - view.start
    const shown = p.tracks.map((t, i) => (drag && i === drag.index ? { ...t, start: drag.time } : drag && i === drag.index - 1 ? { ...t, end: drag.time } : t))
    // [played, unplayed] colour per segment, and for excluded songs.
    const colors = SEGMENT_TOKENS.map((t) => [tokenColor(t, 0.95), tokenColor(t, 0.5)])
    const excluded = SEGMENT_TOKENS.map((t) => [tokenColor(t, 0.3), tokenColor(t, 0.18)])
    const outside = tokenColor('--faint', 0.3)
    const played = playhead !== null && playhead >= view.start ? playhead : -Infinity
    drawBars(ctx, view.peaks, width, HEIGHT, {
      bar: 3,
      gap: 2,
      top: LABEL_SPACE,
      bottom: 6,
      fill: (at) => {
        const t = view.start + at * span
        const i = segmentAt(shown, t)
        if (i === -1 || shown[i].source_id !== track.source_id) return outside
        return (shown[i].include ? colors : excluded)[i % colors.length][t <= played ? 0 : 1]
      },
    })
    // One-second ticks
    ctx.fillStyle = tokenColor('--line')
    for (let s = Math.ceil(view.start); s < view.end; s++) {
      ctx.fillRect(Math.round(((s - view.start) / span) * width), HEIGHT - 4, 1, 4)
    }
  }, [view, width, p.tracks, drag, track.source_id, playhead])

  const toTime = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    if (!view) return track.start
    return view.start + ((clientX - rect.left) / rect.width) * (view.end - view.start)
  }
  const grabTolerance = () => (view && width ? (GRAB_PX / width) * (view.end - view.start) : 0)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!view || e.button !== 0) return
    const t = toTime(e.clientX)
    const grabbed = p.disabled ? null : cutNear(cuts, t, grabTolerance())
    if (grabbed) {
      e.currentTarget.setPointerCapture(e.pointerId)
      setDrag({ index: grabbed.index, time: t })
    } else {
      p.onSeek(t)
    }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const t = toTime(e.clientX)
    if (drag) setDrag({ ...drag, time: t })
    else setHoverCut(!p.disabled && cutNear(cuts, t, grabTolerance()) !== null)
  }
  const onPointerUp = () => {
    if (drag) p.onMoveCut(drag.index, drag.time)
    setDrag(null)
  }

  const pct = (t: number) => (view ? `${((t - view.start) / (view.end - view.start)) * 100}%` : '50%')
  const lowConfidence = track.confidence < 0.7 && track.origin !== 'manual'
  const checkReason =
    track.origin === 'silence'
      ? 'Found from the audio. Check it'
      : Math.min(track.end - track.start, previous ? previous.end - previous.start : Infinity) < 45
        ? 'Very short for a song. Check it'
        : 'Check this cut'

  return (
    <section className="rounded-md border border-line bg-canvas p-3 flex flex-col gap-2.5" aria-label="Cut close-up">
      <div className="flex items-center gap-2 min-w-0">
        <button className="btn-icon" onClick={p.onPrevCut} disabled={p.cutNumber <= 1} aria-label="Previous cut">
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1 min-w-0 text-sm">
          <p className="truncate">
            <span className="text-muted">Cut {p.cutNumber} of {p.cutCount} · </span>
            <span className={SEGMENT_TEXT[(p.index - 1) % SEGMENT_TEXT.length]}>{previous?.title}</span>
            <span className="text-faint"> → </span>
            <span className={SEGMENT_TEXT[p.index % SEGMENT_TEXT.length]}>{track.title}</span>
          </p>
        </div>
        {lowConfidence && (
          <span className="inline-flex items-center gap-1 text-xs text-warn shrink-0">
            <AlertTriangle size={12} aria-hidden="true" /> {checkReason}
          </span>
        )}
        {following && (
          <span className="inline-flex items-center gap-1 text-xs text-accent font-mono tnum shrink-0" aria-live="off">
            <Play size={11} aria-hidden="true" /> {formatTime(p.playhead!)}
          </span>
        )}
        <span className="font-mono text-sm tnum shrink-0" title="Time of this cut">{formatTime(cut)}</span>
        <button className="btn-icon" onClick={p.onNextCut} disabled={p.cutNumber >= p.cutCount} aria-label="Next cut">
          <ChevronRight size={16} />
        </button>
      </div>

      <div
        ref={wrapRef}
        className={clsx(
          'relative select-none touch-none rounded bg-surface overflow-hidden',
          drag || hoverCut ? 'cursor-ew-resize' : 'cursor-pointer',
        )}
        style={{ height: HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoverCut(false)}
        onPointerCancel={() => setDrag(null)}
        role="img"
        aria-label={`Waveform from ${formatTime(view?.start ?? 0)} to ${formatTime(view?.end ?? 0)} with ${cuts.length} cut${cuts.length === 1 ? '' : 's'}. Click to play from a point, drag a cut to move it.`}
      >
        <canvas ref={canvasRef} className="absolute inset-0" aria-hidden="true" />
        {loading && !view && (
          <div className="absolute inset-0 flex items-center justify-center text-muted">
            <Loader2 size={18} className="animate-spin" aria-label="Loading waveform" />
          </div>
        )}
        {view && (
          <>
            {cuts.map((c) => {
              const selected = c.index === p.index
              const time = timeOf(c)
              return (
                <div
                  key={p.tracks[c.index].id}
                  className={clsx('absolute top-0 bottom-0 -ml-px pointer-events-none', selected ? 'w-0.5 bg-ink' : 'w-px bg-ink/50')}
                  style={{ left: pct(time) }}
                  aria-hidden="true"
                >
                  <span
                    className={clsx(
                      'absolute top-0 -translate-x-1/2 px-1.5 rounded-full text-[10px] leading-4 font-mono tnum whitespace-nowrap',
                      selected ? 'bg-ink text-canvas' : 'bg-raised text-muted',
                    )}
                  >
                    {formatTime(time)}
                  </span>
                </div>
              )
            })}
            {p.playhead !== null && p.playhead >= view.start && p.playhead <= view.end && (
              <div className="absolute bottom-0 w-0.5 -ml-px bg-accent pointer-events-none" style={{ left: pct(p.playhead), top: LABEL_SPACE }} aria-hidden="true">
                <span className="absolute -left-[3px] -top-1 w-2 h-2 rounded-full bg-accent" />
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-secondary h-8" onClick={() => p.onHearCut(track)}>
          <Ear size={14} aria-hidden="true" /> Hear the cut
        </button>
        <div className="flex items-center rounded-md border border-line overflow-hidden" role="group" aria-label="Nudge the cut">
          {[-1, -0.1, 0.1, 1].map((step) => (
            <button
              key={step}
              className="h-8 px-2.5 text-xs font-mono tnum text-muted hover:text-ink hover:bg-raised border-r border-line last:border-0 disabled:opacity-40"
              disabled={p.disabled}
              onClick={() => p.onMoveCut(p.index, track.start + step)}
              aria-label={`Move cut ${step > 0 ? 'later' : 'earlier'} by ${Math.abs(step)} seconds`}
            >
              {step > 0 ? '+' : '−'}{Math.abs(step)}s
            </button>
          ))}
        </div>
        <span className="text-xs text-faint">{following ? 'Following playback' : 'Click to play from a point · drag a cut to move it'}</span>
        <div className="flex-1" />
        {p.onNextToCheck && (
          <button className="btn-ghost h-8 text-warn hover:text-warn" onClick={p.onNextToCheck}>
            Next cut to check <ChevronRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  )
}
