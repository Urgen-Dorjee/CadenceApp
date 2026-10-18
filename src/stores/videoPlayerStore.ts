import { create } from 'zustand'

/** The built-in video player: which downloaded video (by file path) is open, if any. */
interface VideoPlayerState {
  path: string | null
  open: (path: string) => void
  close: () => void
}

export const useVideoPlayer = create<VideoPlayerState>((set) => ({
  path: null,
  open: (path) => set({ path }),
  close: () => set({ path: null }),
}))
