import { describe, expect, it } from 'vitest'
import type { LibraryVideo } from '../services/api'
import { chapterAt, clock, courseOf, isWatched, resumeAt, watchedFraction } from './videoPlayer'

const video = (over: Partial<LibraryVideo>): LibraryVideo => ({
  path: 'x', video_id: '', title: '', channel: 'School', playlist: '', playlist_index: 0, duration: 600, height: 720,
  ext: 'mp4', size: 0, subtitles: [], thumbnail: '', saved_at: 0, key: 'k', position: 0, ...over,
})

describe('video player', () => {
  it('carries on from where a video was left, but not from its first seconds or its end', () => {
    expect(resumeAt(125, 600)).toBe(125)
    expect(resumeAt(4, 600)).toBe(0)
    expect(resumeAt(590, 600)).toBe(0)
  })

  it('counts a video as watched near its end', () => {
    expect(isWatched(575, 600)).toBe(true)
    expect(isWatched(300, 600)).toBe(false)
    expect(isWatched(9600, 10000)).toBe(true) // 96% of a long video
    expect(watchedFraction(150, 600)).toBe(0.25)
    expect(watchedFraction(590, 600)).toBe(1)
    expect(watchedFraction(0, 600)).toBe(0)
  })

  it('finds the chapter playing', () => {
    const chapters = [{ start: 0, end: 60, title: 'Intro' }, { start: 60, end: 300, title: 'Vectors' }]
    expect(chapterAt(chapters, 30)).toBe(0)
    expect(chapterAt(chapters, 60)).toBe(1)
    expect(chapterAt([], 10)).toBe(-1)
  })

  it('lists a course in order, and a single video on its own', () => {
    const a = video({ path: 'a', playlist: 'Course', playlist_index: 2 })
    const b = video({ path: 'b', playlist: 'Course', playlist_index: 1 })
    const other = video({ path: 'c', playlist: 'Course', channel: 'Elsewhere' })
    expect(courseOf([a, b, other], a).map((v) => v.path)).toEqual(['b', 'a'])
    const single = video({ path: 's' })
    expect(courseOf([a, single], single)).toEqual([single])
  })

  it('shows a clock without tenths', () => {
    expect(clock(65.9)).toBe('1:05')
    expect(clock(3723)).toBe('1:02:03')
  })
})
