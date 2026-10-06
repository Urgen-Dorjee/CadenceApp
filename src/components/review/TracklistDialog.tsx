import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { FileText, Loader2, X } from 'lucide-react'

const EXAMPLE = `0:00 Tujhe Dekha To
5:03 Mere Khwabon Mein
10:21 Ho Gaya Hai Tujhko`

/** Paste a tracklist or open a .cue file. `onImport` throws to keep the dialog open with its message. */
export default function TracklistDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (text: string) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const submit = async (value = text) => {
    if (!value.trim()) return
    setBusy(true)
    setError('')
    try {
      await onImport(value)
      setText('')
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openFile = async (file: File | undefined) => {
    if (!file) return
    const content = await file.text()
    setText(content)
    await submit(content)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="panel fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(560px,calc(100vw-32px))] p-5 flex flex-col gap-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <Dialog.Title className="font-display text-base font-semibold">Use your own tracklist</Dialog.Title>
              <Dialog.Description className="text-[13px] text-muted mt-1">
                One song per line with its start time, or with its length (lengths are added up). A .cue file also brings
                the singers, album and year. Each cut still moves to the real gap between songs.
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-icon" aria-label="Close" disabled={busy}>
              <X size={16} />
            </Dialog.Close>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="label">Tracklist</span>
            <textarea
              className="field h-56 py-2 font-mono leading-relaxed resize-y"
              placeholder={EXAMPLE}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
              }}
              spellCheck={false}
              autoFocus
            />
          </label>
          {error && (
            <p className="text-[13px] text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".cue,.txt"
              className="hidden"
              onChange={(e) => {
                openFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <button className="btn-secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
              <FileText size={14} aria-hidden="true" /> Open .cue file…
            </button>
            <div className="flex-1" />
            <button className="btn-ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </button>
            <button className="btn-primary" onClick={() => submit()} disabled={busy || !text.trim()}>
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {busy ? 'Finding the cuts…' : 'Use tracklist'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
