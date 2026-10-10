/** Synced lyrics (.lrc): "[01:02.30] A line". */

export interface LyricLine {
  time: number
  text: string
}

const STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g

/** Timed lines in order. A line with several stamps is repeated at each; tags like [ar:…] are skipped. */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(STAMP)]
    if (!stamps.length) continue
    const words = raw.replace(STAMP, '').trim()
    for (const m of stamps) {
      lines.push({ time: Number(m[1]) * 60 + Number(m[2].replace(':', '.')), text: words })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}

/** Index of the line being sung at `time`, or -1 before the first. */
export function activeLine(lines: LyricLine[], time: number): number {
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= time + 0.15) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}
