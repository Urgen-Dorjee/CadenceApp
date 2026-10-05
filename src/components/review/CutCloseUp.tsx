import { PointerEvent, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Ear, AlertTriangle, Loader2 } from 'lucide-react'
import { api } from '../../services/api'
import type { Track } from '../../types/job'
import { formatTime } from '../../lib/time'
import { columnPeaks, prepareCanvas, tokenColor } from '../../lib/waveform'
import { useElementWidth } from '../../hooks/useElementWidth'

const HALF_WINDOW = 8
const HEIGHT = 96

interface Props {
  jobId: string
  tracks: Track[]
  /** Index of the song whose start is the cut being inspected. */
  index: number
  cutNumber: number
  cutCount: number
  playhead: number | null
  disabled: boolean
  onMoveCut: (index: number, time: number) => void
  onHearCut: (track: Track) => void
  onPrevCut: () => void
  onNextCut: () => void
  onNextToCheck: (() => void) | null
}

/** Zoomed view of ±8 s around one cut, for placing it exactly. */
export default function CutCloseUp(p: Props) {
  const track = p.tracks[p.index]
  const previous = p.tracks[p.index - 1]
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState<{ start: number; end: number; peaks: number[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragTime, setDragTime] = useState<number | null>(null)
  const cut = dragTime ?? track.start

  // Re-centre the close-up when the selected cut changes, or when the cut moves near the edge.
  const center = view && cut > view.start + 2 && cut < view.end - 2 ? null : cut
  useEffect(() => {
    if (center === null || !width) return
    let cancelled = false
    setLoading(true)
    const start = Math.max(0, center - HALF_WINDOW)
    const end = center + HALF_WINDOW
    api
      .windowPeaks(p.jobId, track.source_id, start, end, Math.min(4000, width))
      .then((data) => !cancelled && setView(data))
      .catch(() => !cancelled && setView(null))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center === null ? null : Math.round(center * 10), track.id, width])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || !view) return
    const ctx = prepareCanvas(canvas, width, HEIGHT)
    const cols = columnPeaks(view.peaks, width)
    const span = view.end - view.start
    const cutX = ((cut - view.start) / span) * width
    const before = tokenColor('--seg1', 0.85)
    const after = tokenColor('--seg2', 0.85)
    const mid = HEIGHT / 2
    for (let x = 0; x < width; x++) {
      ctx.fillStyle = x < cutX ? before : after
      const h = Math.max(1, cols[x] * (HEIGHT - 8))
      ctx.fillRect(x, mid - h / 2, 1, h)
    }
    // One-second grid
    ctx.fillStyle = tokenColor('--line')
    for (let s = Math.ceil(view.start); s < view.end; s++) {
      ctx.fillRect(Math.round(((s - view.start) / span) * width), HEIGHT - 6, 1, 6)
    }
  }, [view, width, cut])

  const toTime = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    if (!view) return track.start
    return view.start + ((clientX - rect.left) / rect.width) * (view.end - view.start)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (p.disabled || !view) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragTime(toTime(e.clientX))
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragTime !== null) setDragTime(toTime(e.clientX))
  }
  const onPointerUp = () => {
    if (dragTime !== null) p.onMoveCut(p.index, dragTime)
    setDragTime(null)
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
            <span className="text-seg1">{previous?.title}</span>
            <span className="text-faint"> → </span>
            <span className="text-seg2">{track.title}</span>
          </p>
        </div>
        {lowConfidence && (
          <span className="inline-flex items-center gap-1 text-xs text-warn shrink-0">
            <AlertTriangle size={12} aria-hidden="true" /> {checkReason}
          </span>
        )}
        <span className="font-mono text-sm tnum shrink-0">{formatTime(cut)}</span>
        <button className="btn-icon" onClick={p.onNextCut} disabled={p.cutNumber >= p.cutCount} aria-label="Next cut">
          <ChevronRight size={16} />
        </button>
      </div>

      <div
        ref={wrapRef}
        className="relative cursor-ew-resize select-none touch-none rounded bg-surface overflow-hidden"
        style={{ height: HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDragTime(null)}
        role="img"
        aria-label={`Waveform around the cut at ${formatTime(cut)}. Drag to move the cut.`}
      >
        <canvas ref={canvasRef} className="absolute inset-0" aria-hidden="true" />
        {loading && !view && (
          <div className="absolute inset-0 flex items-center justify-center text-muted">
            <Loader2 size={18} className="animate-spin" aria-label="Loading waveform" />
          </div>
        )}
        {view && (
          <>
            <div className="absolute top-0 bottom-0 w-0.5 -ml-px bg-ink pointer-events-none" style={{ left: pct(cut) }} aria-hidden="true">
              <span className="absolute -left-1 top-0 w-2.5 h-2.5 rounded-sm rotate-45 bg-ink" />
            </div>
            {p.playhead !== null && p.playhead >= view.start && p.playhead <= view.end && (
              <div className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none" style={{ left: pct(p.playhead) }} aria-hidden="true" />
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
