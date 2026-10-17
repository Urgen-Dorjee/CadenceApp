import { describe, expect, it } from 'vitest'
import { formatSize, isCourse, nearestQuality, optionsSummary } from './video'
import { newLinks } from './batch'
import type { Job } from '../types/job'

describe('nearestQuality', () => {
  it('keeps the chosen quality when the video has it', () => {
    expect(nearestQuality('1080', ['2160', '1080', '720', 'audio'])).toBe('1080')
  })
  it('steps down, never up, when it does not', () => {
    expect(nearestQuality('1080', ['720', '480', 'audio'])).toBe('720')
    expect(nearestQuality('480', ['1080', '720', 'audio'])).toBe('720')
  })
  it('falls back to Best available for a video with only low qualities', () => {
    expect(nearestQuality('1080', ['best', 'audio'])).toBe('best')
    expect(nearestQuality('720', ['best', '480', 'audio'])).toBe('480')
  })
  it('takes the highest for best', () => {
    expect(nearestQuality('best', ['1440', '1080', 'audio'])).toBe('1440')
  })
})

describe('labels', () => {
  it('formats sizes', () => {
    expect(formatSize(820 * 1024 ** 2)).toBe('820 MB')
    expect(formatSize(3.1 * 1024 ** 3)).toBe('3.1 GB')
    expect(formatSize(0)).toBe('')
  })
  it('summarises the choices', () => {
    expect(optionsSummary({ quality: '1080', container: 'mp4', subtitles: ['en', 'hi'] })).toBe('1080p MP4 · English, Hindi subtitles')
    expect(optionsSummary({ quality: '2160', container: 'mkv', subtitles: [] })).toBe('4K MKV')
    expect(optionsSummary({ quality: 'audio', subtitles: ['en'] })).toBe('Sound only (M4A)')
  })
  it('tells a course from one video', () => {
    expect(isCourse({ url: 'https://www.youtube.com/playlist?list=PL123' })).toBe(true)
    expect(isCourse({ url: 'https://www.youtube.com/@someschool' })).toBe(true)
    expect(isCourse({ url: 'https://www.youtube.com/watch?v=abc' })).toBe(false)
  })
})

describe('newLinks', () => {
  const job = (url: string, kind: 'music' | 'video') => ({ url, kind, status: 'completed' }) as Job
  it('lets a link split into songs also be downloaded as a video', () => {
    const jobs = [job('https://youtu.be/a', 'music')]
    expect(newLinks(['https://youtu.be/a'], jobs, 'video')).toEqual(['https://youtu.be/a'])
    expect(newLinks(['https://youtu.be/a'], jobs, 'music')).toEqual([])
  })
})
