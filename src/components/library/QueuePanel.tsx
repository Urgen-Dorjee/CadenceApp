import { useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import { Volume2, X } from 'lucide-react'
import { usePlayerStore } from '../../stores/playerStore'
import { formatTime } from '../../lib/time'
import { SongCover } from '../layout/PlayerBar'

/** What's playing and what comes next. Click a song to play it; × removes it. */
export default function QueuePanel({ onClose }: { onClose: () => void }) {
  const { queue, index, playing, jump, removeFromQueue, clearUpcoming } = usePlayerStore()
  const currentRow = useRef<HTMLLIElement>(null)

  useEffect(() => {
    currentRow.current?.scrollIntoView({ block: 'nearest' })
  }, [index])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const upcoming = Math.max(0, queue.length - index - 1)
  const left = queue.slice(index).reduce((sum, s) => sum + s.duration, 0)

  return (
    <div
      className="panel absolute right-4 bottom-[calc(100%+8px)] z-30 w-[min(420px,calc(100vw-32px))] max-h-[min(520px,60vh)] flex flex-col shadow-2xl"
      role="dialog"
      aria-label="Queue"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
        <div className="flex-1 min-w-0">
          <p className="font-display text-sm font-semibold">Queue</p>
          <p className="text-xs text-muted">
            {queue.length} song{queue.length === 1 ? '' : 's'} · {formatTime(left, false)} left
          </p>
        </div>
        {upcoming > 0 && (
          <button className="btn-ghost h-7 px-2 text-xs" onClick={clearUpcoming}>
            Clear upcoming
          </button>
        )}
        <button className="btn-icon" onClick={onClose} aria-label="Close queue">
          <X size={15} />
        </button>
      </div>
      <ol className="overflow-y-auto min-h-0 py-1">
        {queue.map((song, i) => {
          const isCurrent = i === index
          return (
            <li
              key={`${song.id}-${i}`}
              ref={isCurrent ? currentRow : undefined}
              className={clsx('group flex items-center gap-3 px-3 py-1.5', isCurrent ? 'bg-accent/[0.08]' : 'hover:bg-raised/60', i < index && 'opacity-50')}
            >
              <button className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={() => jump(i)} aria-label={`Play ${song.title}`}>
                <SongCover id={song.id} hasCover={!!song.has_cover} className="w-8 h-8 rounded shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className={clsx('block text-[13px] truncate', isCurrent && 'text-accent font-medium')}>{song.title}</span>
                  <span className="block text-xs text-muted truncate">{song.artist || song.album_artist || song.album}</span>
                </span>
              </button>
              {isCurrent && playing ? (
                <Volume2 size={13} className="text-accent shrink-0" aria-label="Playing" />
              ) : (
                <span className="text-xs text-faint tnum font-mono shrink-0">{formatTime(song.duration, false)}</span>
              )}
              <button
                className="btn-icon opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0"
                onClick={() => removeFromQueue(i)}
                aria-label={`Remove ${song.title} from the queue`}
                title="Remove from queue"
              >
                <X size={13} />
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
