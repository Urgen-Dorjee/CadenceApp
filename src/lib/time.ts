/** 75.4 -> "1:15.4", 3723 -> "1:02:03.0". Tenths are shown so cuts can be fine-tuned. */
export function formatTime(seconds: number, tenths = true): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const rounded = tenths ? Math.round(seconds * 10) / 10 : Math.round(seconds)
  const h = Math.floor(rounded / 3600)
  const m = Math.floor((rounded % 3600) / 60)
  const s = rounded % 60
  const sec = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** "1:15.4", "01:02:03", "75" -> seconds. Returns null for anything else. */
export function parseTime(text: string): number | null {
  const t = text.trim()
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(t)) return null
  const parts = t.split(':')
  const last = parseFloat(parts.pop()!)
  if (parts.length && last >= 60) return null
  let total = last
  let mult = 60
  while (parts.length) {
    const v = parseInt(parts.pop()!, 10)
    if (mult === 60 && parts.length && v >= 60) return null
    total += v * mult
    mult *= 60
  }
  return Math.round(total * 1000) / 1000
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)} h ${mins % 60} min`
}
