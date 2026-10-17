import { clsx } from 'clsx'
import { X } from 'lucide-react'
import type { VideoOptions } from '../../types/job'
import { LANGUAGES, QUALITY_CHOICES, languageName } from '../../lib/video'

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={clsx(
        'h-8 px-3 rounded-md text-[13px] border transition-colors',
        selected ? 'bg-accent text-accent-ink border-accent font-semibold' : 'bg-raised text-ink border-line-strong hover:border-faint',
      )}
    >
      {children}
    </button>
  )
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: string }) {
  return (
    <label className="flex items-center gap-2 text-[13px] cursor-pointer">
      <input type="checkbox" className="accent-[rgb(var(--accent))] w-4 h-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

/** Subtitle languages as removable chips, plus a menu to add one. */
export function SubtitleChips({ value, onChange, id = 'add-subtitle' }: { value: string[]; onChange: (langs: string[]) => void; id?: string }) {
  const addable = Object.keys(LANGUAGES).filter((code) => !value.includes(code))
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((code) => (
        <span key={code} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-accent/15 text-accent text-xs font-medium">
          {languageName(code)}
          <button
            type="button"
            className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-accent/20"
            aria-label={`No ${languageName(code)} subtitles`}
            onClick={() => onChange(value.filter((c) => c !== code))}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <label className="sr-only" htmlFor={id}>Add a subtitle language</label>
      <select
        id={id}
        className="h-7 rounded-full border border-dashed border-line-strong bg-transparent px-2.5 text-xs text-muted"
        value=""
        onChange={(e) => e.target.value && onChange([...value, e.target.value])}
      >
        <option value="">+ Language</option>
        {addable.map((code) => <option key={code} value={code}>{LANGUAGES[code]}</option>)}
      </select>
    </div>
  )
}

/** Quality, file type, subtitles and extras for a whole-video download. */
export default function VideoOptionsPanel({ value, onChange }: { value: VideoOptions; onChange: (v: VideoOptions) => void }) {
  const set = (patch: Partial<VideoOptions>) => onChange({ ...value, ...patch })
  const soundOnly = value.quality === 'audio'

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 px-4 pb-4 pt-1">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Quality</span>
        <div className="flex flex-wrap gap-1.5">
          {QUALITY_CHOICES.map((q) => (
            <Pill key={q.id} selected={value.quality === q.id} onClick={() => set({ quality: q.id })}>{q.label}</Pill>
          ))}
        </div>
        <span className="text-xs text-muted">
          {value.quality === 'best' ? 'The best the video has, up to 4K.' : soundOnly ? 'Just the sound, as M4A: for lectures and talks.' : 'If the video has less, the next lower quality is used.'}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="eyebrow">File type</span>
        <div className="flex flex-wrap gap-1.5">
          <Pill selected={value.container === 'mp4' || soundOnly} onClick={() => set({ container: 'mp4' })}>{soundOnly ? 'M4A' : 'MP4'}</Pill>
          {!soundOnly && <Pill selected={value.container === 'mkv'} onClick={() => set({ container: 'mkv' })}>MKV</Pill>}
        </div>
        <span className="text-xs text-muted">
          {soundOnly ? 'Plays in any music player.' : value.container === 'mp4' ? 'Plays on every phone, TV and computer.' : 'Keeps every subtitle and sound track in one file.'}
        </span>
      </div>

      {!soundOnly && (
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Subtitles</span>
          <SubtitleChips value={value.subtitles} onChange={(subtitles) => set({ subtitles })} />
          <Check checked={value.auto_subtitles} onChange={(v) => set({ auto_subtitles: v })}>
            Use YouTube's automatic captions when there are none
          </Check>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="eyebrow">Keep with the video</span>
        {!soundOnly && <Check checked={value.chapters} onChange={(v) => set({ chapters: v })}>Chapters (jump between parts in any player)</Check>}
        <Check checked={value.thumbnail} onChange={(v) => set({ thumbnail: v })}>Thumbnail as cover</Check>
        <Check checked={value.description} onChange={(v) => set({ description: v })}>Description as a text file</Check>
      </div>
    </div>
  )
}
