import * as Dialog from '@radix-ui/react-dialog'
import { Library, Scissors, X } from 'lucide-react'
import type { LinkHistory } from '../services/api'

/** Pasting a link whose songs were saved before (and whose split has left the list). */
export default function SavedBeforeDialog({ history, onShow, onSplitAgain, onClose }: {
  history: LinkHistory | null
  onShow: (paths: string[]) => void
  onSplitAgain: () => void
  onClose: () => void
}) {
  const songs = history?.songs ?? []
  const last = songs.reduce((t, s) => Math.max(t, s.saved_at), 0)
  const when = last ? new Date(last * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  return (
    <Dialog.Root open={Boolean(history)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="panel fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(500px,calc(100vw-32px))] p-5 flex flex-col gap-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <Dialog.Title className="font-display text-base font-semibold">You’ve saved songs from this video</Dialog.Title>
              <Dialog.Description className="text-[13px] text-muted mt-1">
                {songs.length} song{songs.length === 1 ? '' : 's'} from it {songs.length === 1 ? 'is' : 'are'} in your library{when && `, saved on ${when}`}.
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-icon" aria-label="Close"><X size={16} /></Dialog.Close>
          </div>
          <ul className="text-[13px] flex flex-col gap-1 max-h-44 overflow-y-auto rounded-md border border-line bg-sunken/40 px-3 py-2">
            {songs.map((s) => (
              <li key={s.path} className="truncate" title={s.path}>{s.title || s.path.split(/[\\/]/).pop()}</li>
            ))}
          </ul>
          <div className="flex flex-col gap-2">
            <button
              className="text-left rounded-md border border-accent bg-accent/10 px-3 py-2.5 flex gap-3 items-start hover:bg-accent/15 transition-colors"
              onClick={() => onShow(songs.map((s) => s.path))}
              autoFocus
            >
              <Library size={16} className="text-accent mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                <span className="block text-[13px] font-medium">Show them</span>
                <span className="block text-xs text-muted">Open these songs in your library.</span>
              </span>
            </button>
            <button
              className="text-left rounded-md border border-line bg-sunken/40 px-3 py-2.5 flex gap-3 items-start hover:border-line-strong transition-colors"
              onClick={onSplitAgain}
            >
              <Scissors size={16} className="text-muted mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                <span className="block text-[13px] font-medium">Split it again</span>
                <span className="block text-xs text-muted">Download and split the video. Songs you already have come unticked, so only new ones are saved.</span>
              </span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
