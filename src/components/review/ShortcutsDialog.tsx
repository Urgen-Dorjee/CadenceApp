import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

export const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ['Space'], action: 'Play or pause' },
  { keys: ['←', '→'], action: 'Move the cut 0.1 s (with Shift: 1 s)' },
  { keys: ['[', ']'], action: 'Previous or next cut' },
  { keys: ['H'], action: 'Hear the cut (4 s either side)' },
  { keys: ['↑', '↓'], action: 'Select the previous or next song' },
  { keys: ['Enter'], action: 'Play the selected song' },
  { keys: ['X'], action: 'Include or skip the selected song' },
  { keys: ['S'], action: 'Split the song at the playhead' },
  { keys: ['J'], action: 'Join the selected song with the next' },
  { keys: ['Ctrl', 'Z'], action: 'Undo' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo (or Ctrl+Y)' },
  { keys: ['?'], action: 'Show these shortcuts' },
]

export default function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="panel fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(460px,calc(100vw-32px))] p-5 flex flex-col gap-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <Dialog.Title className="font-display text-base font-semibold">Keyboard shortcuts</Dialog.Title>
              <Dialog.Description className="text-[13px] text-muted mt-1">
                On the review screen, when you're not typing in a field.
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-icon" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <dl className="flex flex-col divide-y divide-line">
            {SHORTCUTS.map(({ keys, action }) => (
              <div key={action} className="flex items-center justify-between gap-4 py-2">
                <dt className="text-[13px]">{action}</dt>
                <dd className="flex items-center gap-1 shrink-0">
                  {keys.map((k) => (
                    <kbd key={k} className="kbd">{k}</kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
