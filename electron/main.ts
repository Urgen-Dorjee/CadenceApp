import { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, nativeTheme, screen } from 'electron'
import path from 'path'
import fs from 'fs'
import net from 'net'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import log from 'electron-log/main'
import { PythonManager } from './python-manager'
import { FFmpegManager } from './ffmpeg-manager'
import { setupAutoUpdater } from './auto-updater'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Logs go to %APPDATA%\Cadence\logs\main.log (rotated at 5 MB) so problems can be diagnosed.
log.initialize()
log.transports.file.maxSize = 5 * 1024 * 1024
log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs', 'main.log')
log.info(`Cadence ${app.getVersion()} starting (${app.isPackaged ? 'installed' : 'dev'})`)

// One Cadence at a time: a second launch just focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// Dev-only: lets automated UI checks attach over the Chrome DevTools Protocol.
if (!app.isPackaged && process.env.CADENCE_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.CADENCE_DEBUG_PORT)
  app.commandLine.appendSwitch('remote-allow-origins', 'http://127.0.0.1:' + process.env.CADENCE_DEBUG_PORT)
}

// A fresh secret every launch: only this window can talk to the local backend.
const BACKEND_TOKEN = crypto.randomBytes(32).toString('base64url')
let backendPort = 0

let mainWindow: BrowserWindow | null = null
let pythonManager: PythonManager | null = null
let quitting = false
const crashTimes: number[] = []

// Files the backend can split (keep in step with backend/services/local_media.py).
const MEDIA_EXTENSIONS = [
  'mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus', 'wma', 'aiff', 'aif', 'ape', 'm4b',
  'mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'wmv', 'flv', 'ts',
]

// Window-control colours for each theme, matching the app's title bar.
const TITLE_BAR = {
  dark: { color: '#0d0e12', symbolColor: '#c9ccd4', height: 40 },
  light: { color: '#ffffff', symbolColor: '#3b4150', height: 40 },
} as const

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

// --- Window size and position ---------------------------------------------------

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState(): WindowState {
  const fallback: WindowState = { width: 1360, height: 880, maximized: false }
  try {
    const saved = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8')) as WindowState
    // Only restore a position that is still on a connected screen.
    if (saved.x !== undefined && saved.y !== undefined) {
      const area = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: saved.width, height: saved.height }).workArea
      const visible = saved.x < area.x + area.width - 100 && saved.y < area.y + area.height - 100 && saved.x + saved.width > area.x + 100
      if (!visible) delete saved.x, delete saved.y
    }
    return { ...fallback, ...saved }
  } catch {
    return fallback
  }
}

function saveWindowState(win: BrowserWindow) {
  try {
    const bounds = win.getNormalBounds()
    const state: WindowState = { ...bounds, maximized: win.isMaximized() }
    fs.writeFileSync(windowStateFile(), JSON.stringify(state))
  } catch (err) {
    log.warn('Could not save window state', err)
  }
}

function createWindow() {
  const state = loadWindowState()
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 980,
    minHeight: 640,
    title: 'Cadence',
    icon: path.join(__dirname, '../resources/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
    autoHideMenuBar: true,
    // The app draws its own title bar; Windows keeps the min/max/close buttons.
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLE_BAR.dark,
    backgroundColor: '#0a0b0e',
  })
  if (state.maximized) mainWindow.maximize()

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', () => mainWindow && saveWindowState(mainWindow))

  // Links open in the user's browser, never inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault()
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer process gone', details)
    if (details.reason !== 'clean-exit') mainWindow?.reload()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function registerIpcHandlers() {
  ipcMain.handle('backend:getInfo', () => ({ port: backendPort, token: BACKEND_TOKEN }))

  ipcMain.handle('dialog:openDir', async (_event, options?: { defaultPath?: string; title?: string }) => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options?.title ?? 'Choose a folder',
      defaultPath: typeof options?.defaultPath === 'string' ? options.defaultPath : undefined,
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:openMediaFiles', async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose audio or video files to split',
      buttonLabel: 'Split',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio and video', extensions: MEDIA_EXTENSIONS },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('dialog:openImage', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a cover image',
      buttonLabel: 'Use as cover',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Theme: 'system' | 'dark' | 'light'. Returns whether the app should render dark.
  ipcMain.handle('theme:set', (_event, theme: string) => {
    nativeTheme.themeSource = theme === 'dark' || theme === 'light' ? theme : 'system'
    const dark = nativeTheme.shouldUseDarkColors
    mainWindow?.setTitleBarOverlay(dark ? TITLE_BAR.dark : TITLE_BAR.light)
    mainWindow?.setBackgroundColor(dark ? '#0a0b0e' : '#f6f7f9')
    return dark
  })

  ipcMain.handle('shell:showItemInFolder', (_event, target: string) => {
    if (typeof target === 'string' && fs.existsSync(target)) shell.showItemInFolder(target)
  })

  ipcMain.handle('shell:openPath', async (_event, target: string) => {
    if (typeof target !== 'string') return
    fs.mkdirSync(target, { recursive: true })
    await shell.openPath(target)
  })

  ipcMain.handle('app:openLogs', () => shell.openPath(path.dirname(log.transports.file.getFile().path)))
  ipcMain.handle('clipboard:readText', () => clipboard.readText())
  ipcMain.handle('app:getVersion', () => app.getVersion())
}

function bundledTool(folder: string, exe: string): string | null {
  const dir = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources')
  const file = path.join(dir, folder, exe)
  return fs.existsSync(file) ? file : null
}

async function startBackend() {
  pythonManager?.stop()
  const ffmpeg = new FFmpegManager(app.getAppPath(), app.isPackaged)
  backendPort = await getFreePort()

  pythonManager = new PythonManager({
    port: backendPort,
    token: BACKEND_TOKEN,
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    ffmpegPath: ffmpeg.getPath(),
    // yt-dlp runs YouTube's player JavaScript with Deno; fpcalc fingerprints songs.
    denoPath: bundledTool('deno', 'deno.exe'),
    fpcalcPath: bundledTool('chromaprint', 'fpcalc.exe'),
  })
  pythonManager.log = (level, message) => log[level](message)
  pythonManager.onCrash = onBackendCrash

  try {
    await pythonManager.start()
    mainWindow?.webContents.send('backend:ready')
  } catch (err) {
    log.error('Backend failed to start', err)
    mainWindow?.webContents.send('backend:error', (err as Error).message ?? String(err))
  }
}

/** Restart the audio engine after a crash, but give up if it keeps crashing. */
function onBackendCrash(code: number | null) {
  if (quitting) return
  const now = Date.now()
  crashTimes.push(now)
  while (crashTimes.length && now - crashTimes[0] > 10 * 60 * 1000) crashTimes.shift()
  if (crashTimes.length > 3) {
    log.error('Backend keeps crashing; not restarting again')
    mainWindow?.webContents.send('backend:error', `The audio engine keeps stopping (last exit code ${code}). Restart Cadence; if it continues, send the log file to support.`)
    return
  }
  log.warn(`Backend crashed (code ${code}); restarting`)
  mainWindow?.webContents.send('backend:restarting')
  startBackend()
}

function setupMenu() {
  const help: Electron.MenuItemConstructorOptions[] = [
    { label: 'Open log folder', click: () => shell.openPath(path.dirname(log.transports.file.getFile().path)) },
    { type: 'separator' },
    {
      label: 'About Cadence',
      click: () => {
        dialog.showMessageBox({
          type: 'info',
          title: 'About Cadence',
          message: 'Cadence',
          detail: [
            `Version ${app.getVersion()}`,
            '',
            'Split YouTube jukeboxes, movie albums and singer',
            'collections into separate, tagged songs.',
            '',
            'Developer: Urgen Dorjee',
            'Copyright (c) 2026 Urgen Dorjee. MIT License.',
            '',
            'Powered by yt-dlp and FFmpeg.',
          ].join('\n'),
          icon: path.join(__dirname, '../resources/icon.ico'),
        })
      },
    },
  ]
  const view: Electron.MenuItemConstructorOptions[] = [
    { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
  ]
  if (!app.isPackaged) view.unshift({ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' })

  const template: Electron.MenuItemConstructorOptions[] = [
    { label: 'File', submenu: [{ role: 'quit', label: 'Exit Cadence' }] },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    { label: 'View', submenu: view },
    { label: 'Help', submenu: help },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  setupMenu()
  registerIpcHandlers()
  // Follow Windows when the app theme is "System".
  nativeTheme.on('updated', () => {
    const dark = nativeTheme.shouldUseDarkColors
    mainWindow?.setTitleBarOverlay(dark ? TITLE_BAR.dark : TITLE_BAR.light)
    mainWindow?.webContents.send('theme:changed')
  })
  createWindow()
  setupAutoUpdater(() => mainWindow)
  await startBackend()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

process.on('uncaughtException', (err) => log.error('Uncaught exception in main process', err))

app.on('window-all-closed', () => {
  quitting = true
  pythonManager?.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  quitting = true
  pythonManager?.stop()
})
