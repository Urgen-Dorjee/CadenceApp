import { create } from 'zustand'
import { api, type StorageInfo } from '../services/api'
import type { Preferences } from '../types/job'

interface PrefsState {
  prefs: Preferences | null
  storage: StorageInfo | null
  load: () => Promise<void>
  /** Save a change; returns the saved preferences or throws with the server's message. */
  update: (patch: Partial<Preferences>) => Promise<Preferences>
  refreshStorage: () => Promise<void>
}

export const usePrefsStore = create<PrefsState>((set, get) => ({
  prefs: null,
  storage: null,
  load: async () => {
    const [prefs, storage] = await Promise.all([api.getPreferences(), api.storage().catch(() => null)])
    set({ prefs, storage })
  },
  update: async (patch) => {
    const current = get().prefs
    if (!current) throw new Error('Settings are still loading')
    const optimistic = { ...current, ...patch }
    set({ prefs: optimistic })
    try {
      const saved = await api.savePreferences(optimistic)
      set({ prefs: saved })
      if ('library_dir' in patch) get().refreshStorage()
      return saved
    } catch (e) {
      set({ prefs: current })
      throw e
    }
  },
  refreshStorage: async () => {
    try {
      set({ storage: await api.storage() })
    } catch {
      /* keep the last known numbers */
    }
  },
}))

export function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(0, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(bytes / 1024 ** 3).toFixed(bytes < 100 * 1024 ** 3 ? 1 : 0)} GB`
}

/** "C:\Users\me\Music\Cadence" -> "…\Music\Cadence" for tight spaces. */
export function shortPath(path: string, keep = 2): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  if (parts.length <= keep + 1) return path
  const sep = path.includes('\\') ? '\\' : '/'
  return `…${sep}${parts.slice(-keep).join(sep)}`
}
