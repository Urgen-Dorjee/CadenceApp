import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, X } from 'lucide-react'
import type { LibrarySong, TagChanges } from '../../services/api'

type Field = keyof TagChanges

const FIELDS: { key: Field; label: string; single?: boolean; wide?: boolean }[] = [
  { key: 'title', label: 'Title', single: true, wide: true },
  { key: 'artist', label: 'Singer', wide: true },
  { key: 'album', label: 'Album or movie', wide: true },
  { key: 'album_artist', label: 'Album singer', wide: true },
  { key: 'year', label: 'Year' },
  { key: 'track', label: 'Track', single: true },
]

/** The shared value of a field across songs, or null when they differ. */
function common(songs: LibrarySong[], key: Field): string | null {
  const values = new Set(songs.map((s) => String(key === 'track' ? s.track || '' : s[key] ?? '')))
  return values.size === 1 ? [...values][0] : null
}

/**
 * Edit the tags of one song, or of every song in an album or singer at once. With
 * several songs, fields whose values differ are left alone unless you type in them.
 */
export default function EditTagsDialog({
  songs,
  onClose,
  onSave,
}: {
  songs: LibrarySong[] | null
  onClose: () => void
  onSave: (ids: string[], changes: TagChanges) => Promise<void>
}) {
  const many = (songs?.length ?? 0) > 1
  const [values, setValues] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Set<Field>>(new Set())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!songs) return
    setValues(Object.fromEntries(FIELDS.map((f) => [f.key, common(songs, f.key) ?? ''])))
    setTouched(new Set())
    setError('')
  }, [songs])

  if (!songs) return null
  const fields = FIELDS.filter((f) => !many || !f.single)

  const submit = async () => {
    const changes: TagChanges = {}
    for (const f of fields) {
      if (!touched.has(f.key)) continue
      const v = (values[f.key] ?? '').trim()
      if (f.key === 'track') changes.track = v ? Number(v) : 0
      else changes[f.key] = v
    }
    if (!Object.keys(changes).length) {
      onClose()
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSave(songs.map((s) => s.id), changes)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="panel fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(520px,calc(100vw-32px))] p-5 flex flex-col gap-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <Dialog.Title className="font-display text-base font-semibold">
                {many ? `Edit ${songs.length} songs` : 'Edit song'}
              </Dialog.Title>
              <Dialog.Description className="text-[13px] text-muted mt-1 truncate">
                {many ? 'Changes apply to every song. Fields left as they are stay unchanged.' : songs[0].path}
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-icon" aria-label="Close" disabled={busy}>
              <X size={16} />
            </Dialog.Close>
          </div>
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            {fields.map((f) => {
              const mixed = many && common(songs, f.key) === null && !touched.has(f.key)
              return (
                <label key={f.key} className={`flex flex-col gap-1.5 ${f.wide ? 'col-span-2' : ''}`}>
                  <span className="label">{f.label}</span>
                  <input
                    className="field"
                    value={values[f.key] ?? ''}
                    placeholder={mixed ? 'Several values' : ''}
                    inputMode={f.key === 'year' || f.key === 'track' ? 'numeric' : undefined}
                    maxLength={f.key === 'year' ? 4 : f.key === 'track' ? 3 : 300}
                    onChange={(e) => {
                      const v = f.key === 'year' || f.key === 'track' ? e.target.value.replace(/\D/g, '') : e.target.value
                      setValues((old) => ({ ...old, [f.key]: v }))
                      setTouched((old) => new Set(old).add(f.key))
                    }}
                  />
                </label>
              )
            })}
            {error && (
              <p className="col-span-2 text-[13px] text-danger" role="alert">
                {error}
              </p>
            )}
            <div className="col-span-2 flex items-center justify-end gap-2 pt-1">
              <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy || touched.size === 0}>
                {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                Save tags
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
