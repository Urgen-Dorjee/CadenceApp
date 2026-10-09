import { clsx } from 'clsx'
import { Disc3, FolderOutput, ImageIcon } from 'lucide-react'
import type { Collection, CollectionType } from '../../types/job'

const TYPES: { value: CollectionType; label: string; hint: string }[] = [
  { value: 'artist', label: 'Singer collection', hint: 'Many songs by one singer' },
  { value: 'album', label: 'Movie album', hint: 'All songs from one film or album' },
  { value: 'collection', label: 'Mixed collection', hint: 'Different singers and films' },
  { value: 'single', label: 'Single song', hint: 'One song only' },
]

interface Props {
  collection: Collection
  onChange: (patch: Partial<Collection>) => void
  /** Folder the first song will be saved in, or null if unknown yet. */
  destination: string | null
  /** True when this split saves somewhere other than the library folder. */
  customFolder: boolean
  /** True when Settings say "ask me each time" and no folder is chosen yet. */
  askOnSave: boolean
  onChooseFolder: () => void
  onResetFolder: () => void
  /** Cover shown on the saved songs (the video thumbnail or the user's own image). */
  coverUrl: string | null
  /** Where the cover came from: the video's thumbnail, the user's own image, or MusicBrainz. */
  coverSource: 'video' | 'custom' | 'musicbrainz'
  /** Look the album up on MusicBrainz. */
  onFindAlbum: () => void
  /** Settings crop video thumbnails to a square. */
  squareCover: boolean
  onChangeCover: () => void
  onResetCover: () => void
  disabled: boolean
}

export default function CollectionPanel({
  collection, onChange, destination, customFolder, askOnSave, onChooseFolder, onResetFolder,
  coverUrl, coverSource, onFindAlbum, squareCover, onChangeCover, onResetCover, disabled,
}: Props) {
  const customCover = coverSource !== 'video'
  const setType = (type: CollectionType) => {
    // Carry the name across so switching type doesn't lose what was typed.
    const name = collection.artist || collection.album || collection.name
    if (type === 'artist') onChange({ type, artist: collection.artist || name })
    else if (type === 'album') onChange({ type, album: collection.album || name })
    else onChange({ type, name: collection.name || name })
  }

  return (
    <section className="panel p-4 flex flex-col gap-4" aria-label="What is this video?">
      <fieldset className="flex items-center gap-3 flex-wrap" disabled={disabled}>
        <legend className="sr-only">What is this video?</legend>
        <span className="eyebrow" aria-hidden="true">This video is</span>
        {/* A compact selector: the choice matters, but it shouldn't fill the screen. */}
        <div className="inline-flex p-0.5 rounded-lg bg-sunken ring-1 ring-inset ring-line" role="radiogroup" aria-label="What is this video?">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={collection.type === t.value}
              onClick={() => setType(t.value)}
              title={t.hint}
              className={clsx(
                'h-7 px-3 rounded-md text-[12.5px] font-medium transition-all',
                collection.type === t.value
                  ? 'bg-raised text-ink shadow-sm ring-1 ring-line-strong'
                  : 'text-muted hover:text-ink',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-faint">{TYPES.find((t) => t.value === collection.type)?.hint}</span>
      </fieldset>

      <fieldset className="grid grid-cols-1 md:grid-cols-[1fr_1fr_110px] gap-3" disabled={disabled}>
        {collection.type === 'artist' && (
          <label className="flex flex-col gap-1.5 md:col-span-3">
            <span className="label">Singer</span>
            <input className="field" value={collection.artist} onChange={(e) => onChange({ artist: e.target.value })} placeholder="e.g. Udit Narayan" />
          </label>
        )}
        {collection.type === 'album' && (
          <>
            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className="label flex items-center">
                Movie or album
                <button
                  type="button"
                  className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-50"
                  onClick={onFindAlbum}
                  title="Fill in the album, year, cover and song names from MusicBrainz"
                >
                  <Disc3 size={12} aria-hidden="true" /> Find album details…
                </button>
              </span>
              <input className="field" value={collection.album} onChange={(e) => onChange({ album: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label">Year</span>
              <input
                className="field tnum"
                value={collection.year}
                inputMode="numeric"
                maxLength={4}
                onChange={(e) => onChange({ year: e.target.value.replace(/\D/g, '') })}
                placeholder="1995"
              />
            </label>
            <label className="flex flex-col gap-1.5 md:col-span-3">
              <span className="label">Album singer (optional)</span>
              <input className="field" value={collection.artist} onChange={(e) => onChange({ artist: e.target.value })} placeholder="Used when a song has no singer of its own" />
            </label>
          </>
        )}
        {collection.type === 'collection' && (
          <label className="flex flex-col gap-1.5 md:col-span-3">
            <span className="label">Collection name</span>
            <input className="field" value={collection.name} onChange={(e) => onChange({ name: e.target.value, album: e.target.value })} />
          </label>
        )}
        {collection.type === 'single' && (
          <label className="flex flex-col gap-1.5 md:col-span-3">
            <span className="label">Singer (optional)</span>
            <input className="field" value={collection.artist} onChange={(e) => onChange({ artist: e.target.value })} />
          </label>
        )}
      </fieldset>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="flex items-center gap-3 rounded-md bg-sunken border border-line px-3 py-2 min-w-0">
        <FolderOutput size={15} className="shrink-0 text-muted" aria-hidden="true" />
        <div className="flex-1 min-w-0 text-xs">
          <p className="text-muted">
            {askOnSave ? 'Saves to' : customFolder ? 'Saves to (this split only)' : 'Saves to your library'}
          </p>
          {askOnSave ? (
            <p className="text-ink">You'll choose a folder when you save</p>
          ) : (
            destination && <p className="font-mono text-[12px] text-ink truncate" title={destination}>{destination}</p>
          )}
        </div>
        {customFolder && (
          <button type="button" className="btn-ghost h-7 px-2" onClick={onResetFolder} disabled={disabled}>
            Use library
          </button>
        )}
        <button type="button" className="btn-secondary h-7 px-2.5" onClick={onChooseFolder} disabled={disabled}>
          Change folder
        </button>
      </div>

      <div className="flex items-center gap-3 rounded-md bg-sunken border border-line px-3 py-2 min-w-0">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt="Cover"
            className={clsx('h-10 rounded-sm shrink-0 object-cover bg-raised', squareCover || customCover ? 'w-10' : 'w-[71px]')}
          />
        ) : (
          <span className="w-10 h-10 rounded-sm bg-raised flex items-center justify-center text-faint shrink-0" aria-hidden="true">
            <ImageIcon size={16} />
          </span>
        )}
        <div className="flex-1 min-w-0 text-xs">
          <p className="text-muted">Cover art</p>
          <p className="text-ink">
            {coverSource === 'musicbrainz'
              ? 'The album cover from MusicBrainz'
              : customCover
              ? 'Your own image'
              : coverUrl
                ? squareCover ? "The video's thumbnail, cropped square" : "The video's thumbnail"
                : 'No cover'}
          </p>
        </div>
        {customCover && (
          <button type="button" className="btn-ghost h-7 px-2" onClick={onResetCover} disabled={disabled}>
            Use the video's
          </button>
        )}
        <button type="button" className="btn-secondary h-7 px-2.5" onClick={onChangeCover} disabled={disabled}>
          Change cover…
        </button>
      </div>
      </div>
    </section>
  )
}
