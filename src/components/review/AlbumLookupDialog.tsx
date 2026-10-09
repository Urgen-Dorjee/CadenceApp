import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { clsx } from 'clsx'
import { Disc3, Loader2, Search, X } from 'lucide-react'
import type { AlbumRelease } from '../../lib/albumDetails'

export interface AlbumChoice {
  release: AlbumRelease
  useSongNames: boolean
  useCover: boolean
}

/**
 * Search MusicBrainz for the album and pick the right release.
 * `onSearch` and `onApply` throw to keep the dialog open with their message.
 */
export default function AlbumLookupDialog({
  open,
  onOpenChange,
  initialAlbum,
  initialArtist,
  includedCount,
  onSearch,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialAlbum: string
  initialArtist: string
  /** Songs in the split, to show which albums have the same number. */
  includedCount: number
  onSearch: (album: string, artist: string) => Promise<AlbumRelease[]>
  onApply: (choice: AlbumChoice) => Promise<void>
}) {
  const [album, setAlbum] = useState(initialAlbum)
  const [artist, setArtist] = useState(initialArtist)
  const [results, setResults] = useState<AlbumRelease[] | null>(null)
  const [selected, setSelected] = useState<AlbumRelease | null>(null)
  const [useSongNames, setUseSongNames] = useState(true)
  const [useCover, setUseCover] = useState(true)
  const [error, setError] = useState('')
  /** Set when nothing matched the singer, so the results are for the album name alone. */
  const [withoutSinger, setWithoutSinger] = useState(false)
  const [busy, setBusy] = useState<'search' | 'apply' | null>(null)

  useEffect(() => {
    if (!open) return
    setAlbum(initialAlbum)
    setArtist(initialArtist)
    setResults(null)
    setSelected(null)
    setError('')
  }, [open, initialAlbum, initialArtist])

  const search = async () => {
    if (!album.trim()) return
    setBusy('search')
    setError('')
    setSelected(null)
    setWithoutSinger(false)
    try {
      let found = await onSearch(album.trim(), artist.trim())
      if (found.length === 0 && artist.trim()) {
        found = await onSearch(album.trim(), '')
        setWithoutSinger(found.length > 0)
      }
      setResults(found)
      // Pre-select the best match with the same number of songs, else the best match.
      setSelected(found.find((r) => r.track_count === includedCount) ?? found[0] ?? null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const apply = async (release = selected) => {
    if (!release) return
    setBusy('apply')
    setError('')
    try {
      await onApply({ release, useSongNames: useSongNames && release.track_count === includedCount, useCover })
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const sameCount = selected?.track_count === includedCount

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="panel fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(640px,calc(100vw-32px))] max-h-[calc(100vh-48px)] p-5 flex flex-col gap-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <Dialog.Title className="font-display text-base font-semibold">Find album details</Dialog.Title>
              <Dialog.Description className="text-[13px] text-muted mt-1">
                Look up the album on MusicBrainz, the free music encyclopedia, to fill in its name, singer, year and
                cover art, and the song names when it has the same number of songs. Only the names you type are sent.
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-icon" aria-label="Close" disabled={Boolean(busy)}>
              <X size={16} />
            </Dialog.Close>
          </div>

          <form
            className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end"
            onSubmit={(e) => {
              e.preventDefault()
              search()
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="label">Movie or album</span>
              <input className="field" value={album} onChange={(e) => setAlbum(e.target.value)} autoFocus />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label">Singer or composer (optional)</span>
              <input className="field" value={artist} onChange={(e) => setArtist(e.target.value)} />
            </label>
            <button type="submit" className="btn-secondary" disabled={Boolean(busy) || !album.trim()}>
              {busy === 'search' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
              Search
            </button>
          </form>

          {results && results.length === 0 && (
            <p className="text-[13px] text-muted">No albums found. Try a shorter name, or leave out the singer.</p>
          )}
          {withoutSinger && (
            <p className="text-[13px] text-muted">No albums by “{artist.trim()}” were found, so these are all albums with that name.</p>
          )}
          {results && results.length > 0 && (
            <ul className="flex flex-col gap-1 overflow-y-auto min-h-0 -mx-1 px-1" role="listbox" aria-label="Albums">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected?.id === r.id}
                    onClick={() => setSelected(r)}
                    onDoubleClick={() => {
                      setSelected(r)
                      apply(r)
                    }}
                    className={clsx(
                      'w-full flex items-center gap-3 rounded-md border px-2 py-1.5 text-left transition-colors',
                      selected?.id === r.id ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-raised',
                    )}
                  >
                    <CoverThumb url={r.cover_url} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{r.title}</span>
                      <span className="block text-xs text-muted truncate">
                        {[r.artist, r.year, r.country, r.type].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span
                      className={clsx('text-xs tnum shrink-0', r.track_count === includedCount ? 'text-accent font-medium' : 'text-muted')}
                      title={r.track_count === includedCount ? 'Same number of songs as this split' : undefined}
                    >
                      {r.track_count} song{r.track_count === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected && (
            <div className="flex flex-col gap-2 text-[13px]">
              <label className={clsx('flex items-center gap-2', !sameCount && 'text-muted')}>
                <input type="checkbox" checked={useSongNames && sameCount} disabled={!sameCount} onChange={(e) => setUseSongNames(e.target.checked)} />
                {sameCount
                  ? `Use its ${includedCount} song names and singers, in order`
                  : `Song names can't be matched: this album has ${selected.track_count} songs and the split has ${includedCount}`}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={useCover} onChange={(e) => setUseCover(e.target.checked)} />
                Use its cover art, if it has one
              </label>
            </div>
          )}

          {error && (
            <p className="text-[13px] text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <a href="https://musicbrainz.org" target="_blank" rel="noreferrer" className="text-xs text-faint hover:text-muted">
              Data from MusicBrainz
            </a>
            <div className="flex-1" />
            <button className="btn-ghost" onClick={() => onOpenChange(false)} disabled={Boolean(busy)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={() => apply()} disabled={Boolean(busy) || !selected}>
              {busy === 'apply' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {busy === 'apply' ? 'Getting details…' : 'Use this album'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Small cover from the Cover Art Archive, or a disc icon when the album has none. */
function CoverThumb({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className="w-10 h-10 rounded-sm bg-raised flex items-center justify-center text-faint shrink-0" aria-hidden="true">
        <Disc3 size={16} />
      </span>
    )
  }
  return <img src={url} alt="" loading="lazy" className="w-10 h-10 rounded-sm object-cover bg-raised shrink-0" onError={() => setFailed(true)} />
}
