import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api'
import { parseLrc, type LyricLine } from '../lib/lrc'

export type LyricsState =
  | { status: 'loading' }
  | { status: 'none'; online: boolean }
  | { status: 'error'; message: string }
  | { status: 'ready'; lines: LyricLine[]; plain: string; source: 'saved' | 'lrclib' }

// Looking lyrics up online sends the song's title and singer to LRCLIB, so it's asked once and remembered.
const ONLINE_KEY = 'cadence.lyrics.online'
function onlineAllowed(): boolean {
  try {
    return localStorage.getItem(ONLINE_KEY) === '1'
  } catch {
    return false
  }
}

/** Lyrics for the playing song: saved with it, or (once allowed) looked up on LRCLIB. */
export function useLyrics(songId: string | null, enabled: boolean) {
  const [state, setState] = useState<LyricsState>({ status: 'loading' })
  const [online, setOnline] = useState(onlineAllowed)

  useEffect(() => {
    if (!songId || !enabled) return
    let cancelled = false
    setState({ status: 'loading' })
    api
      .songLyrics(songId, online)
      .then((r) => {
        if (cancelled) return
        if (!r.source) setState({ status: 'none', online })
        else setState({ status: 'ready', lines: r.synced ? parseLrc(r.synced) : [], plain: r.plain, source: r.source })
      })
      .catch((e: Error) => !cancelled && setState({ status: 'error', message: e.message }))
    return () => {
      cancelled = true
    }
  }, [songId, enabled, online])

  const allowOnline = useCallback(() => {
    try {
      localStorage.setItem(ONLINE_KEY, '1')
    } catch {
      // storage blocked: it's asked again next time
    }
    setOnline(true)
  }, [])

  return { state, allowOnline }
}
