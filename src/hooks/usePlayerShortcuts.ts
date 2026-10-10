import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { usePlayerStore } from '../stores/playerStore'

/**
 * Keyboard control of the library player, anywhere except while typing, in a dialog,
 * or on the review screen (which has its own player and keys).
 *
 * Space play/pause · ←/→ back/forward 10 s · Shift+←/→ previous/next song · Ctrl+↑/↓ volume ·
 * M mute · S shuffle · R repeat · F the full "Now playing" view
 */
export function usePlayerShortcuts() {
  const { pathname } = useLocation()

  useEffect(() => {
    if (pathname.startsWith('/jobs/')) return
    const onKey = (e: KeyboardEvent) => {
      const player = usePlayerStore.getState()
      if (e.defaultPrevented || player.index < 0 || e.altKey) return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return
      // Dialogs other than "Now playing" keep their own keys.
      const dialog = el.closest('[role="dialog"]')
      if (dialog && dialog.getAttribute('aria-label') !== 'Now playing') return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return

      const mod = e.ctrlKey || e.metaKey
      let handled = true
      if (e.key === ' ' && !mod) {
        if (el.closest('button, a, [role="slider"], [role="tab"]')) return
        player.toggle()
      } else if (e.key === 'ArrowLeft' && !mod) {
        if (e.shiftKey) player.previous()
        else player.skip(-10)
      } else if (e.key === 'ArrowRight' && !mod) {
        if (e.shiftKey) player.next()
        else player.skip(10)
      } else if (mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        player.setVolume(Math.round(Math.min(1, Math.max(0, player.volume + (e.key === 'ArrowUp' ? 0.1 : -0.1))) * 100) / 100)
      } else if (!mod && !e.shiftKey && e.key.length === 1) {
        switch (e.key.toLowerCase()) {
          case 'm':
            player.setVolume(player.volume > 0 ? 0 : 1)
            break
          case 's':
            player.toggleShuffle()
            break
          case 'r':
            player.cycleRepeat()
            break
          case 'f':
            player.setExpanded(!player.expanded)
            break
          default:
            handled = false
        }
      } else handled = false
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pathname])
}
