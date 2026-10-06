import * as Dialog from '@radix-ui/react-dialog'
import { CopyPlus, RefreshCw, X } from 'lucide-react'

/** Saving a split that was saved before: replace last time's songs, or keep both. */
export default function SaveAgainDialog({
  open,
  onOpenChange,
  savedCount,
  onChoose,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  savedCount: number
  onChoose: (replace: boolean) => void
}) {
  const choose = (replace: boolean) => {
    onOpenChange(false)
    onChoose(replace)
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="panel fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(480px,calc(100vw-32px))] p-5 flex flex-col gap-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <Dialog.Title className="font-display text-base font-semibold">Save this split again</Dialog.Title>
              <Dialog.Description className="text-[13px] text-muted mt-1">
                {savedCount} song{savedCount === 1 ? ' was' : 's were'} saved from this split before.
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-icon" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="flex flex-col gap-2">
            <button
              className="text-left rounded-md border border-accent bg-accent/10 px-3 py-2.5 flex gap-3 items-start hover:bg-accent/15 transition-colors"
              onClick={() => choose(true)}
              autoFocus
            >
              <RefreshCw size={16} className="text-accent mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                <span className="block text-[13px] font-medium">Replace them</span>
                <span className="block text-xs text-muted">
                  The songs saved last time are overwritten. Any that are no longer in this split go to the Recycle Bin.
                </span>
              </span>
            </button>
            <button
              className="text-left rounded-md border border-line bg-sunken/40 px-3 py-2.5 flex gap-3 items-start hover:border-line-strong transition-colors"
              onClick={() => choose(false)}
            >
              <CopyPlus size={16} className="text-muted mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                <span className="block text-[13px] font-medium">Keep both</span>
                <span className="block text-xs text-muted">Saves new copies next to them, named like “Song (2)”.</span>
              </span>
            </button>
          </div>
          <p className="text-xs text-faint">Other files in your library are never overwritten.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
