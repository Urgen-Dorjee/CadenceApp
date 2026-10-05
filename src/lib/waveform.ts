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
