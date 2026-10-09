import { useEffect, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { clsx } from 'clsx'
import { FolderOpen, HardDrive, Loader2, Music, X } from 'lucide-react'
import { api, SEND_EVENT, type LibrarySong, type SendProgress } from '../../services/api'
import { fileManagerName } from '../../lib/platform'

type Target = 'folder' | 'music_app'

/**
 * Copy songs to a folder or drive (USB stick, SD card, a phone's sync folder), optionally as
 * MP3, or into Apple Music / iTunes. The songs in the library aren't changed.
 */
export default function SendDialog({ songs, onClose }: { songs: LibrarySong[] | null; onClose: () => void }) {
  const [target, setTarget] = useState<Target>('folder')
  const [folder, setFolder] = useState('')
  const [layout, setLayout] = useState<'folders' | 'flat'>('folders')
  const [toMp3, setToMp3] = useState(false)
  const [musicApp, setMusicApp] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [progress, setProgress] = useState<SendProgress | null>(null)
  const [error, setError] = useState('')

  const open = Boolean(songs)
  const running = Boolean(taskId) && !progress?.finished

  useEffect(() => {
    if (!open) return
    setTaskId(null)
    setProgress(null)
    setError('')
    api.musicApp().then((r) => setMusicApp(r.name)).catch(() => setMusicApp(null))
  }, [open])

  useEffect(() => {
    if (!taskId) return
    const onProgress = (e: Event) => {
      const p = (e as CustomEvent<SendProgress>).detail
      if (p.task_id === taskId) setProgress(p)
    }
    window.addEventListener(SEND_EVENT, onProgress)
    return () => window.removeEventListener(SEND_EVENT, onProgress)
  }, [taskId])

  const chooseFolder = async () => {
    const picked = await window.electronAPI?.selectFolder({ title: 'Copy songs to' })
    if (picked) setFolder(picked)
  }

  const start = async () => {
    if (!songs) return
    setError('')
    try {
      const r = await api.sendSongs({
        ids: songs.map((s) => s.id),
        target,
        destination: folder,
        layout,
        to_mp3: toMp3,
      })
      setProgress({ task_id: r.task_id, done: 0, total: r.total, copied: 0, skipped: 0, failed: 0, destination: r.destination })
      setTaskId(r.task_id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const needsMp3 = songs?.some((s) => !['mp3', 'm4a'].includes(s.format)) ?? false
  const count = songs?.length ?? 0
  const what = count === 1 ? `“${songs![0].title}”` : `${count} songs`

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="panel fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(560px,calc(100vw-32px))] p-5 flex flex-col gap-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <Dialog.Title className="font-display text-base font-semibold truncate">Send {what}</Dialog.Title>
              <Dialog.Description className="text-[13px] text-muted mt-1">
                Copies go to a phone, USB drive, SD card or music app. The songs in your library stay as they are.
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-icon" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>

          {!taskId && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Send to">
                <TargetButton
                  active={target === 'folder'}
                  onClick={() => setTarget('folder')}
                  icon={<HardDrive size={15} />}
                  label="A folder or drive"
                  hint="USB stick, SD card, a phone's music folder or a synced folder"
                />
                <TargetButton
                  active={target === 'music_app'}
                  onClick={() => setTarget('music_app')}
                  icon={<Music size={15} />}
                  label={musicApp ? musicApp : 'Apple Music / iTunes'}
                  hint={musicApp ? `Adds them to ${musicApp}, ready to sync to an iPhone` : "Not installed on this computer"}
                  disabled={!musicApp}
                />
              </div>

              {target === 'folder' && (
                <div className="flex flex-col gap-3 text-[13px]">
                  <div className="flex items-center gap-3 rounded-md bg-sunken border border-line px-3 py-2">
                    <FolderOpen size={15} className="shrink-0 text-muted" aria-hidden="true" />
                    <p className={clsx('flex-1 min-w-0 truncate', folder ? 'font-mono text-[12px]' : 'text-muted')} title={folder}>
                      {folder || 'No folder chosen'}
                    </p>
                    <button className="btn-secondary h-7 px-2.5" onClick={chooseFolder}>
                      Choose…
                    </button>
                  </div>
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="label mb-1">Arrange them</legend>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="layout" checked={layout === 'folders'} onChange={() => setLayout('folders')} />
                      In folders: Singer / Album / 01 Song
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="layout" checked={layout === 'flat'} onChange={() => setLayout('flat')} />
                      All in one folder: Singer - Song
                    </label>
                  </fieldset>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-0.5" checked={toMp3} onChange={(e) => setToMp3(e.target.checked)} />
                    <span>
                      Convert to MP3
                      <span className="block text-xs text-muted">For car stereos and older players. Tags and covers are kept.</span>
                    </span>
                  </label>
                </div>
              )}
              {target === 'music_app' && needsMp3 && (
                <p className="text-xs text-muted">Songs in FLAC or Opus are converted to MP3, which {musicApp} can play.</p>
              )}
            </>
          )}

          {progress && (
            <div className="flex flex-col gap-2 text-[13px]" aria-live="polite">
              <div className="h-1.5 rounded-full bg-sunken overflow-hidden">
                <div
                  className="h-full bg-accent transition-[width]"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
              {progress.finished ? (
                <p>
                  Copied {progress.copied} song{progress.copied === 1 ? '' : 's'}
                  {progress.skipped ? `, ${progress.skipped} already there` : ''}
                  {progress.failed ? `, ${progress.failed} couldn't be copied` : ''}.
                </p>
              ) : (
                <p className="text-muted truncate">
                  {progress.done} of {progress.total}
                  {progress.current ? ` · ${progress.current}` : ''}
                </p>
              )}
              {progress.errors?.map((e) => (
                <p key={e} className="text-xs text-danger">
                  {e}
                </p>
              ))}
            </div>
          )}

          {error && (
            <p className="text-[13px] text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <div className="flex-1" />
            {progress?.finished && progress.destination && target === 'folder' ? (
              <button className="btn-secondary" onClick={() => window.electronAPI?.openPath(progress.destination!)}>
                <FolderOpen size={14} aria-hidden="true" /> Open in {fileManagerName()}
              </button>
            ) : null}
            {progress?.finished ? (
              <button className="btn-primary" onClick={onClose}>
                Done
              </button>
            ) : (
              <>
                <button className="btn-ghost" onClick={onClose}>
                  {running ? 'Close' : 'Cancel'}
                </button>
                {!taskId && (
                  <button className="btn-primary" onClick={start} disabled={target === 'folder' ? !folder : !musicApp}>
                    {target === 'music_app' ? `Add to ${musicApp ?? 'music app'}` : `Copy ${count} song${count === 1 ? '' : 's'}`}
                  </button>
                )}
                {running && <Loader2 size={16} className="animate-spin text-muted" aria-label="Copying" />}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function TargetButton({
  active, onClick, icon, label, hint, disabled = false,
}: { active: boolean; onClick: () => void; icon: ReactNode; label: string; hint: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'text-left rounded-md border px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        active ? 'border-accent bg-accent/10' : 'border-line hover:border-faint',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {label}
      </span>
      <span className="block text-xs text-muted mt-0.5">{hint}</span>
    </button>
  )
}
