import { useState } from 'react'
import { clsx } from 'clsx'
import { ListMusic, Maximize2, MicVocal, Music2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import QueuePanel from '../library/QueuePanel'
import { api } from '../../services/api'
import { usePlayerStore } from '../../stores/playerStore'
import { MoreMenu, SeekBar, SleepMenu, SpeedMenu } from '../player/PlayerControls'

export function SongCover({ id, hasCover, className }: { id: string; hasCover: boolean; className: string }) {
  const [failed, setFailed] = useState(false)
  if (!hasCover || failed) {
    return (
      <div className={`${className} bg-raised flex items-center justify-center text-faint`} aria-hidden="true">
        <Music2 size={14} />
      </div>
    )
  }
  return <img src={api.songCoverUrl(id)} alt="" onError={() => setFailed(true)} className={`${className} object-cover bg-raised`} />
}

/** Library playback, shown above the status bar while something is queued. */
export default function PlayerBar() {
  const song = usePlayerStore((s) => s.queue[s.index])
  const { playing, volume, index, queue, repeat, shuffle, expanded, toggle, next, previous, setVolume, cycleRepeat, toggleShuffle, setExpanded, close } =
    usePlayerStore()
  const [queueOpen, setQueueOpen] = useState(false)
  if (!song) return null
  const repeatLabel = repeat === 'one' ? 'Repeat this song' : repeat === 'all' ? 'Repeat all' : 'Repeat off'

  return (
    <div className="relative h-16 shrink-0 bg-chrome border-t border-line flex items-center gap-4 px-4" role="region" aria-label="Now playing">
      {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
      <div className="flex items-center gap-3 w-80 min-w-0">
        <button
          className="group relative shrink-0 rounded overflow-hidden"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? 'Close Now playing' : 'Open Now playing'}
          title={expanded ? 'Close Now playing (F)' : 'Now playing: cover, lyrics and up next (F)'}
        >
          <SongCover id={song.id} hasCover={!!song.has_cover} className="w-11 h-11" />
          <span className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
            <Maximize2 size={15} className="text-white" />
          </span>
        </button>
        <div className="min-w-0">
          <p className="text-[13px] font-medium truncate" title={song.title}>{song.title}</p>
          <p className="text-xs text-muted truncate">{song.artist || song.album_artist || song.album || 'Unknown singer'}</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center gap-1 min-w-0 max-w-2xl mx-auto">
        <div className="flex items-center gap-1">
          <button
            className={clsx('btn-icon', shuffle && 'text-accent')}
            onClick={toggleShuffle}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            title={shuffle ? 'Shuffle on' : 'Shuffle off'}
          >
            <Shuffle size={15} />
          </button>
          <button className="btn-icon" onClick={previous} aria-label="Previous song">
            <SkipBack size={16} />
          </button>
          <button
            className="w-8 h-8 rounded-full bg-ink text-canvas flex items-center justify-center hover:scale-105 transition-transform"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
          </button>
          <button className="btn-icon" onClick={() => next()} disabled={index + 1 >= queue.length && repeat !== 'all'} aria-label="Next song">
            <SkipForward size={16} />
          </button>
          <button
            className={clsx('btn-icon', repeat !== 'off' && 'text-accent')}
            onClick={cycleRepeat}
            aria-label={repeatLabel}
            title={repeatLabel}
          >
            {repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
          </button>
        </div>
        <SeekBar />
      </div>

      <div className="flex items-center gap-0.5 w-80 justify-end">
        <button
          className={clsx('btn-icon', expanded && 'text-accent')}
          onClick={() => setExpanded(!expanded)}
          aria-label="Lyrics"
          aria-pressed={expanded}
          title="Lyrics and Now playing (F)"
        >
          <MicVocal size={16} />
        </button>
        <button
          className="btn-icon"
          onClick={() => setVolume(volume > 0 ? 0 : 1)}
          aria-label={volume > 0 ? 'Mute' : 'Unmute'}
        >
          {volume > 0 ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="range w-20"
          style={{ ['--fill' as string]: `${volume * 100}%` }}
          aria-label="Volume"
        />
        <button
          className={clsx('btn-icon', queueOpen && 'text-accent')}
          onClick={() => setQueueOpen((v) => !v)}
          aria-label="Queue"
          aria-expanded={queueOpen}
          title={`Queue · ${queue.length} song${queue.length === 1 ? '' : 's'}`}
        >
          <ListMusic size={16} />
        </button>
        <SpeedMenu />
        <SleepMenu />
        <MoreMenu song={song} />
        <button className="btn-icon" onClick={close} aria-label="Close player" title="Close player">
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
