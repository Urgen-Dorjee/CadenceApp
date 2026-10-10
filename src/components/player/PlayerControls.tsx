import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { Disc3, Ellipsis, FolderOpen, Gauge, Moon, Pencil, Send, TimerOff, UserRound } from 'lucide-react'
import type { LibrarySong } from '../../services/api'
import { RATES, usePlayerStore } from '../../stores/playerStore'
import { groupIntent, type LibraryIntent } from '../../lib/library'
import { formatTime } from '../../lib/time'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../ui/Menu'

/** The position in the song, with the time played and the song's length. */
export function SeekBar({ className }: { className?: string }) {
  const { time, duration, seek } = usePlayerStore()
  const song = usePlayerStore((s) => s.queue[s.index])
  const total = duration || song?.duration || 0
  const at = Math.min(time, total || 0)
  return (
    <div className={clsx('w-full flex items-center gap-2 text-[11px] text-faint tnum font-mono', className)}>
      <span className="w-11 text-right">{formatTime(at, false)}</span>
      <input
        type="range"
        min={0}
        max={total || 1}
        step={0.25}
        value={at}
        onChange={(e) => seek(Number(e.target.value))}
        className="range flex-1"
        style={{ ['--fill' as string]: `${total ? (at / total) * 100 : 0}%` }}
        aria-label="Position in song"
        aria-valuetext={`${formatTime(at, false)} of ${formatTime(total, false)}`}
      />
      <span className="w-11">{formatTime(total, false)}</span>
    </div>
  )
}

export function SpeedMenu() {
  const { rate, setRate } = usePlayerStore()
  return (
    <Menu label={`Playback speed (${rate}×)`} icon={<Gauge size={16} />} active={rate !== 1} width="w-44">
      <MenuLabel>Playback speed</MenuLabel>
      {RATES.map((r) => (
        <MenuItem key={r} checked={rate === r} onSelect={() => setRate(r)}>
          {r === 1 ? 'Normal' : `${r}×`}
        </MenuItem>
      ))}
    </Menu>
  )
}

/** Re-render every few seconds while a sleep timer counts down. */
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

export function SleepMenu() {
  const { sleep, setSleep } = usePlayerStore()
  const now = useNow(Boolean(sleep && sleep !== 'end'))
  const left = sleep && sleep !== 'end' ? Math.max(1, Math.ceil((sleep.until - now) / 60_000)) : 0
  const label = sleep === 'end' ? 'Sleep timer: stops after this song' : sleep ? `Sleep timer: stops in ${left} min` : 'Sleep timer'
  return (
    <Menu label={label} icon={<Moon size={15} />} active={Boolean(sleep)} width="w-52">
      <MenuLabel>Stop playing</MenuLabel>
      {[15, 30, 45, 60].map((m) => (
        <MenuItem key={m} onSelect={() => setSleep(m)} hint={sleep && sleep !== 'end' && left <= m && left > m - 15 ? `${left} min left` : undefined}>
          In {m} minutes
        </MenuItem>
      ))}
      <MenuItem checked={sleep === 'end'} onSelect={() => setSleep('end')}>
        At the end of this song
      </MenuItem>
      {sleep && (
        <>
          <MenuSeparator />
          <MenuItem icon={<TimerOff size={14} />} onSelect={() => setSleep(null)}>
            Turn off the timer
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

/** Go to the song's album or singer, show it in its folder, edit its tags or send it. */
export function MoreMenu({ song }: { song: LibrarySong }) {
  const navigate = useNavigate()
  const setExpanded = usePlayerStore((s) => s.setExpanded)
  const go = (intent: LibraryIntent) => {
    setExpanded(false)
    navigate('/library', { state: intent })
  }
  return (
    <Menu label="More options" icon={<Ellipsis size={16} />} width="w-56">
      <MenuItem icon={<Disc3 size={14} />} onSelect={() => go(groupIntent(song, 'album'))}>
        Go to album
      </MenuItem>
      <MenuItem icon={<UserRound size={14} />} onSelect={() => go(groupIntent(song, 'artist'))}>
        Go to singer
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Pencil size={14} />} onSelect={() => go({ edit: [song] })}>
        Edit song details…
      </MenuItem>
      <MenuItem icon={<Send size={14} />} onSelect={() => go({ send: [song] })}>
        Send to…
      </MenuItem>
      <MenuItem icon={<FolderOpen size={14} />} onSelect={() => window.electronAPI?.showItemInFolder(song.path)}>
        Show in folder
      </MenuItem>
    </Menu>
  )
}
