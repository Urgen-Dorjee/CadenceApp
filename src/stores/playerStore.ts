import { create } from 'zustand'
import { api, type LibrarySong } from '../services/api'

/** Only one thing plays at a time: the library player and the review preview pause each other. */
export const AUDIO_START_EVENT = 'cadence:audio-start'
export function announceAudioStart(owner: string) {
  window.dispatchEvent(new CustomEvent(AUDIO_START_EVENT, { detail: owner }))
}

interface PlayerState {
  queue: LibrarySong[]
  index: number
  playing: boolean
  time: number
  duration: number
  volume: number
  current: () => LibrarySong | null
  playList: (songs: LibrarySong[], index: number) => void
  toggle: () => void
  pause: () => void
  next: () => void
  previous: () => void
  seek: (time: number) => void
  setVolume: (volume: number) => void
  close: () => void
}

let audio: HTMLAudioElement | null = null

function element(): HTMLAudioElement {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'metadata'
  audio.addEventListener('play', () => usePlayerStore.setState({ playing: true }))
  audio.addEventListener('pause', () => usePlayerStore.setState({ playing: false }))
  audio.addEventListener('timeupdate', () => usePlayerStore.setState({ time: audio!.currentTime }))
  audio.addEventListener('durationchange', () => usePlayerStore.setState({ duration: audio!.duration || 0 }))
  audio.addEventListener('ended', () => usePlayerStore.getState().next())
  window.addEventListener(AUDIO_START_EVENT, (e) => {
    if ((e as CustomEvent).detail !== 'library') audio?.pause()
  })
  return audio
}

function load(song: LibrarySong) {
  const el = element()
  el.src = api.songAudioUrl(song.id)
  announceAudioStart('library')
  el.play().catch(() => {})
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  index: -1,
  playing: false,
  time: 0,
  duration: 0,
  volume: 1,
  current: () => get().queue[get().index] ?? null,
  playList: (songs, index) => {
    if (!songs[index]) return
    set({ queue: songs, index, time: 0, duration: songs[index].duration })
    load(songs[index])
  },
  toggle: () => {
    const el = element()
    if (!get().current()) return
    if (el.paused) {
      announceAudioStart('library')
      el.play().catch(() => {})
    } else el.pause()
  },
  pause: () => audio?.pause(),
  next: () => {
    const { queue, index } = get()
    if (index + 1 < queue.length) {
      set({ index: index + 1, time: 0, duration: queue[index + 1].duration })
      load(queue[index + 1])
    } else {
      audio?.pause()
    }
  },
  previous: () => {
    const { queue, index } = get()
    const el = element()
    // Like most players: restart the song unless we're right at its start.
    if (el.currentTime > 3 || index === 0) {
      el.currentTime = 0
      return
    }
    set({ index: index - 1, time: 0, duration: queue[index - 1].duration })
    load(queue[index - 1])
  },
  seek: (time) => {
    const el = element()
    el.currentTime = Math.max(0, Math.min(time, el.duration || time))
    set({ time: el.currentTime })
  },
  setVolume: (volume) => {
    element().volume = volume
    set({ volume })
  },
  close: () => {
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    set({ queue: [], index: -1, playing: false, time: 0, duration: 0 })
  },
}))
