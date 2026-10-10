import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Check } from 'lucide-react'

const CloseMenu = createContext<() => void>(() => {})

/**
 * A button that opens a small menu above it (the player sits at the bottom of the window).
 * Closes on a choice, a click outside or Escape.
 */
export function Menu({
  label, icon, children, active = false, align = 'end', width = 'w-60',
}: { label: string; icon: ReactNode; children: ReactNode; active?: boolean; align?: 'start' | 'end'; width?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    // Move focus into the menu so it works from the keyboard.
    root.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')?.focus()
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        className={clsx('btn-icon', (open || active) && 'text-accent')}
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
      >
        {icon}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={clsx(
            'panel absolute bottom-[calc(100%+8px)] z-40 py-1.5 shadow-2xl animate-slide-up',
            width,
            align === 'end' ? 'right-0' : 'left-0',
          )}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')]
            const at = items.indexOf(document.activeElement as HTMLElement)
            items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
          }}
        >
          <CloseMenu.Provider value={() => setOpen(false)}>{children}</CloseMenu.Provider>
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  icon, children, onSelect, checked, hint, disabled = false,
}: { icon?: ReactNode; children: ReactNode; onSelect: () => void; checked?: boolean; hint?: string; disabled?: boolean }) {
  const close = useContext(CloseMenu)
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        onSelect()
        close()
      }}
      className="w-full flex items-center gap-2.5 px-3 h-8 text-[13px] text-left text-ink hover:bg-raised focus:bg-raised focus:outline-none disabled:opacity-45"
    >
      <span className="w-4 flex justify-center text-muted shrink-0" aria-hidden="true">
        {checked ? <Check size={14} className="text-accent" /> : icon}
      </span>
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-[11px] text-faint tnum">{hint}</span>}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-1.5 pb-1 eyebrow">{children}</p>
}

export function MenuSeparator() {
  return <div className="my-1.5 h-px bg-line" role="separator" />
}
