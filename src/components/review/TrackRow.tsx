import { memo } from 'react'
import { clsx } from 'clsx'
import { Play, Pause, Merge, Ear } from 'lucide-react'
import type { Track } from '../../types/job'
import { formatTime } from '../../lib/time'
import ConfidenceBadge from '../ui/ConfidenceBadge'
import TimeInput from './TimeInput'

interface Props {
  track: Track
  index: number
  isPlaying: boolean
  isSelected: boolean
  canMerge: boolean
  hasCutBefore: boolean
  showArtist: boolean
  onChange: (id: string, patch: Partial<Track>) => void
  onStart: (index: number, t: number) => void
  onEnd: (index: number, t: number) => void
  onPlay: (track: Track) => void
  onPreviewCut: (track: Track) => void
  onMerge: (index: number) => void
  onSelect: (id: string) => void
}

function TrackRow(p: Props) {
  const { track, index } = p
  return (
    <tr
      data-track-id={track.id}
      className={clsx(
        'group border-b border-line last:border-0 transition-colors',
        p.isSelected ? 'bg-raised' : 'hover:bg-raised/50',
        !track.include && 'opacity-50',
      )}
      onFocusCapture={() => p.onSelect(track.id)}
    >
      <td className="pl-4 pr-1 w-10">
        <input
          type="checkbox"
          className="w-4 h-4 accent-[rgb(var(--accent))]"
          checked={track.include}
          onChange={(e) => p.onChange(track.id, { include: e.target.checked })}
          aria-label={`Include ${track.title}`}
        />
      </td>
      <td className="w-8 text-right text-xs text-faint tnum pr-1">{index + 1}</td>
      <td className="w-10">
        <button
          className="btn-icon"
          onClick={() => p.onPlay(track)}
          aria-label={p.isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
        >
          {p.isPlaying ? <Pause size={15} /> : <Play size={15} />}
        </button>
      </td>
      <td className="min-w-[200px]">
        <div className="flex items-center gap-1.5">
          <input
            className="field-inline font-medium"
            value={track.title}
            onChange={(e) => p.onChange(track.id, { title: e.target.value })}
            aria-label={`Title of song ${index + 1}`}
          />
          {track.match?.source === 'acoustid' && (
            <span
              className="shrink-0 inline-flex items-center h-5 px-1.5 rounded-full bg-seg2/15 text-seg2 text-[10.5px] font-semibold"
              title={`Recognised by AcoustID (${Math.round((track.match.score ?? 0) * 100)}% match)${track.match.album ? ` · from “${track.match.album}”` : ''}`}
            >
              Identified
            </span>
          )}
          {track.match?.source === 'claude' && (
            <span className="shrink-0 inline-flex items-center h-5 px-1.5 rounded-full bg-seg3/15 text-seg3 text-[10.5px] font-semibold" title="Name tidied by Claude">
              Tidied
            </span>
          )}
        </div>
      </td>
      {p.showArtist && (
        <td className="min-w-[140px]">
          <input
            className="field-inline text-muted focus:text-ink"
            value={track.artist}
            placeholder="Same as album"
            onChange={(e) => p.onChange(track.id, { artist: e.target.value })}
            aria-label={`Singer of song ${index + 1}`}
          />
        </td>
      )}
      <td className="w-[92px]">
        <TimeInput value={track.start} onChange={(t) => p.onStart(index, t)} label={`Start of song ${index + 1}`} />
      </td>
      <td className="w-[92px]">
        <TimeInput value={track.end} onChange={(t) => p.onEnd(index, t)} label={`End of song ${index + 1}`} />
      </td>
      <td className="w-16 text-right text-xs text-muted font-mono tnum pr-3">{formatTime(track.end - track.start, false)}</td>
      <td className="w-20">
        <ConfidenceBadge confidence={track.confidence} origin={track.origin} />
      </td>
      <td className="w-20 pr-3">
        <div className="flex justify-end opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          {p.hasCutBefore && (
            <button
              className="btn-icon"
              onClick={() => p.onPreviewCut(track)}
              title="Hear the cut: 4 s either side of where this song starts"
              aria-label={`Hear the cut before ${track.title}`}
            >
              <Ear size={15} />
            </button>
          )}
          {p.canMerge && (
            <button
              className="btn-icon"
              onClick={() => p.onMerge(index)}
              title="Join with the next song (removes a wrong cut)"
              aria-label={`Join ${track.title} with the next song`}
            >
              <Merge size={15} />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

export default memo(TrackRow)
