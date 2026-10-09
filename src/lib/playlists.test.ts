import { describe, expect, it } from 'vitest'
import { defaultMode, defaultSelection, hasVideo, linkKind, type ListedLink, type ListedVideo } from './playlists'

const video = (id: string, minutes: number, state: ListedVideo['state'] = ''): ListedVideo => ({
  id, url: `https://www.youtube.com/watch?v=${id}`, title: id, duration: minutes * 60, state,
})

describe('linkKind', () => {
  it('recognises videos, playlists and channels', () => {
    expect(linkKind('https://www.youtube.com/watch?v=abc')).toBe('video')
    expect(linkKind('https://youtu.be/abc')).toBe('video')
    expect(linkKind('https://www.youtube.com/playlist?list=PLx')).toBe('playlist')
    expect(linkKind('https://www.youtube.com/watch?v=abc&list=PLx')).toBe('playlist')
    expect(linkKind('https://www.youtube.com/@SaregamaMusic')).toBe('channel')
    expect(linkKind('https://www.youtube.com/@SaregamaMusic/videos')).toBe('channel')
    expect(linkKind('https://www.youtube.com/channel/UCabc')).toBe('channel')
    expect(linkKind('not a link')).toBe('video')
  })
  it('knows when a playlist link points at one video', () => {
    expect(hasVideo('https://www.youtube.com/watch?v=abc&list=PLx')).toBe(true)
    expect(hasVideo('https://www.youtube.com/playlist?list=PLx')).toBe(false)
  })
})

describe('defaultMode', () => {
  const listed = (kind: ListedLink['kind'], minutes: number[]): ListedLink => ({
    kind, title: 't', entries: minutes.map((m, i) => video(String(i), m)),
  })
  it('splits each video when most are long', () => {
    expect(defaultMode(listed('playlist', [60, 45, 4]))).toBe('each')
  })
  it('makes one album when most videos are single songs', () => {
    expect(defaultMode(listed('playlist', [4, 5, 90]))).toBe('album')
  })
  it('always splits each video of a channel', () => {
    expect(defaultMode(listed('channel', [3, 4]))).toBe('each')
  })
})

describe('defaultSelection', () => {
  const entries = [video('new', 60), video('short', 4), video('saved', 60, 'saved'), video('listed', 60, 'in_list')]
  it('leaves out videos done before', () => {
    expect([...defaultSelection(entries, false)]).toEqual(['new', 'short'])
  })
  it('keeps only long videos when asked', () => {
    expect([...defaultSelection(entries, true)]).toEqual(['new'])
  })
})
