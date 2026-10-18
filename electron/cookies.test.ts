import { describe, expect, it } from 'vitest'
import { isSignedIn, isYouTubeSignInCookie, toNetscape } from './cookies'

describe('YouTube sign-in cookies', () => {
  it('keeps only YouTube and Google cookies', () => {
    expect(isYouTubeSignInCookie({ name: 'a', value: '1', domain: '.youtube.com' })).toBe(true)
    expect(isYouTubeSignInCookie({ name: 'a', value: '1', domain: 'accounts.google.com' })).toBe(true)
    expect(isYouTubeSignInCookie({ name: 'a', value: '1', domain: '.example.com' })).toBe(false)
    expect(isYouTubeSignInCookie({ name: 'a', value: '1', domain: 'notgoogle.com' })).toBe(false)
  })

  it('knows when YouTube has signed in', () => {
    expect(isSignedIn([{ name: 'SID', value: 'x', domain: '.google.com' }])).toBe(false)
    expect(isSignedIn([{ name: 'LOGIN_INFO', value: 'x', domain: '.youtube.com' }])).toBe(true)
  })

  it('writes the cookies.txt format yt-dlp reads', () => {
    const text = toNetscape([
      { name: 'LOGIN_INFO', value: 'abc', domain: '.youtube.com', path: '/', secure: true, httpOnly: true, expirationDate: 1893456000.5 },
      { name: 'PREF', value: 'f6=8', domain: 'www.youtube.com', hostOnly: true, path: '/', secure: false, session: true },
      { name: 'bad', value: 'has\ttab', domain: '.youtube.com' },
    ])
    const lines = text.trim().split('\n')
    expect(lines[0]).toBe('# Netscape HTTP Cookie File')
    expect(lines).toContain('#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1893456000\tLOGIN_INFO\tabc')
    expect(lines).toContain('www.youtube.com\tFALSE\t/\tFALSE\t0\tPREF\tf6=8')
    expect(text).not.toContain('bad')
  })
})
