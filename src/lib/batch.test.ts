import { describe, expect, it } from 'vitest'
import type { Job, Track } from '../types/job'
import { newLinks, readyToSave, youtubeLinks } from './batch'

describe('youtubeLinks', () => {
  it('finds one link per line', () => {
    const text = 'https://www.youtube.com/watch?v=aaa\nhttps://youtu.be/bbb\n\nhttps://music.youtube.com/playlist?list=ccc'
    expect(youtubeLinks(text)).toEqual([
      'https://www.youtube.com/watch?v=aaa',
      'https://youtu.be/bbb',
      'https://music.youtube.com/playlist?list=ccc',
    ])
  })

  it('splits links that pasting into one line joined together', () => {
    expect(youtubeLinks('https://youtu.be/aaahttps://youtu.be/bbb https://youtu.be/ccc')).toEqual([
      'https://youtu.be/aaa',
      'https://youtu.be/bbb',
      'https://youtu.be/ccc',
    ])
  })

  it('ignores other sites, punctuation and repeats', () => {
    const text = 'Watch (https://youtu.be/aaa), then https://vimeo.com/1 and https://youtu.be/aaa.'
    expect(youtubeLinks(text)).toEqual(['https://youtu.be/aaa'])
  })

  it('returns nothing for plain text', () => {
    expect(youtubeLinks('not a link')).toEqual([])
  })
})

const track = (patch: Partial<Track> = {}): Track => ({
  id: Math.random().toString(16),
  title: 'Song',
  artist: '',
  start: 0,
  end: 100,
  source_id: 's',
  origin: 'chapters',
  confidence: 0.95,
  include: true,
  ...patch,
})

const job = (patch: Partial<Job>): Job => ({
  id: 'j',
  url: 'https://youtu.be/x',
  status: 'review',
  progress: 100,
  message: '',
  error: null,
  title: 'T',
  thumbnail: null,
  collection: { type: 'album', name: 'A', artist: '', album: 'A', year: '' },
  sources: [{ id: 's', title: '', url: '', duration: 100, path: 'a.webm', thumbnail: null }],
  tracks: [track()],
  outputs: [],
  destination: '',
  created_at: 0,
  updated_at: 0,
  ...patch,
})

describe('newLinks', () => {
  it('skips links already being split or saved, but allows retrying failed ones', () => {
    const jobs = [
      job({ url: 'https://youtu.be/a', status: 'analyzing' }),
      job({ url: 'https://youtu.be/b', status: 'failed' }),
    ]
    expect(newLinks(['https://youtu.be/a', 'https://youtu.be/b', 'https://youtu.be/c'], jobs)).toEqual([
      'https://youtu.be/b',
      'https://youtu.be/c',
    ])
  })
})

describe('readyToSave', () => {
  it('separates confident splits from ones with cuts to check', () => {
    const sure = job({ id: 'sure' })
    const unsure = job({ id: 'unsure', tracks: [track(), track({ confidence: 0.5 })] })
    const unsureButSkipped = job({ id: 'skipped', tracks: [track(), track({ confidence: 0.5, include: false })] })
    const { ready, toCheck } = readyToSave([sure, unsure, unsureButSkipped])
    expect(ready.map((j) => j.id)).toEqual(['sure', 'skipped'])
    expect(toCheck.map((j) => j.id)).toEqual(['unsure'])
  })

  it('leaves out splits that are running, saved, empty or whose audio was removed', () => {
    const jobs = [
      job({ id: 'running', status: 'analyzing' }),
      job({ id: 'saved', status: 'completed' }),
      job({ id: 'empty', tracks: [track({ include: false })] }),
      job({ id: 'removed', sources: [{ id: 's', title: '', url: '', duration: 100, path: '', thumbnail: null }] }),
    ]
    expect(readyToSave(jobs)).toEqual({ ready: [], toCheck: [] })
  })
})
