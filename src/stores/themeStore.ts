import { create } from 'zustand'

export type ThemePreference = 'system' | 'dark' | 'light'

const KEY = 'cadence-theme'

function readSaved(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'system' ? v : 'dark'
  } catch {
    return 'dark'
  }
}

function prefersLight() {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false
}

/** Set data-theme on <html> and tell Electron so the window controls match. */
async function apply(pref: ThemePreference) {
  let dark = pref === 'dark' || (pref === 'system' && !prefersLight())
  if (window.electronAPI) {
    try {
      dark = await window.electronAPI.setTheme(pref)
    } catch {
      /* keep the browser's answer */
    }
  }
  if (dark) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = 'light'
}

interface ThemeState {
  preference: ThemePreference
  setPreference: (pref: ThemePreference) => void
  init: () => () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: readSaved(),
  setPreference: (pref) => {
    try {
      localStorage.setItem(KEY, pref)
    } catch {
      /* not fatal: the theme just won't be remembered */
    }
    set({ preference: pref })
    apply(pref)
  },
  init: () => {
    apply(get().preference)
    const reapply = () => get().preference === 'system' && apply('system')
    return window.electronAPI?.onSystemThemeChange(reapply) ?? (() => {})
  },
}))
