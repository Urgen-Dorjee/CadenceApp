import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

/** What the renderer shows in Settings and the status bar. */
export interface UpdateStatus {
  state: 'unsupported' | 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error'
  version?: string
  percent?: number
  message?: string
  checkedAt?: number
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let status: UpdateStatus = { state: app.isPackaged ? 'idle' : 'unsupported' }

export function setupAutoUpdater(getWindow: () => BrowserWindow | null) {
  const send = (next: UpdateStatus) => {
    status = next
    getWindow()?.webContents.send('update:status', status)
  }

  ipcMain.handle('update:getStatus', () => status)
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return status
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      send({ state: 'error', message: friendly(err), checkedAt: Date.now() })
    }
    return status
  })
  ipcMain.handle('update:install', () => {
    if (status.state === 'ready') autoUpdater.quitAndInstall(false, true)
  })

  // Updates only work in installed builds.
  if (!app.isPackaged) return

  autoUpdater.logger = log
  // Download quietly in the background; the user decides when to restart.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send({ ...status, state: 'checking' }))
  autoUpdater.on('update-not-available', () => send({ state: 'none', checkedAt: Date.now() }))
  autoUpdater.on('update-available', (info) => send({ state: 'downloading', version: info.version, percent: 0, checkedAt: Date.now() }))
  autoUpdater.on('download-progress', (p) => send({ ...status, state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version, checkedAt: Date.now() }))
  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err)
    send({ state: 'error', message: friendly(err), checkedAt: Date.now() })
  })

  const check = () => autoUpdater.checkForUpdates().catch((err) => log.warn('Update check failed:', err))
  setTimeout(check, 10_000)
  setInterval(check, CHECK_EVERY_MS)
}

function friendly(err: unknown): string {
  const text = String((err as Error)?.message ?? err)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(text)) return "Couldn't reach the update server. Check your internet connection."
  if (/404/.test(text)) return 'No published releases were found yet.'
  return 'The update check failed. Details are in the log file.'
}
