import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useJobsStore } from '../../stores/jobsStore'
import { isRunning } from '../../types/job'

const CLOSE_AFTER_MS = 2500

/**
 * After "Restart to update": says what is about to happen (Cadence closes, a small progress
 * window installs the update, Cadence opens again), so the closing window and Windows'
 * permission prompt don't look like something went wrong. Splits still working need a yes first.
 */
export default function UpdateOverlay() {
  const installing = useAppStore((s) => s.installing)
  const version = useAppStore((s) => s.update.version)
  const busy = useJobsStore((s) => Object.values(s.jobs).filter((j) => isRunning(j)).length)
  const [confirmed, setConfirmed] = useState(false)
  const waiting = installing && busy > 0 && !confirmed

  useEffect(() => {
    if (!installing || waiting) return
    const timer = setTimeout(() => window.electronAPI?.installUpdate(), CLOSE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [installing, waiting])

  useEffect(() => {
    if (!installing) setConfirmed(false)
  }, [installing])

  if (!installing) return null
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-canvas/90 backdrop-blur-sm" role="alertdialog" aria-labelledby="update-title" aria-describedby="update-steps">
      <div className="w-[420px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-raised p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-10 h-10 rounded-full bg-accent/15 text-accent">
            {waiting ? <RefreshCw size={18} aria-hidden="true" /> : <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
          </span>
          <h2 id="update-title" className="text-base font-semibold">Updating to Cadence {version}</h2>
        </div>
        <ol id="update-steps" className="mt-4 space-y-2 text-[13px] text-muted list-decimal pl-5">
          <li>Cadence closes.</li>
          <li>
            A small <span className="text-ink">Installing Cadence</span> window shows the progress (about half a minute).
            If Windows asks whether to allow changes, choose <span className="text-ink">Yes</span>.
          </li>
          <li>Cadence opens again by itself, with your songs and settings as they were.</li>
        </ol>
        {waiting ? (
          <>
            <p className="mt-4 text-[13px] text-warn">
              {busy === 1 ? '1 split is' : `${busy} splits are`} still working and will stop. You can start {busy === 1 ? 'it' : 'them'} again afterwards.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => useAppStore.getState().setInstalling(false)}>Later</button>
              <button className="btn-primary" onClick={() => setConfirmed(true)}>Update now</button>
            </div>
          </>
        ) : (
          <p className="mt-4 text-xs text-faint">Closing Cadence…</p>
        )}
      </div>
    </div>
  )
}
