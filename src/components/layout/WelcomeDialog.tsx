import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { clsx } from 'clsx'
import { FolderOpen, ListMusic, Loader2, Scissors, SlidersHorizontal } from 'lucide-react'
import type { Preferences } from '../../types/job'

export type WelcomeChoices = Pick<Preferences, 'library_dir' | 'audio_format' | 'loudness'>

const FORMATS: { value: Preferences['audio_format']; label: string; note: string }[] = [
  { value: 'mp3', label: 'MP3', note: 'Plays on everything' },
  { value: 'original', label: 'Original', note: 'No quality lost, small files' },
  { value: 'flac', label: 'FLAC', note: 'Lossless, large files' },
]

const STEPS = [
  { icon: ListMusic, text: 'Paste a YouTube link or open a file. Cadence finds where every song starts.' },
  { icon: Scissors, text: 'Check the songs and cuts. Anything uncertain is marked “Check”.' },
  { icon: FolderOpen, text: 'Save. Songs are tagged, given cover art and filed into your library.' },
]

/** First launch: where songs go, which format, and how a split works. Everything can be changed later in Settings. */
export default function WelcomeDialog({
  initial,
  onFinish,
}: {
  initial: WelcomeChoices
  onFinish: (choices: WelcomeChoices) => Promise<void>
}) {
  const [choices, setChoices] = useState<WelcomeChoices>(initial)
  const [busy, setBusy] = useState(false)

  const chooseFolder = async () => {
    const folder = await window.electronAPI?.selectFolder({ defaultPath: choices.library_dir, title: 'Save songs to' })
    if (folder) setChoices((c) => ({ ...c, library_dir: folder }))
  }

  const finish = async () => {
    setBusy(true)
    try {
      await onFinish(choices)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          className="panel fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(560px,calc(100vw-32px))] max-h-[calc(100vh-48px)] overflow-y-auto p-6 flex flex-col gap-5 shadow-2xl"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div>
            <Dialog.Title className="font-display text-lg font-semibold">Welcome to Cadence</Dialog.Title>
            <Dialog.Description className="text-[13px] text-muted mt-1">
              Split jukeboxes, movie albums and singer collections into separate, tagged songs. Two quick choices and you're
              ready. You can change both later in Settings.
            </Dialog.Description>
          </div>

          <ol className="flex flex-col gap-2.5">
            {STEPS.map(({ icon: Icon, text }, i) => (
              <li key={i} className="flex items-start gap-3 text-[13px]">
                <span className="w-6 h-6 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
                  <Icon size={13} aria-hidden="true" />
                </span>
                <span className="pt-0.5">{text}</span>
              </li>
            ))}
          </ol>

          <section className="flex flex-col gap-2">
            <h3 className="label">Save songs to</h3>
            <div className="flex items-center gap-2 rounded-md bg-sunken border border-line px-3 py-2">
              <span className="flex-1 min-w-0 font-mono text-[12px] truncate" title={choices.library_dir}>{choices.library_dir}</span>
              <button className="btn-secondary h-7 px-2.5" onClick={chooseFolder}>Change…</button>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="label">Format</h3>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Format">
              {FORMATS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={choices.audio_format === f.value}
                  onClick={() => setChoices((c) => ({ ...c, audio_format: f.value }))}
                  className={clsx(
                    'text-left rounded-md border px-3 py-2 transition-colors',
                    choices.audio_format === f.value ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong bg-sunken/40',
                  )}
                >
                  <span className="block text-[13px] font-medium">{f.label}</span>
                  <span className="block text-xs text-muted">{f.note}</span>
                </button>
              ))}
            </div>
          </section>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 w-4 h-4 accent-[rgb(var(--accent))]"
              checked={choices.loudness === 'tags'}
              onChange={(e) => setChoices((c) => ({ ...c, loudness: e.target.checked ? 'tags' : 'off' }))}
            />
            <span className="text-[13px]">
              <span className="flex items-center gap-1.5 font-medium">
                <SlidersHorizontal size={13} aria-hidden="true" /> Even out loudness
              </span>
              <span className="block text-xs text-muted">
                Songs from different sources play at the same volume (ReplayGain tags; the audio itself isn't changed).
              </span>
            </span>
          </label>

          <button className="btn-primary h-10 text-[14px]" onClick={finish} disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            Start splitting
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
