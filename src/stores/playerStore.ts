import { create } from 'zustand'
import { api, type LibrarySong } from '../services/api'
import { insertAfter, nextIndex, previousIndex, removeAt, REPEAT_ORDER, shuffleFrom, type RepeatMode } from '../lib/queue'

/** Only one thing plays at a time: the library player and the review preview pause each other. */
export const AUDIO_START_EVENT = 'cadence:audio-start'
export function announceAudioStart(owner: string) {
  window.dispatchEvent(new CustomEvent(AUDIO_START_EVENT, { detail: owner }))
}

interface PlayerState {
  /** Songs in play order (shuffled when `shuffle` is on). */
  queue: LibrarySong[]
  /** The order the songs were chosen in, to go back to when shuffle is turned off. */
  original: LibrarySong[]
  index: number
  playing: boolean
  time: number
  duration: number
  volume: number
  repeat: RepeatMode
  shuffle: boolean
  current: () => LibrarySong | null
  playList: (songs: LibrarySong[], index: number) => void
  /** Play these songs after the current one. */
  playNext: (songs: LibrarySong[]) => void
  /** Add these songs to the end of the queue. */
  addToQueue: (songs: LibrarySong[]) => void
  /** Play the song at this position in the queue. */
  jump: (index: number) => void
  removeFromQueue: (index: number) => void
  /** Remove every song after the current one. */
  clearUpcoming: () => void
  toggle: () => void
  pause: () => void
  next: (auto?: boolean) => void
  previous: () => void
  seek: (time: number) => void
  setVolume: (volume: number) => void
  cycleRepeat: () => void
  toggleShuffle: () => void
  close: () => void
}

// Volume, repeat and shuffle are remembered on this computer between sessions.
const SETTINGS_KEY = 'cadence.player'
function savedSettings(): { volume: number; repeat: RepeatMode; shuffle: boolean } {
  const defaults = { volume: 1, repeat: 'off' as RepeatMode, shuffle: false }
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      volume: typeof saved.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : defaults.volume,
      repeat: REPEAT_ORDER.includes(saved.repeat) ? saved.repeat : defaults.repeat,
      shuffle: typeof saved.shuffle === 'boolean' ? saved.shuffle : defaults.shuffle,
    }
  } catch {
    return defaults
  }
}
function saveSettings() {
  const { volume, repeat, shuffle } = usePlayerStore.getState()
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ volume, repeat, shuffle }))
  } catch {
    // private window or storage blocked: settings just aren't remembered
  }
}

let audio: HTMLAudioElement | null = null
const media = typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null

function element(): HTMLAudioElement {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'metadata'
  audio.volume = usePlayerStore.getState().volume
  audio.addEventListener('play', () => {
    usePlayerStore.setState({ playing: true })
    if (media) media.playbackState = 'playing'
  })
  audio.addEventListener('pause', () => {
    usePlayerStore.setState({ playing: false })
    if (media) media.playbackState = 'paused'
  })
  audio.addEventListener('timeupdate', () => usePlayerStore.setState({ time: audio!.currentTime }))
  audio.addEventListener('durationchange', () => {
    usePlayerStore.setState({ duration: audio!.duration || 0 })
    updatePosition()
  })
  audio.addEventListener('seeked', updatePosition)
  audio.addEventListener('ended', () => usePlayerStore.getState().next(true))
  window.addEventListener(AUDIO_START_EVENT, (e) => {
    if ((e as CustomEvent).detail !== 'library') audio?.pause()
  })
  // Keyboard media keys, the Windows media overlay and macOS Now Playing.
  if (media) {
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => usePlayerStore.getState().toggle()],
      ['pause', () => usePlayerStore.getState().pause()],
      ['nexttrack', () => usePlayerStore.getState().next()],
      ['previoustrack', () => usePlayerStore.getState().previous()],
      ['seekto', (d) => d.seekTime !== undefined && usePlayerStore.getState().seek(d.seekTime)],
      ['stop', () => usePlayerStore.getState().close()],
    ]
    for (const [action, handler] of handlers) {
      try {
        media.setActionHandler(action, handler)
      } catch {
        // action not supported here
      }
    }
  }
  return audio
}

function updatePosition() {
  if (!media?.setPositionState || !audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return
  try {
    media.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 })
  } catch {
    // ignore out-of-range positions while a new song loads
  }
}

function load(song: LibrarySong) {
  const el = element()
  el.src = api.songAudioUrl(song.id)
  announceAudioStart('library')
  el.play().catch(() => {})
  if (media && typeof MediaMetadata !== 'undefined') {
    media.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist || song.album_artist || '',
      album: song.album || '',
      artwork: song.has_cover ? [{ src: api.songCoverUrl(song.id), sizes: '512x512', type: 'image/jpeg' }] : [],
    })
  }
}

function stop() {
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  if (media) {
    media.metadata = null
    media.playbackState = 'none'
  }
}

const initial = savedSettings()

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  original: [],
  index: -1,
  playing: false,
  time: 0,
  duration: 0,
  ...initial,
  current: () => get().queue[get().index] ?? null,
  playList: (songs, index) => {
    if (!songs[index]) return
    const queue = get().shuffle ? shuffleFrom(songs, index) : songs
    const start = get().shuffle ? 0 : index
    set({ queue, original: songs, index: start, time: 0, duration: songs[index].duration })
    load(queue[start])
  },
  playNext: (songs) => {
    if (!songs.length) return
    const { queue, index, original } = get()
    if (index < 0) return get().playList(songs, 0)
    // Also right after the current song in the chosen order, so they stay next if shuffle is turned off.
    const at = original.indexOf(queue[index])
    set({ queue: insertAfter(queue, index, songs), original: at < 0 ? [...original, ...songs] : insertAfter(original, at, songs) })
  },
  addToQueue: (songs) => {
    if (!songs.length) return
    const { queue, index, original } = get()
    if (index < 0) return get().playList(songs, 0)
    set({ queue: [...queue, ...songs], original: [...original, ...songs] })
  },
  jump: (index) => {
    const song = get().queue[index]
    if (!song) return
    set({ index, time: 0, duration: song.duration })
    load(song)
  },
  removeFromQueue: (at) => {
    const { queue, index, original } = get()
    const removed = queue[at]
    if (!removed) return
    const result = removeAt(queue, index, at)
    const o = original.indexOf(removed)
    const keptOriginal = o < 0 ? original : [...original.slice(0, o), ...original.slice(o + 1)]
    if (result.index < 0) {
      stop()
      set({ queue: [], original: [], index: -1, playing: false, time: 0, duration: 0 })
      return
    }
    set({ queue: result.queue, original: keptOriginal, index: result.index })
    if (at === index) {
      const song = result.queue[result.index]
      set({ time: 0, duration: song.duration })
      load(song)
    }
  },
  clearUpcoming: () => {
    const { queue, index } = get()
    if (index < 0) return
    const kept = queue.slice(0, index + 1)
    set({ queue: kept, original: kept })
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
  next: (auto = false) => {
    const { queue, index, repeat } = get()
    const to = nextIndex(index, queue.length, repeat, auto)
    if (to === null) {
      audio?.pause()
      return
    }
    if (to === index) {
      // Repeat one: play the same song again from the start.
      get().seek(0)
      element().play().catch(() => {})
      return
    }
    get().jump(to)
  },
  previous: () => {
    const { queue, index, repeat } = get()
    const el = element()
    // Like most players: restart the song unless we're right at its start.
    const to = previousIndex(index, queue.length, repeat)
    if (el.currentTime > 3 || to === index) {
      el.currentTime = 0
      return
    }
    get().jump(to)
  },
  seek: (time) => {
    const el = element()
    el.currentTime = Math.max(0, Math.min(time, el.duration || time))
    set({ time: el.currentTime })
  },
  setVolume: (volume) => {
    element().volume = volume
    set({ volume })
    saveSettings()
  },
  cycleRepeat: () => {
    const repeat = REPEAT_ORDER[(REPEAT_ORDER.indexOf(get().repeat) + 1) % REPEAT_ORDER.length]
    set({ repeat })
    saveSettings()
  },
  toggleShuffle: () => {
    const { shuffle, queue, original, index } = get()
    const current = queue[index]
    if (!shuffle) {
      // Shuffle what's left, keeping the current song playing.
      set({ shuffle: true, queue: index >= 0 ? shuffleFrom(queue, index) : queue, index: index >= 0 ? 0 : -1 })
    } else {
      // Back to the chosen order, at the same song.
      const restored = original.length ? original : queue
      set({ shuffle: false, queue: restored, index: current ? Math.max(0, restored.indexOf(current)) : -1 })
    }
    saveSettings()
  },
  close: () => {
    stop()
    set({ queue: [], original: [], index: -1, playing: false, time: 0, duration: 0 })
  },
}))
