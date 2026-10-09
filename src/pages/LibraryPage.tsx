import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { ArrowLeft, FolderOpen, Loader2, Music2, Pause, Pencil, Play, RefreshCw, Search, Send, Shuffle } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, type LibrarySong, type TagChanges } from '../services/api'
import { useAppStore } from '../stores/appStore'
import { useJobsStore } from '../stores/jobsStore'
import { usePlayerStore } from '../stores/playerStore'
import { usePrefsStore } from '../stores/prefsStore'
import { albumOf, artistOf, filterSongs, groupSongs, sortSongs, type LibrarySort, type SongGroup } from '../lib/library'
import { formatDuration, formatTime } from '../lib/time'
import { SongCover } from '../components/layout/PlayerBar'
import SendDialog from '../components/library/SendDialog'
import EditTagsDialog from '../components/library/EditTagsDialog'

type View = 'songs' | 'artists' | 'albums'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function SongTable({
  songs, showAlbum = true, onEdit, onSend,
}: { songs: LibrarySong[]; showAlbum?: boolean; onEdit: (songs: LibrarySong[]) => void; onSend: (songs: LibrarySong[]) => void }) {
  const current = usePlayerStore((s) => s.queue[s.index])
  const playing = usePlayerStore((s) => s.playing)
  const playList = usePlayerStore((s) => s.playList)
  const toggle = usePlayerStore((s) => s.toggle)

  return (
    <div className="panel overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-xs text-faint border-b border-line">
            <th className="w-12 py-2 pl-4 font-medium">#</th>
            <th className="py-2 font-medium">Title</th>
            {showAlbum && <th className="py-2 font-medium hidden md:table-cell">Album</th>}
            <th className="py-2 font-medium w-16 hidden lg:table-cell">Year</th>
            <th className="py-2 pr-2 font-medium w-16 text-right">Time</th>
            <th className="w-20 pr-3"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {songs.map((song, i) => {
            const isCurrent = current?.id === song.id
            return (
              <tr
                key={song.id}
                className={clsx('group border-b border-line last:border-0 transition-colors', isCurrent ? 'bg-accent/[0.07]' : 'hover:bg-raised/50')}
                onDoubleClick={() => playList(songs, i)}
              >
                <td className="pl-2 w-12">
                  <button
                    className="w-8 h-8 flex items-center justify-center rounded text-faint hover:text-ink"
                    onClick={() => (isCurrent ? toggle() : playList(songs, i))}
                    aria-label={isCurrent && playing ? `Pause ${song.title}` : `Play ${song.title}`}
                  >
                    {isCurrent && playing ? (
                      <Pause size={14} className="text-accent" />
                    ) : (
                      <>
                        <span className={clsx('tnum text-xs group-hover:hidden', isCurrent && 'text-accent')}>{i + 1}</span>
                        <Play size={14} className="hidden group-hover:block" />
                      </>
                    )}
                  </button>
                </td>
                <td className="py-1.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <SongCover id={song.id} hasCover={!!song.has_cover} className="w-9 h-9 rounded shrink-0" />
                    <div className="min-w-0">
                      <p className={clsx('truncate font-medium', isCurrent && 'text-accent')}>{song.title}</p>
                      <p className="truncate text-xs text-muted">{artistOf(song)}</p>
                    </div>
                  </div>
                </td>
                {showAlbum && <td className="truncate text-muted hidden md:table-cell max-w-[16rem]">{albumOf(song)}</td>}
                <td className="text-muted tnum hidden lg:table-cell">{song.year}</td>
                <td className="pr-2 text-right text-muted tnum font-mono text-xs">{formatTime(song.duration, false)}</td>
                <td className="pr-3 whitespace-nowrap">
                  <button
                    className="btn-icon opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={() => onSend([song])}
                    aria-label={`Send ${song.title} to a drive or music app`}
                    title="Send to a phone, drive or music app"
                  >
                    <Send size={14} />
                  </button>
                  <button
                    className="btn-icon opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={() => onEdit([song])}
                    aria-label={`Edit tags of ${song.title}`}
                    title="Edit tags"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="btn-icon opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={() => window.electronAPI?.showItemInFolder(song.path)}
                    aria-label={`Show ${song.title} in folder`}
                    title="Show in folder"
                  >
                    <FolderOpen size={14} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function GroupGrid({ groups, onOpen }: { groups: SongGroup[]; onOpen: (g: SongGroup) => void }) {
  const playList = usePlayerStore((s) => s.playList)
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {groups.map((g) => (
        <div key={g.key} className="group flex flex-col gap-2 min-w-0">
          <button className="relative aspect-square rounded-lg overflow-hidden border border-line" onClick={() => onOpen(g)} aria-label={`Open ${g.name}`}>
            {g.coverSong ? (
              <SongCover id={g.coverSong.id} hasCover className="w-full h-full" />
            ) : (
              <div className="w-full h-full bg-raised flex items-center justify-center text-faint">
                <Music2 size={28} aria-hidden="true" />
              </div>
            )}
          </button>
          <div className="flex items-start gap-2 min-w-0">
            <button className="flex-1 min-w-0 text-left" onClick={() => onOpen(g)}>
              <p className="text-[13px] font-medium truncate" title={g.name}>{g.name}</p>
              <p className="text-xs text-muted truncate">{g.subtitle}</p>
            </button>
            <button
              className="w-8 h-8 rounded-full bg-accent text-accent-ink flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              onClick={() => playList(g.songs, 0)}
              aria-label={`Play ${g.name}`}
            >
              <Play size={14} className="ml-0.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function LibraryPage() {
  const ready = useAppStore((s) => s.backend === 'ready')
  const completedCount = useJobsStore((s) => Object.values(s.jobs).filter((j) => j.status === 'completed').length)
  const prefs = usePrefsStore((s) => s.prefs)
  const playList = usePlayerStore((s) => s.playList)
  const [songs, setSongs] = useState<LibrarySong[] | null>(null)
  const [view, setView] = useState<View>('albums')
  const [sort, setSort] = useState<LibrarySort>('artist')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<{ kind: 'artist' | 'album'; key: string } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [editing, setEditing] = useState<LibrarySong[] | null>(null)
  const [sending, setSending] = useState<LibrarySong[] | null>(null)

  const load = useCallback(() => api.librarySongs().then(setSongs).catch((e) => toast.error(e.message)), [])

  useEffect(() => {
    if (ready) load()
  }, [ready, load, completedCount])

  const saveTags = async (ids: string[], changes: TagChanges) => {
    const updated = await api.editSongs(ids, changes)
    const byId = new Map(updated.map((s) => [s.id, s]))
    setSongs((old) => old?.map((s) => byId.get(s.id) ?? s) ?? null)
    toast.success(ids.length === 1 ? 'Tags saved' : `Tags saved for ${ids.length} songs`)
    // An album or singer renamed from its own page: follow it to its new name.
    if (open && ids.length > 1) {
      const first = updated[0]
      setOpen({ kind: open.kind, key: (open.kind === 'album' ? albumOf(first) : artistOf(first)).toLowerCase() })
    }
  }

  const rescan = async () => {
    setScanning(true)
    try {
      const r = await api.scanLibrary()
      await load()
      const changes = r.added + r.updated + r.removed
      toast.success(changes ? `Library updated: ${r.added} added, ${r.removed} removed` : 'Library is up to date')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setScanning(false)
    }
  }

  const filtered = useMemo(() => sortSongs(filterSongs(songs ?? [], query), sort), [songs, query, sort])
  const artists = useMemo(() => groupSongs(filtered, 'artist'), [filtered])
  const albums = useMemo(() => groupSongs(filtered, 'album'), [filtered])
  const openGroup = open ? (open.kind === 'artist' ? artists : albums).find((g) => g.key === open.key) : undefined
  const totalTime = (songs ?? []).reduce((t, s) => t + s.duration, 0)

  if (songs === null) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin text-muted" aria-label="Loading library" />
      </div>
    )
  }

  if (songs.length === 0) {
    return (
      <div className="max-w-xl mx-auto px-8 py-20 flex flex-col items-center gap-3 text-center">
        <Music2 size={32} className="text-faint" aria-hidden="true" />
        <h1 className="font-display text-lg font-semibold">Your library is empty</h1>
        <p className="text-muted">Songs you save appear here, grouped by singer and album. Songs already in your library folder are picked up too.</p>
        <div className="flex gap-2 mt-2">
          <Link to="/" className="btn-primary">Split a video</Link>
          <button className="btn-secondary" onClick={rescan} disabled={scanning}>
            {scanning ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />} Scan library folder
          </button>
        </div>
        {prefs && <p className="text-xs text-faint font-mono mt-2">{prefs.library_dir}</p>}
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-8 py-8 flex flex-col gap-6">
      <header className="flex items-end gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight">Library</h1>
          <p className="text-muted tnum">
            {plural(songs.length, 'song')} · {plural(artists.length, 'singer')} · {plural(albums.length, 'album')} · {formatDuration(totalTime)}
          </p>
        </div>
        <button className="btn-secondary" onClick={() => playList(sortSongs(filtered, 'title').sort(() => Math.random() - 0.5), 0)}>
          <Shuffle size={14} aria-hidden="true" /> Shuffle
        </button>
        <button className="btn-ghost" onClick={rescan} disabled={scanning} title="Look for songs added, changed or deleted outside Cadence">
          {scanning ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />} Rescan
        </button>
        {prefs && (
          <button className="btn-ghost" onClick={() => window.electronAPI?.openPath(prefs.library_dir)}>
            <FolderOpen size={14} aria-hidden="true" /> Open folder
          </button>
        )}
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-md border border-line bg-surface p-0.5" role="tablist" aria-label="Library view">
          {(['albums', 'artists', 'songs'] as View[]).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => {
                setView(v)
                setOpen(null)
              }}
              className={clsx('h-7 px-3 rounded text-[13px] capitalize transition-colors', view === v ? 'bg-raised text-ink font-medium' : 'text-muted hover:text-ink')}
            >
              {v === 'artists' ? 'Singers' : v}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
          <label htmlFor="library-search" className="sr-only">Search songs, singers or albums</label>
          <input id="library-search" className="field pl-8" placeholder="Search songs, singers or albums" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {view === 'songs' && (
          <select className="field w-40" value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)} aria-label="Sort songs">
            <option value="artist">Sort by singer</option>
            <option value="album">Sort by album</option>
            <option value="title">Sort by title</option>
            <option value="added">Recently added</option>
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted">Nothing matches “{query}”.</p>
      ) : openGroup ? (
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <button className="btn-icon" onClick={() => setOpen(null)} aria-label="Back">
              <ArrowLeft size={18} />
            </button>
            {openGroup.coverSong ? (
              <SongCover id={openGroup.coverSong.id} hasCover className="w-20 h-20 rounded-lg" />
            ) : (
              <div className="w-20 h-20 rounded-lg bg-raised flex items-center justify-center text-faint"><Music2 size={24} /></div>
            )}
            <div className="flex-1 min-w-0">
              <p className="eyebrow">{open?.kind === 'artist' ? 'Singer' : 'Album'}</p>
              <h2 className="font-display text-lg font-semibold truncate">{openGroup.name}</h2>
              <p className="text-xs text-muted">{openGroup.subtitle}</p>
            </div>
            <button className="btn-secondary" onClick={() => setEditing(openGroup.songs)} title="Change the album, singer or year of every song here">
              <Pencil size={14} aria-hidden="true" /> Edit all
            </button>
            <button className="btn-secondary" onClick={() => setSending(openGroup.songs)} title="Copy every song here to a phone, drive or music app">
              <Send size={14} aria-hidden="true" /> Send to…
            </button>
            <button className="btn-primary" onClick={() => playList(openGroup.songs, 0)}>
              <Play size={14} aria-hidden="true" /> Play all
            </button>
          </div>
          <SongTable songs={openGroup.songs} showAlbum={open?.kind === 'artist'} onEdit={setEditing} onSend={setSending} />
        </section>
      ) : view === 'songs' ? (
        <SongTable songs={filtered} onEdit={setEditing} onSend={setSending} />
      ) : (
        <GroupGrid groups={view === 'artists' ? artists : albums} onOpen={(g) => setOpen({ kind: view === 'artists' ? 'artist' : 'album', key: g.key })} />
      )}
      <EditTagsDialog songs={editing} onClose={() => setEditing(null)} onSave={saveTags} />
      <SendDialog songs={sending} onClose={() => setSending(null)} />
    </div>
  )
}
