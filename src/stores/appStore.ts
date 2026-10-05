import { create } from 'zustand'
import type { UpdateStatus } from '../types/electron'

type BackendState = 'starting' | 'restarting' | 'ready' | 'error'

interface AppState {
  backend: BackendState
  backendError: string | null
  ffmpegAvailable: boolean
  ytDlpVersion: string
  update: UpdateStatus
  setUpdate: (update: UpdateStatus) => void
  setRestarting: () => void
  setReady: (info: { ffmpegAvailable: boolean; ytDlpVersion: string }) => void
  setError: (error: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  backend: 'starting',
  backendError: null,
  ffmpegAvailable: true,
  ytDlpVersion: '',
  update: { state: 'idle' },
  setUpdate: (update) => set({ update }),
  setRestarting: () => set({ backend: 'restarting', backendError: null }),
  setReady: ({ ffmpegAvailable, ytDlpVersion }) =>
    set({ backend: 'ready', backendError: null, ffmpegAvailable, ytDlpVersion }),
  setError: (error) => set({ backend: 'error', backendError: error }),
}))
