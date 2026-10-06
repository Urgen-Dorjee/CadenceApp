export interface UpdateStatus {
  state: 'unsupported' | 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error'
  version?: string
  percent?: number
  message?: string
  checkedAt?: number
}

interface ElectronAPI {
  getBackendInfo: () => Promise<{ port: number; token: string }>
  selectFolder: (options?: { defaultPath?: string; title?: string }) => Promise<string | null>
  selectMediaFiles: () => Promise<string[]>
  pathForFile: (file: File) => string
  setTheme: (theme: 'system' | 'dark' | 'light') => Promise<boolean>
  onSystemThemeChange: (callback: () => void) => () => void
  showItemInFolder: (target: string) => Promise<void>
  openPath: (target: string) => Promise<void>
  readClipboard: () => Promise<string>
  getVersion: () => Promise<string>
  openLogs: () => Promise<void>
  getUpdateStatus: () => Promise<UpdateStatus>
  checkForUpdates: () => Promise<UpdateStatus>
  installUpdate: () => Promise<void>
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
  onBackendRestarting: (callback: () => void) => () => void
  onBackendReady: (callback: () => void) => () => void
  onBackendError: (callback: (error: string) => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
