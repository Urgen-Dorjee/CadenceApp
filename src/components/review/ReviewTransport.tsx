import type { ReactNode } from 'react'
import { Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import type { Track } from '../../types/job'
import { formatTime } from '../../lib/time'

interface Props {
  playing: boolean
  time: number
  duration: number
  /** The song under the playhead, or null before playing. */
  song: { index: number; track: Track } | null
  /** Album singer, shown when the song has none of its own. */
  fallbackArtist: string
  volume: number
  canPrevious: boolean
  canNext: boolean
  onToggle: () => void
  onPrevious: () => void
  onNext: () => void
  onVolume: (volume: number) => void
  /** Tools shown on the right (Tracklist, Tidy names, …). */
  children?: ReactNode
}

/** The review player's controls: previous / play / next song, time, what's playing and volume. */
export default function ReviewTransport(p: Props) {
  const VolumeIcon = p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2
  const artist = p.song ? p.song.track.artist || p.fallbackArtist : ''
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-1">
        <button className="btn-icon" onClick={p.onPrevious} disabled={!p.canPrevious} aria-label="Previous song" title="Previous song">
          <SkipBack size={16} fill="currentColor" />
        </button>
        <button
          className="w-10 h-10 rounded-full bg-accent text-accent-ink flex items-center justify-center shadow-[0_4px_14px_-4px_rgb(var(--accent)/0.6)] hover:brightness-110 active:scale-95 transition"
          onClick={p.onToggle}
          aria-label={p.playing ? 'Pause' : 'Play'}
          title={p.playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {p.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
        </button>
        <button className="btn-icon" onClick={p.onNext} disabled={!p.canNext} aria-label="Next song" title="Next song">
          <SkipForward size={16} fill="currentColor" />
        </button>
      </div>

      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-medium truncate" title={p.song?.track.title}>
          {p.song ? (
            <>
              <span className="text-faint tnum mr-2">{p.song.index + 1}</span>
              {p.song.track.title || 'Untitled'}
            </>
          ) : (
            <span className="text-muted">Press play to listen</span>
          )}
        </p>
        <p className="text-xs text-muted tnum truncate">
          <span className="font-mono text-ink/90">{formatTime(p.time, false)}</span>
          <span className="text-faint"> / {formatTime(p.duration, false)}</span>
          {artist && <span> · {artist}</span>}
        </p>
      </div>

      <label className="hidden md:flex items-center gap-2 text-muted" title={`Volume ${Math.round(p.volume * 100)}%`}>
        <button
          type="button"
          className="btn-icon"
          onClick={() => p.onVolume(p.volume === 0 ? 1 : 0)}
          aria-label={p.volume === 0 ? 'Unmute' : 'Mute'}
        >
          <VolumeIcon size={16} />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={p.volume}
          onChange={(e) => p.onVolume(Number(e.target.value))}
          className="range w-24"
          style={{ ['--fill' as string]: `${p.volume * 100}%` }}
          aria-label="Volume"
        />
      </label>

      {p.children && <div className="flex items-center gap-1 flex-wrap">{p.children}</div>}
    </div>
  )
}
