import { create } from 'zustand'
import type { Job } from '../types/job'

interface JobsState {
  jobs: Record<string, Job>
  loaded: boolean
  setAll: (jobs: Job[]) => void
  upsert: (job: Job) => void
  remove: (id: string) => void
}

export const useJobsStore = create<JobsState>((set) => ({
  jobs: {},
  loaded: false,
  setAll: (jobs) => set({ jobs: Object.fromEntries(jobs.map((j) => [j.id, j])), loaded: true }),
  upsert: (job) =>
    set((state) => {
      const current = state.jobs[job.id]
      // Messages can arrive out of order; never replace newer data with older.
      if (current && current.updated_at > job.updated_at) return state
      return { jobs: { ...state.jobs, [job.id]: job } }
    }),
  remove: (id) =>
    set((state) => {
      const { [id]: _removed, ...rest } = state.jobs
      return { jobs: rest }
    }),
}))

export function sortedJobs(jobs: Record<string, Job>): Job[] {
  return Object.values(jobs).sort((a, b) => b.created_at - a.created_at)
}
