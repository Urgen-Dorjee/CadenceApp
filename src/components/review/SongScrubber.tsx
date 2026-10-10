import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react'
import type { Track } from '../../types/job'
import { formatTime } from '../../lib/time'

interface Props {
  track: Track
  /** Position in the source (the whole video), in seconds. */
  time: number
  playing: boolean
  colSpan: number
  onToggle: () => void
  /** Play from this point in the source, stopping at the end of the song. */
  onPlayFrom: (time: number) => void
  onInclude: (include: boolean) => void
}

/**
 * A small player under the song that's playing: pause, back / forward 10 s, a bar for just this song,
 * and "Keep this song", so a long list can be auditioned without scrolling up to the main player.
 */
export default function SongScrubber({ track, time, playing, colSpan, onToggle, onPlayFrom, onInclude }: Props) {
  const length = Math.max(0.1, track.end - track.start)
  const at = Math.min(length, Math.max(0, time - track.start))
  const jump = (seconds: number) => onPlayFrom(track.start + Math.min(length - 0.5, Math.max(0, at + seconds)))

  return (
    <tr className="bg-raised/60 border-b border-line" aria-label={`Player for ${track.title}`}>
      <td colSpan={colSpan} className="px-4 py-2">
        <div className="flex items-center gap-2 pl-[60px] flex-wrap">
          <button className="btn-icon" onClick={onToggle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          </button>
          <button className="btn-icon" onClick={() => jump(-10)} aria-label="Back 10 seconds" title="Back 10 s">
            <RotateCcw size={15} />
          </button>
          <input
            type="range"
            min={0}
            max={length}
            step={0.5}
            value={at}
            onChange={(e) => onPlayFrom(track.start + Number(e.target.value))}
            className="range flex-1 min-w-[160px]"
            style={{ ['--fill' as string]: `${(at / length) * 100}%` }}
            aria-label={`Position in ${track.title}`}
            aria-valuetext={`${formatTime(at, false)} of ${formatTime(length, false)}`}
          />
          <button className="btn-icon" onClick={() => jump(10)} aria-label="Forward 10 seconds" title="Forward 10 s">
            <RotateCw size={15} />
          </button>
          <span className="w-24 text-xs font-mono tnum text-muted">
            {formatTime(at, false)} <span className="text-faint">/ {formatTime(length, false)}</span>
          </span>
          <label className="flex items-center gap-2 text-[13px] pl-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 accent-[rgb(var(--accent))]"
              checked={track.include}
              onChange={(e) => onInclude(e.target.checked)}
            />
            Keep this song
          </label>
        </div>
      </td>
    </tr>
  )
}
