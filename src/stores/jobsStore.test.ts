import { beforeEach, describe, expect, it } from 'vitest'
import type { Job } from '../types/job'
import { sortedJobs, useJobsStore } from './jobsStore'

function job(id: string, created: number, updated: number, extra: Partial<Job> = {}): Job {
  return {
    id, url: `https://youtu.be/${id}`, status: 'queued', progress: 0, message: '', error: null, title: id,
    thumbnail: null, collection: {}, sources: [], tracks: [], outputs: [], destination: '', created_at: created, updated_at: updated, ...extra,
  }
}

describe('jobsStore', () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, loaded: false }))

  it('setAll replaces everything and marks loaded', () => {
    useJobsStore.getState().setAll([job('a', 1, 1), job('b', 2, 2)])
    expect(Object.keys(useJobsStore.getState().jobs)).toEqual(['a', 'b'])
    expect(useJobsStore.getState().loaded).toBe(true)
  })

  it('ignores updates older than what it already has', () => {
    const { upsert } = useJobsStore.getState()
    upsert(job('a', 1, 10, { progress: 50 }))
    upsert(job('a', 1, 5, { progress: 20 }))
    expect(useJobsStore.getState().jobs.a.progress).toBe(50)
    upsert(job('a', 1, 11, { progress: 60 }))
    expect(useJobsStore.getState().jobs.a.progress).toBe(60)
  })

  it('removes jobs', () => {
    useJobsStore.getState().upsert(job('a', 1, 1))
    useJobsStore.getState().remove('a')
    expect(useJobsStore.getState().jobs).toEqual({})
  })

  it('sorts newest first', () => {
    const jobs = { a: job('a', 1, 1), b: job('b', 3, 3), c: job('c', 2, 2) }
    expect(sortedJobs(jobs).map((j) => j.id)).toEqual(['b', 'c', 'a'])
  })
})
