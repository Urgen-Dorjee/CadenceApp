import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../services/api'
import { AUDIO_START_EVENT, announceAudioStart } from '../stores/playerStore'

/** One shared <audio> element for previewing songs and cut points. */
export function useAudioPlayer(jobId: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stopAtRef = useRef<number | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'metadata'
    audioRef.current = audio
    let frame = 0
    const tick = () => {
      setTime(audio.currentTime)
      if (stopAtRef.current !== null && audio.currentTime >= stopAtRef.current) {
        audio.pause()
        stopAtRef.current = null
      }
      if (!audio.paused) frame = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      announceAudioStart('review')
      setPlaying(true)
      frame = requestAnimationFrame(tick)
    }
    const onPause = () => {
      setPlaying(false)
      cancelAnimationFrame(frame)
      setTime(audio.currentTime)
    }
    const onSeeked = () => setTime(audio.currentTime)
    const onOtherAudio = (e: Event) => {
      if ((e as CustomEvent).detail !== 'review') audio.pause()
    }
    window.addEventListener(AUDIO_START_EVENT, onOtherAudio)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onPause)
    audio.addEventListener('seeked', onSeeked)
    return () => {
      window.removeEventListener(AUDIO_START_EVENT, onOtherAudio)
      cancelAnimationFrame(frame)
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
  }, [])

  const load = useCallback(
    (id: string) => {
      const audio = audioRef.current!
      if (sourceId !== id) {
        audio.src = api.sourceAudioUrl(jobId, id)
        setSourceId(id)
      }
      return audio
    },
    [jobId, sourceId],
  )

  /** Play part of a source. Without `end` it plays on until paused. */
  const playRange = useCallback(
    (id: string, start: number, end?: number) => {
      const audio = load(id)
      stopAtRef.current = end ?? null
      const begin = () => {
        audio.currentTime = Math.max(0, start)
        audio.play().catch(() => {})
      }
      if (audio.readyState >= 1) begin()
      else audio.addEventListener('loadedmetadata', begin, { once: true })
    },
    [load],
  )

  const seek = useCallback(
    (id: string, t: number) => {
      const audio = load(id)
      stopAtRef.current = null
      const apply = () => {
        audio.currentTime = Math.max(0, t)
        setTime(audio.currentTime)
      }
      if (audio.readyState >= 1) apply()
      else audio.addEventListener('loadedmetadata', apply, { once: true })
    },
    [load],
  )

  const toggle = useCallback(
    (fallbackSource: string) => {
      const audio = audioRef.current!
      if (!sourceId) {
        playRange(fallbackSource, 0)
        return
      }
      if (audio.paused) {
        stopAtRef.current = null
        audio.play().catch(() => {})
      } else audio.pause()
    },
    [sourceId, playRange],
  )

  return { sourceId, playing, time, playRange, seek, toggle }
}
