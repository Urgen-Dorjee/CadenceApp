/** The parts of an Electron cookie that a cookies.txt file needs. */
export interface CookieLike {
  name: string
  value: string
  domain?: string
  hostOnly?: boolean
  path?: string
  secure?: boolean
  httpOnly?: boolean
  session?: boolean
  expirationDate?: number
}

/** Cookies from these sites are what YouTube downloads need (YouTube and the Google sign-in). */
export function isYouTubeSignInCookie(c: CookieLike): boolean {
  const domain = (c.domain ?? '').replace(/^\./, '').toLowerCase()
  return domain === 'youtube.com' || domain.endsWith('.youtube.com') || domain === 'google.com' || domain.endsWith('.google.com')
}

/** True once YouTube has signed the browser in (it sets LOGIN_INFO on youtube.com). */
export function isSignedIn(cookies: CookieLike[]): boolean {
  return cookies.some((c) => c.name === 'LOGIN_INFO' && /(^|\.)youtube\.com$/i.test((c.domain ?? '').replace(/^\./, '')))
}

/**
 * Cookies in the Netscape cookies.txt format that yt-dlp reads (and keeps up to date).
 * HttpOnly cookies are written with yt-dlp's "#HttpOnly_" prefix; session cookies never expire here.
 */
export function toNetscape(cookies: CookieLike[]): string {
  const lines = ['# Netscape HTTP Cookie File', '# Written by Cadence for YouTube downloads. Keep it private: it signs in as you.', '']
  for (const c of cookies) {
    if (!c.domain || /[\t\n\r]/.test(c.name + c.value)) continue
    const subdomains = !c.hostOnly && c.domain.startsWith('.')
    const domain = (c.httpOnly ? '#HttpOnly_' : '') + c.domain
    const expiry = c.session || !c.expirationDate ? 0 : Math.floor(c.expirationDate)
    lines.push([domain, subdomains ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', String(expiry), c.name, c.value].join('\t'))
  }
  return lines.join('\n') + '\n'
}
