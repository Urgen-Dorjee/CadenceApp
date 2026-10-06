/** Helpers shared by the waveform canvases. */

export const SEGMENT_TOKENS = ['--seg1', '--seg2', '--seg3', '--seg4']

/** Read an "R G B" design token and return a CSS colour with the given alpha. */
export function tokenColor(token: string, alpha = 1): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || '128 128 128'
  return `rgb(${value} / ${alpha})`
}

/** Peak value for each pixel column: max of the peaks that fall into it. */
export function columnPeaks(peaks: number[], columns: number): Float32Array {
  const out = new Float32Array(Math.max(0, columns))
  if (!peaks.length || columns <= 0) return out
  const per = peaks.length / columns
  for (let x = 0; x < columns; x++) {
    const from = Math.floor(x * per)
    const to = Math.max(from + 1, Math.floor((x + 1) * per))
    let max = 0
    for (let i = from; i < to && i < peaks.length; i++) if (peaks[i] > max) max = peaks[i]
    out[x] = max
  }
  return out
}

/** Size a canvas for crisp drawing on high-DPI screens and return its 2D context. */
export function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return ctx
}

/** Index of the segment containing time t, or -1. Segments are sorted by start. */
export function segmentAt(segments: { start: number; end: number }[], t: number): number {
  let lo = 0
  let hi = segments.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (t < segments[mid].start) hi = mid - 1
    else if (t >= segments[mid].end) lo = mid + 1
    else return mid
  }
  return -1
}

export interface Bar {
  x: number
  /** Centre of the bar as a fraction of the width, 0..1, for colouring by time. */
  at: number
  height: number
}

/**
 * Rounded-bar layout: one bar per `bar + gap` pixels, heights on a gentle curve so
 * loud passages don't flatten into a solid wall and quiet ones stay visible.
 */
export function barLayout(peaks: number[], width: number, area: number, bar: number, gap: number): Bar[] {
  const count = Math.max(0, Math.floor((width + gap) / (bar + gap)))
  const cols = columnPeaks(peaks, count)
  const bars: Bar[] = []
  for (let i = 0; i < count; i++) {
    const x = i * (bar + gap)
    bars.push({ x, at: (x + bar / 2) / width, height: Math.max(bar, Math.pow(cols[i], 0.8) * area) })
  }
  return bars
}

/** Draw rounded bars centred vertically in [top, height - bottom]. `fill` picks each bar's colour. */
export function drawBars(
  ctx: CanvasRenderingContext2D,
  peaks: number[],
  width: number,
  height: number,
  opts: { bar: number; gap: number; top?: number; bottom?: number; fill: (at: number) => string },
) {
  const top = opts.top ?? 0
  const area = height - top - (opts.bottom ?? 0)
  const mid = top + area / 2
  const radius = opts.bar / 2
  for (const b of barLayout(peaks, width, area * 0.92, opts.bar, opts.gap)) {
    ctx.fillStyle = opts.fill(b.at)
    ctx.beginPath()
    ctx.roundRect(b.x, mid - b.height / 2, opts.bar, b.height, radius)
    ctx.fill()
  }
}
