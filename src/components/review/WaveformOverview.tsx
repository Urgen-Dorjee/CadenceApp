import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import type { Track } from '../../types/job'
import { formatTime } from '../../lib/time'
import { needsCheck } from '../../lib/tracks'
import { SEGMENT_TOKENS, columnPeaks, prepareCanvas, segmentAt, tokenColor } from '../../lib/waveform'
import { useElementWidth } from '../../hooks/useElementWidth'

const HEIGHT = 88

interface Props {
  tracks: Track[]
  duration: number
  peaks: number[] | null
  playhead: number | null
  selectedId: string | null
  disabled: boolean
  onSeek: (time: number) => void
  onSelect: (id: string) => void
  /** Move the cut at the start of tracks[index]. */
  onMoveCut: (index: number, time: number) => void
}

/** The whole video as a waveform, coloured per song, with draggable cuts. */
export default function WaveformOverview(p: Props) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drag, setDrag] = useState<{ index: number; time: number } | null>(null)

  const toTime = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return Math.min(p.duration, Math.max(0, ((clientX - rect.left) / rect.width) * p.duration))
  }

  // Draw the waveform. Each column takes the colour of the song it belongs to.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width) return
    const ctx = prepareCanvas(canvas, width, HEIGHT)
    const mid = HEIGHT / 2
    if (!p.peaks) {
      ctx.fillStyle = tokenColor('--line')
      ctx.fillRect(0, mid - 1, width, 2)
      return
    }
    const cols = columnPeaks(p.peaks, width)
    const colors = SEGMENT_TOKENS.map((t) => [tokenColor(t, 0.9), tokenColor(t, 0.22)])
    const outside = tokenColor('--faint', 0.35)
    for (let x = 0; x < width; x++) {
      const t = ((x + 0.5) / width) * p.duration
      const i = segmentAt(p.tracks, t)
      ctx.fillStyle = i === -1 ? outside : colors[i % colors.length][p.tracks[i].include ? 0 : 1]
      const h = Math.max(1, cols[x] * (HEIGHT - 8))
      ctx.fillRect(x, mid - h / 2, 1, h)
    }
  }, [p.peaks, p.tracks, p.duration, width])

  const cuts = p.tracks
    .map((t, i) => ({ index: i, time: t.start, linked: i > 0 && Math.abs(p.tracks[i - 1].end - t.start) <= 0.5 }))
    .filter((c) => c.linked)

  const pct = (t: number) => `${(t / p.duration) * 100}%`

  const startDrag = (e: PointerEvent<HTMLButtonElement>, index: number) => {
    if (p.disabled) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    p.onSelect(p.tracks[index].id)
    setDrag({ index, time: p.tracks[index].start })
  }
  const moveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (drag) setDrag({ ...drag, time: toTime(e.clientX) })
  }
  const endDrag = () => {
    if (drag) p.onMoveCut(drag.index, drag.time)
    setDrag(null)
  }
  const nudge = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowRight' ? 1 : -1)
    p.onMoveCut(index, p.tracks[index].start + step)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={wrapRef}
        className="relative rounded-md bg-canvas border border-line cursor-crosshair select-none touch-none"
        style={{ height: HEIGHT }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const t = toTime(e.clientX)
          const i = segmentAt(p.tracks, t)
          if (i !== -1) p.onSelect(p.tracks[i].id)
          p.onSeek(t)
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" aria-hidden="true" />

        {/* Song numbers and "needs a check" stripes */}
        {p.tracks.map((t, i) => (
          <div
            key={t.id}
            className={clsx(
              'absolute top-0 bottom-0 pointer-events-none',
              p.selectedId === t.id && 'bg-ink/[0.06] outline outline-1 outline-ink/30 -outline-offset-1',
            )}
            style={{ left: pct(t.start), width: pct(t.end - t.start) }}
          >
            <span className="absolute left-1.5 top-1 text-[10px] font-semibold text-muted tnum">{i + 1}</span>
            {needsCheck(t) && (
              <span
                className="absolute inset-x-0 bottom-0 h-1 bg-[repeating-linear-gradient(90deg,rgb(var(--warn)),rgb(var(--warn))_4px,transparent_4px,transparent_8px)]"
                aria-hidden="true"
              />
            )}
          </div>
        ))}

        {/* Draggable cuts */}
        {cuts.map(({ index }) => {
          const time = drag?.index === index ? drag.time : p.tracks[index].start
          return (
            <button
              key={p.tracks[index].id}
              type="button"
              disabled={p.disabled}
              className="group absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize focus:outline-none disabled:cursor-default"
              style={{ left: pct(time) }}
              onPointerDown={(e) => startDrag(e, index)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => nudge(e, index)}
              onFocus={() => p.onSelect(p.tracks[index].id)}
              aria-label={`Cut before song ${index + 1} at ${formatTime(time)}. Use arrow keys to move it.`}
            >
              <span className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-ink/70 group-hover:bg-accent group-focus-visible:bg-accent group-focus-visible:w-0.5" />
              <span className="absolute left-1/2 -translate-x-1/2 -top-1 w-2.5 h-2.5 rounded-sm rotate-45 bg-ink/80 group-hover:bg-accent group-focus-visible:bg-accent" />
              {drag?.index === index && (
                <span className="absolute left-1/2 -translate-x-1/2 -top-7 px-1.5 py-0.5 rounded bg-ink text-canvas text-[11px] font-mono tnum whitespace-nowrap">
                  {formatTime(time)}
                </span>
              )}
            </button>
          )
        })}

        {p.playhead !== null && (
          <div className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none" style={{ left: pct(p.playhead) }} aria-hidden="true" />
        )}
      </div>
      <div className="flex justify-between text-[11px] text-faint tnum" aria-hidden="true">
        <span>0:00</span>
        <span>{formatTime(p.duration / 4, false)}</span>
        <span>{formatTime(p.duration / 2, false)}</span>
        <span>{formatTime((p.duration * 3) / 4, false)}</span>
        <span>{formatTime(p.duration, false)}</span>
      </div>
    </div>
  )
}
