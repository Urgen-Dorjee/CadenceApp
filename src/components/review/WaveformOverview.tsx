import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import type { Track } from '../../types/job'
import { formatTime } from '../../lib/time'
import { needsCheck } from '../../lib/tracks'
import { SEGMENT_TOKENS, drawBars, prepareCanvas, segmentAt, tokenColor } from '../../lib/waveform'
import { useElementWidth } from '../../hooks/useElementWidth'

const HEIGHT = 96

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
  const [hover, setHover] = useState<number | null>(null)

  const toTime = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return Math.min(p.duration, Math.max(0, ((clientX - rect.left) / rect.width) * p.duration))
  }

  // Draw the waveform as rounded bars, each in the colour of its song.
  // Bars already played are bright, the rest dimmed.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width) return
    const ctx = prepareCanvas(canvas, width, HEIGHT)
    if (!p.peaks) {
      ctx.fillStyle = tokenColor('--line')
      ctx.fillRect(0, HEIGHT / 2 - 1, width, 2)
      return
    }
    const colors = SEGMENT_TOKENS.map((t) => [tokenColor(t, 0.95), tokenColor(t, 0.55)])
    const excluded = SEGMENT_TOKENS.map((t) => [tokenColor(t, 0.28), tokenColor(t, 0.18)])
    const outside = tokenColor('--faint', 0.3)
    const played = p.playhead ?? -Infinity
    drawBars(ctx, p.peaks, width, HEIGHT, {
      bar: 2,
      gap: 1,
      top: 22,
      bottom: 6,
      fill: (at) => {
        const t = at * p.duration
        const i = segmentAt(p.tracks, t)
        if (i === -1) return outside
        return (p.tracks[i].include ? colors : excluded)[i % colors.length][t <= played ? 0 : 1]
      },
    })
  }, [p.peaks, p.tracks, p.duration, width, p.playhead])

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
        className="relative rounded-lg bg-sunken/70 ring-1 ring-inset ring-line cursor-pointer select-none touch-none overflow-hidden"
        style={{ height: HEIGHT }}
        onPointerMove={(e) => setHover(toTime(e.clientX))}
        onPointerLeave={() => setHover(null)}
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
              'absolute top-0 bottom-0 pointer-events-none transition-colors',
              p.selectedId === t.id && 'bg-ink/[0.05] ring-1 ring-inset ring-ink/25 rounded-[3px]',
            )}
            style={{ left: pct(t.start), width: pct(t.end - t.start) }}
          >
            {((t.end - t.start) / p.duration) * width >= 16 && (
              <span
                className={clsx(
                  'absolute left-2 right-2 top-1 text-[10.5px] leading-4 truncate',
                  p.selectedId === t.id ? 'text-ink' : 'text-muted',
                )}
              >
                <span className="font-semibold tnum">{i + 1}</span>
                {((t.end - t.start) / p.duration) * width >= 90 && t.title && <span className="ml-1.5">{t.title}</span>}
              </span>
            )}
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
              <span className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-ink/50 group-hover:bg-accent group-focus-visible:bg-accent group-focus-visible:w-0.5" />
              {/* Grab handle in the middle of the cut */}
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-6 rounded-full bg-ink/85 ring-2 ring-sunken group-hover:bg-accent group-hover:scale-110 group-focus-visible:bg-accent transition" />
              <span
                className={clsx(
                  'absolute left-1/2 -translate-x-1/2 bottom-1 px-1.5 py-px rounded bg-ink text-canvas text-[10.5px] font-mono tnum whitespace-nowrap transition-opacity',
                  drag?.index === index ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                )}
              >
                {formatTime(time)}
              </span>
            </button>
          )
        })}

        {hover !== null && !drag && (
          <div className="absolute top-0 bottom-0 w-px bg-ink/30 pointer-events-none" style={{ left: pct(hover) }} aria-hidden="true">
            <span
              className={clsx(
                'absolute bottom-1 px-1.5 py-px rounded bg-raised ring-1 ring-line text-[10.5px] font-mono tnum text-ink whitespace-nowrap',
                hover / p.duration > 0.9 ? 'right-1' : 'left-1',
              )}
            >
              {formatTime(hover, false)}
            </span>
          </div>
        )}

        {p.playhead !== null && (
          <div className="absolute top-0 bottom-0 w-0.5 -ml-px bg-accent pointer-events-none shadow-[0_0_8px_rgb(var(--accent)/0.6)]" style={{ left: pct(p.playhead) }} aria-hidden="true">
            <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-accent" />
          </div>
        )}
      </div>
      <div className="flex justify-between px-0.5 text-[10.5px] text-faint font-mono tnum" aria-hidden="true">
        <span>0:00</span>
        <span>{formatTime(p.duration / 4, false)}</span>
        <span>{formatTime(p.duration / 2, false)}</span>
        <span>{formatTime((p.duration * 3) / 4, false)}</span>
        <span>{formatTime(p.duration, false)}</span>
      </div>
    </div>
  )
}
