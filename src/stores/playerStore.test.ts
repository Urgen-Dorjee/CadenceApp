import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibrarySong } from '../services/api'
import { usePlayerStore } from './playerStore'

const song = (id: string): LibrarySong => ({
  id, path: `/m/${id}.mp3`, title: id.toUpperCase(), artist: '', album: '', album_artist: '', year: '', track: 0,
  duration: 200, format: 'mp3', has_cover: 0, added_at: 0,
})
const ids = () => usePlayerStore.getState().queue.map((s) => s.id)
const currentId = () => usePlayerStore.getState().current()?.id

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  usePlayerStore.getState().close()
  usePlayerStore.setState({ repeat: 'off', shuffle: false })
})

describe('player queue', () => {
  it('plays next and adds to the end', () => {
    const p = usePlayerStore.getState()
    p.playList([song('a'), song('b')], 0)
    p.playNext([song('x')])
    p.addToQueue([song('z')])
    expect(ids()).toEqual(['a', 'x', 'b', 'z'])
    p.next()
    expect(currentId()).toBe('x')
  })

  it('starts playing when queueing into an empty player', () => {
    usePlayerStore.getState().addToQueue([song('a'), song('b')])
    expect(currentId()).toBe('a')
  })

  it('repeats one song when it ends, but Next still skips', () => {
    const p = usePlayerStore.getState()
    p.playList([song('a'), song('b')], 0)
    usePlayerStore.setState({ repeat: 'one' })
    p.next(true)
    expect(currentId()).toBe('a')
    p.next()
    expect(currentId()).toBe('b')
  })

  it('wraps around with repeat all', () => {
    const p = usePlayerStore.getState()
    p.playList([song('a'), song('b')], 1)
    usePlayerStore.setState({ repeat: 'all' })
    p.next(true)
    expect(currentId()).toBe('a')
  })

  it('shuffles around the current song and restores the order', () => {
    const p = usePlayerStore.getState()
    const songs = ['a', 'b', 'c', 'd', 'e'].map(song)
    p.playList(songs, 2)
    p.toggleShuffle()
    expect(currentId()).toBe('c')
    expect(usePlayerStore.getState().index).toBe(0)
    expect([...ids()].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    p.toggleShuffle()
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(currentId()).toBe('c')
  })

  it('keeps "play next" songs next after shuffle is turned off', () => {
    const p = usePlayerStore.getState()
    p.playList(['a', 'b', 'c', 'd'].map(song), 1)
    p.playNext([song('x')])
    p.toggleShuffle()
    p.toggleShuffle()
    expect(ids()).toEqual(['a', 'b', 'x', 'c', 'd'])
    expect(currentId()).toBe('b')
  })

  it('removes songs, moving on when the current one is removed', () => {
    const p = usePlayerStore.getState()
    p.playList(['a', 'b', 'c'].map(song), 1)
    p.removeFromQueue(0)
    expect(ids()).toEqual(['b', 'c'])
    expect(currentId()).toBe('b')
    p.removeFromQueue(0)
    expect(currentId()).toBe('c')
    p.removeFromQueue(0)
    expect(usePlayerStore.getState().index).toBe(-1)
  })

  it('clears what comes next', () => {
    const p = usePlayerStore.getState()
    p.playList(['a', 'b', 'c'].map(song), 0)
    p.clearUpcoming()
    expect(ids()).toEqual(['a'])
  })
})

describe('speed, sleep timer and Now playing', () => {
  it('remembers the speed and applies it to each new song', () => {
    const p = usePlayerStore.getState()
    p.playList([song('a'), song('b')], 0)
    p.setRate(1.25)
    p.next()
    expect(usePlayerStore.getState().rate).toBe(1.25)
    expect(JSON.parse(localStorage.getItem('cadence.player') || '{}').rate).toBe(1.25)
    p.setRate(1)
  })

  it('sets and clears a sleep timer', () => {
    const p = usePlayerStore.getState()
    p.playList([song('a')], 0)
    const before = Date.now()
    p.setSleep(30)
    const sleep = usePlayerStore.getState().sleep
    expect(sleep !== null && sleep !== 'end' && sleep.until).toBeGreaterThanOrEqual(before + 30 * 60_000)
    p.setSleep('end')
    expect(usePlayerStore.getState().sleep).toBe('end')
    p.close()
    expect(usePlayerStore.getState().sleep).toBeNull()
  })

  it('opens Now playing only while something is queued', () => {
    const p = usePlayerStore.getState()
    p.setExpanded(true)
    expect(usePlayerStore.getState().expanded).toBe(false)
    p.playList([song('a')], 0)
    p.setExpanded(true)
    expect(usePlayerStore.getState().expanded).toBe(true)
    p.close()
    expect(usePlayerStore.getState().expanded).toBe(false)
  })
})
