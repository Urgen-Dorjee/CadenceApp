import { BrowserWindow, app, session, shell } from 'electron'
import fs from 'fs'
import { isSignedIn, isYouTubeSignInCookie, toNetscape } from './cookies'

/**
 * "Sign in to YouTube" inside Cadence: a window with its own storage (never the user's browser)
 * opens Google's YouTube sign-in. Once YouTube has signed in, its cookies are written to a
 * cookies.txt file in Cadence's data folder for yt-dlp, which keeps that file up to date.
 */
const PARTITION = 'persist:youtube-sign-in'
const SIGN_IN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F'

// Google refuses sign-in in windows that say they're an app, so this one says it's plain Chrome.
function chromeUserAgent(): string {
  return app.userAgentFallback.replace(/\s(Electron|Cadence|cadence)\/\S+/g, '')
}

function allowed(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && (/(^|\.)youtube\.com$/.test(hostname) || /(^|\.)google\.[a-z.]+$/.test(hostname) || /(^|\.)gstatic\.com$/.test(hostname))
  } catch {
    return false
  }
}

let open: BrowserWindow | null = null

export type SignInResult = 'signed-in' | 'cancelled'

export function signIn(parent: BrowserWindow | null, cookiesFile: string): Promise<SignInResult> {
  if (open) {
    open.focus()
    return Promise.resolve('cancelled')
  }
  const ses = session.fromPartition(PARTITION)
  ses.setUserAgent(chromeUserAgent())
  const win = new BrowserWindow({
    width: 520,
    height: 720,
    parent: parent ?? undefined,
    modal: Boolean(parent),
    title: 'Sign in to YouTube',
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  open = win
  // Only Google's and YouTube's own pages here; anything else opens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (allowed(url)) win.loadURL(url)
    else if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!allowed(url)) {
      event.preventDefault()
      if (url.startsWith('https://')) shell.openExternal(url)
    }
  })
  win.loadURL(SIGN_IN_URL, { userAgent: chromeUserAgent() })

  return new Promise((resolve) => {
    let done = false
    const finish = (result: SignInResult) => {
      if (done) return
      done = true
      clearInterval(timer)
      open = null
      if (!win.isDestroyed()) win.close()
      resolve(result)
    }
    const timer = setInterval(async () => {
      if (win.isDestroyed()) return
      const cookies = await ses.cookies.get({})
      if (!isSignedIn(cookies)) return
      clearInterval(timer)
      // Give YouTube a moment to finish setting its cookies, then keep them for yt-dlp.
      setTimeout(async () => {
        const all = (await ses.cookies.get({})).filter(isYouTubeSignInCookie)
        fs.writeFileSync(cookiesFile, toNetscape(all), { encoding: 'utf8', mode: 0o600 })
        finish('signed-in')
      }, 1500)
    }, 1000)
    win.on('closed', () => finish('cancelled'))
  })
}

/** Forget the sign-in: the cookies file and everything the sign-in window stored. */
export async function signOut(cookiesFile: string): Promise<void> {
  try {
    fs.rmSync(cookiesFile, { force: true })
  } finally {
    await session.fromPartition(PARTITION).clearStorageData()
  }
}
