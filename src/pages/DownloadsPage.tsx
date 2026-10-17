import { useNavigate } from 'react-router-dom'
import { Download } from 'lucide-react'
import { sortedJobs, useJobsStore } from '../stores/jobsStore'
import { usePrefsStore } from '../stores/prefsStore'
import { isRunning, isVideoJob, type Job } from '../types/job'
import JobCard from '../components/jobs/JobCard'
import VideoJobCard from '../components/video/VideoJobCard'

function Group({ id, title, jobs }: { id: string; title: string; jobs: Job[] }) {
  if (!jobs.length) return null
  return (
    <section className="flex flex-col gap-2" aria-labelledby={id}>
      <h2 id={id} className="eyebrow">
        {title} <span className="text-faint tnum font-normal ml-1">{jobs.length}</span>
      </h2>
      <div className="panel divide-y divide-line overflow-hidden">
        {jobs.map((job) => (isVideoJob(job) ? <VideoJobCard key={job.id} job={job} /> : <JobCard key={job.id} job={job} showKind />))}
      </div>
    </section>
  )
}

/** Every music split and video download in one list: what's running, waiting and done. */
export default function DownloadsPage() {
  const navigate = useNavigate()
  const jobs = sortedJobs(useJobsStore((s) => s.jobs))
  const atOnce = usePrefsStore((s) => s.prefs?.parallel_splits ?? 2)
  const active = jobs.filter((j) => isRunning(j) && j.status !== 'queued')
  const waiting = jobs.filter((j) => j.status === 'queued' || j.status === 'paused' || j.status === 'review')
  const done = jobs.filter((j) => !active.includes(j) && !waiting.includes(j))

  return (
    <div className="max-w-5xl mx-auto px-8 py-8 flex flex-col gap-7 min-h-full">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-xl font-semibold tracking-tight">Downloads</h1>
        <p className="text-muted">
          Music splits and videos share one list. {atOnce === 1 ? 'One runs at a time' : `${atOnce} run at a time`}; the rest wait
          their turn.
        </p>
      </header>
      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted">
          <Download size={28} className="text-faint" aria-hidden="true" />
          <p>Nothing here yet. Songs you split and videos you download appear here.</p>
          <button className="btn-primary" onClick={() => navigate('/')}>New download</button>
        </div>
      ) : (
        <>
          <Group id="active-head" title="In progress" jobs={active} />
          <Group id="waiting-head" title="Waiting for you or their turn" jobs={waiting} />
          <Group id="done-head" title="Finished" jobs={done} />
        </>
      )}
    </div>
  )
}
