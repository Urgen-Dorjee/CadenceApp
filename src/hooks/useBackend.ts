import { useEffect } from 'react'
import { api, configureApi, SEND_EVENT, websocketUrl } from '../services/api'
import { useAppStore } from '../stores/appStore'
import { useJobsStore } from '../stores/jobsStore'
import { usePrefsStore } from '../stores/prefsStore'
import { useThemeStore } from '../stores/themeStore'
import type { Job } from '../types/job'
import toast from 'react-hot-toast'

/** When a save finishes: refresh disk numbers and, if wanted, show the songs in their folder. */
function onJobChanged(previous: Job | undefined, job: Job) {
  if (previous?.status !== 'exporting' || job.status !== 'completed') return
  usePrefsStore.getState().refreshStorage()
  const first = job.outputs[0]
  if (!first) return
  // When several splits are saved in a row, show the folder once, after the last one.
  const othersSaving = Object.values(useJobsStore.getState().jobs).some((j) => j.id !== job.id && j.status === 'exporting')
  if (usePrefsStore.getState().prefs?.open_when_done && !othersSaving) window.electronAPI?.showItemInFolder(first.path)
  toast.success(job.message || 'Songs saved')
}

const MAX_RECONNECT_DELAY = 15000

/** Connects to the local backend once Electron says it's up, then keeps jobs live over a WebSocket. */
export function useBackend() {
  useEffect(() => useThemeStore.getState().init(), [])

  useEffect(() => {
    const electron = window.electronAPI
    if (!electron) {
      useAppStore
        .getState()
        .setError(
          navigator.userAgent.includes('Electron')
            ? "the window couldn't connect to it (preload script failed to load). Restart Cadence; if it keeps happening, reinstall it."
            : 'Cadence must be opened through the desktop app.',
        )
      return
    }

    let socket: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    let stopped = false

    const connectSocket = () => {
      if (stopped) return
      socket = new WebSocket(websocketUrl())
      socket.onopen = () => {
        attempts = 0
        // Catch up on anything that changed while we were disconnected.
        api.listJobs().then(useJobsStore.getState().setAll).catch(() => {})
      }
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.type === 'job') {
          const previous = useJobsStore.getState().jobs[msg.job.id]
          useJobsStore.getState().upsert(msg.job)
          onJobChanged(previous, msg.job)
        }
        else if (msg.type === 'job_deleted') useJobsStore.getState().remove(msg.job_id)
        else if (msg.type === 'send') window.dispatchEvent(new CustomEvent(SEND_EVENT, { detail: msg }))
      }
      socket.onclose = () => {
        if (stopped) return
        const delay = Math.min(1000 * 2 ** attempts++, MAX_RECONNECT_DELAY)
        retryTimer = setTimeout(connectSocket, delay)
      }
    }

    const start = async () => {
      try {
        const { port, token } = await electron.getBackendInfo()
        if (!port) return // backend not started yet; onBackendReady will call again
        configureApi(port, token)
        const health = await api.health()
        useAppStore.getState().setReady({
          ffmpegAvailable: health.ffmpeg_available,
          ytDlpVersion: health.yt_dlp_version,
        })
        usePrefsStore.getState().load().catch(() => {})
        if (!socket) connectSocket()
      } catch {
        /* not reachable yet; wait for the ready event */
      }
    }

    const offReady = electron.onBackendReady(start)
    const offRestarting = electron.onBackendRestarting(() => useAppStore.getState().setRestarting())
    electron.getUpdateStatus().then((s) => useAppStore.getState().setUpdate(s)).catch(() => {})
    const offUpdate = electron.onUpdateStatus((s) => useAppStore.getState().setUpdate(s))
    const offError = electron.onBackendError((error) => useAppStore.getState().setError(error))
    // The ready event may have fired before this window loaded.
    start()

    return () => {
      stopped = true
      offReady()
      offError()
      offRestarting()
      offUpdate()
      if (retryTimer) clearTimeout(retryTimer)
      socket?.close()
    }
  }, [])
}
