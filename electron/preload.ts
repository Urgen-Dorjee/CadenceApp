import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendInfo: () => ipcRenderer.invoke('backend:getInfo'),
  selectFolder: (options?: { defaultPath?: string; title?: string }) => ipcRenderer.invoke('dialog:openDir', options),
  selectMediaFiles: () => ipcRenderer.invoke('dialog:openMediaFiles'),
  selectImage: () => ipcRenderer.invoke('dialog:openImage'),
  // Full path of a file dropped on the window (File.path no longer exists in sandboxed renderers).
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  setTheme: (theme: string) => ipcRenderer.invoke('theme:set', theme),
  onSystemThemeChange: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('theme:changed', listener)
    return () => ipcRenderer.removeListener('theme:changed', listener)
  },
  showItemInFolder: (target: string) => ipcRenderer.invoke('shell:showItemInFolder', target),
  openPath: (target: string) => ipcRenderer.invoke('shell:openPath', target),
  readClipboard: () => ipcRenderer.invoke('clipboard:readText'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  openLogs: () => ipcRenderer.invoke('app:openLogs'),
  getUpdateStatus: () => ipcRenderer.invoke('update:getStatus'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, status: unknown) => callback(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  onBackendRestarting: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('backend:restarting', listener)
    return () => ipcRenderer.removeListener('backend:restarting', listener)
  },

  onBackendReady: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('backend:ready', listener)
    return () => ipcRenderer.removeListener('backend:ready', listener)
  },
  onBackendError: (callback: (error: string) => void) => {
    const listener = (_event: IpcRendererEvent, error: string) => callback(error)
    ipcRenderer.on('backend:error', listener)
    return () => ipcRenderer.removeListener('backend:error', listener)
  },
})
