import { app, BrowserWindow, ipcMain, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { isNewer } from './version'

/** What the renderer shows in Settings and the status bar. */
export interface UpdateStatus {
  // 'available': a newer version to download by hand (unsigned Mac app); `message` is its page.
  state: 'unsupported' | 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  version?: string
  percent?: number
  message?: string
  checkedAt?: number
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

// macOS only installs updates for signed apps (Developer ID). Until Cadence is signed,
// the Mac app checks GitHub for a newer version and links to it instead.
const macUnsigned = process.platform === 'darwin' && !process.env.CADENCE_MAC_SIGNED
const LATEST_RELEASE_API = 'https://api.github.com/repos/Urgen-Dorjee/CadenceApp/releases/latest'

let status: UpdateStatus = app.isPackaged ? { state: 'idle' } : { state: 'unsupported' }

async function latestRelease(): Promise<{ version: string; url: string }> {
  const res = await net.fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Cadence' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as { tag_name: string; html_url: string }
  return { version: body.tag_name.replace(/^v/, ''), url: body.html_url }
}

export function setupAutoUpdater(getWindow: () => BrowserWindow | null) {
  const send = (next: UpdateStatus) => {
    status = next
    getWindow()?.webContents.send('update:status', status)
  }

  ipcMain.handle('update:getStatus', () => status)
  // Unsigned Mac app: look for a newer release and link to it.
  const checkManually = async () => {
    send({ ...status, state: 'checking' })
    try {
      const latest = await latestRelease()
      send(isNewer(latest.version, app.getVersion())
        ? { state: 'available', version: latest.version, message: latest.url, checkedAt: Date.now() }
        : { state: 'none', checkedAt: Date.now() })
    } catch (err) {
      log.warn('Update check failed:', err)
      send({ state: 'error', message: friendly(err), checkedAt: Date.now() })
    }
  }

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return status
    if (macUnsigned) {
      await checkManually()
      return status
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      send({ state: 'error', message: friendly(err), checkedAt: Date.now() })
    }
    return status
  })
  ipcMain.handle('update:install', () => {
    // Silent: no installer wizard. Cadence closes, the update installs into the same folder
    // and Cadence opens again by itself.
    if (status.state === 'ready') autoUpdater.quitAndInstall(true, true)
  })

  if (!app.isPackaged) return
  if (macUnsigned) {
    setTimeout(checkManually, 10_000)
    setInterval(checkManually, CHECK_EVERY_MS)
    return
  }

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
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|ERR_INTERNET|ERR_NAME/i.test(text)) return "Couldn't reach the update server. Check your internet connection."
  if (/404/.test(text)) return 'No published releases were found yet.'
  return 'The update check failed. Details are in the log file.'
}
