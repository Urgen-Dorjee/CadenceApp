import { create } from 'zustand'
import type { UpdateStatus } from '../types/electron'

type BackendState = 'starting' | 'restarting' | 'ready' | 'error'

interface AppState {
  backend: BackendState
  backendError: string | null
  ffmpegAvailable: boolean
  /** This build has Cadence's own AcoustID key, so songs can be identified without one of your own. */
  identifyBuiltIn: boolean
  ytDlpVersion: string
  update: UpdateStatus
  /** "Restart to update" was clicked: the window explains what happens next, then Cadence closes. */
  installing: boolean
  setInstalling: (installing: boolean) => void
  setUpdate: (update: UpdateStatus) => void
  setRestarting: () => void
  setReady: (info: { ffmpegAvailable: boolean; ytDlpVersion: string; identifyBuiltIn: boolean }) => void
  setError: (error: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  backend: 'starting',
  backendError: null,
  ffmpegAvailable: true,
  identifyBuiltIn: false,
  ytDlpVersion: '',
  update: { state: 'idle' },
  installing: false,
  setInstalling: (installing) => set({ installing }),
  setUpdate: (update) => set({ update }),
  setRestarting: () => set({ backend: 'restarting', backendError: null }),
  setReady: ({ ffmpegAvailable, ytDlpVersion, identifyBuiltIn }) =>
    set({ backend: 'ready', backendError: null, ffmpegAvailable, ytDlpVersion, identifyBuiltIn }),
  setError: (error) => set({ backend: 'error', backendError: error }),
}))
