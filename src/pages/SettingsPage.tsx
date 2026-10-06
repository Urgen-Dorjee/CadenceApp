import { ReactNode, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { clsx } from 'clsx'
import { Check, FolderOpen, Loader2, RefreshCw, Trash2, Monitor, Moon, Sun, FolderInput, MessageSquareMore } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../services/api'
import { useAppStore } from '../stores/appStore'
import { formatBytes, usePrefsStore } from '../stores/prefsStore'
import { useThemeStore, type ThemePreference } from '../stores/themeStore'
import { breakablePath, previewPath } from '../lib/paths'
import { LAYOUT_PRESETS, TEMPLATE_KEY, presetIndex } from '../lib/layouts'
import type { CollectionType, Preferences, Track } from '../types/job'
import Switch from '../components/ui/Switch'

const SECTIONS = [
  { id: 'saving', label: 'Saving songs' },
  { id: 'names', label: 'Song names' },
  { id: 'claude', label: 'Tidy names' },
  { id: 'audio', label: 'Audio' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'updates', label: 'Updates' },
]

const FORMATS: { value: Preferences['audio_format']; label: string; note: string }[] = [
  { value: 'mp3', label: 'MP3', note: 'Plays everywhere' },
  { value: 'm4a', label: 'M4A (AAC)', note: 'Smaller, great on phones' },
  { value: 'opus', label: 'Opus', note: 'Smallest for the quality' },
  { value: 'flac', label: 'FLAC', note: 'Lossless, largest files' },
]

const LOUDNESS: { value: Preferences['loudness']; label: string; note: string }[] = [
  { value: 'off', label: 'Off', note: 'Songs keep their own volume' },
  { value: 'tags', label: 'ReplayGain tags', note: 'Recommended. Players even out the volume; the audio is untouched' },
  { value: 'normalize', label: 'Adjust volume', note: 'Changes each song to the same loudness' },
]

const LOUDNESS_TARGETS: { value: number; label: string }[] = [
  { value: -14, label: '-14 LUFS (Spotify, YouTube)' },
  { value: -16, label: '-16 LUFS (Apple Music)' },
  { value: -18, label: '-18 LUFS (quieter, more headroom)' },
  { value: -23, label: '-23 LUFS (broadcast)' },
]

const LAYOUT_TYPES: { type: CollectionType; label: string; example: { artist: string; album: string; name: string; year: string } }[] = [
  { type: 'artist', label: 'Singer collections', example: { artist: 'Udit Narayan', album: '', name: '', year: '' } },
  { type: 'album', label: 'Movie albums', example: { artist: '', album: 'Dilwale Dulhania Le Jayenge', name: '', year: '1995' } },
  { type: 'collection', label: 'Mixed collections', example: { artist: '', album: '90s Romantic Hits', name: '90s Romantic Hits', year: '' } },
  { type: 'single', label: 'Single songs', example: { artist: '', album: '', name: '', year: '' } },
]

const SAMPLE: Track = { id: 's', title: 'Tujhe Dekha To', artist: '', start: 0, end: 1, source_id: 's', origin: 'manual', confidence: 1, include: true }

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 flex flex-col gap-3">
      <div>
        <h2 className="font-display text-[15px] font-semibold">{title}</h2>
        <p className="text-[13px] text-muted">{description}</p>
      </div>
      <div className="panel divide-y divide-line">{children}</div>
    </section>
  )
}

function Row({ title, hint, htmlFor, children, stack }: { title: string; hint?: ReactNode; htmlFor?: string; children: ReactNode; stack?: boolean }) {
  return (
    <div className={clsx('px-5 py-4 flex gap-4', stack ? 'flex-col' : 'items-center justify-between')}>
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="text-[13px] font-medium block">{title}</label>
        {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
      </div>
      <div className={clsx('min-w-0', stack ? 'w-full' : 'shrink-0')}>{children}</div>
    </div>
  )
}

function Choice({ selected, onClick, icon, title, note }: { selected: boolean; onClick: () => void; icon?: ReactNode; title: string; note: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={clsx(
        'text-left rounded-md border px-3 py-2.5 transition-colors flex gap-3 items-start',
        selected ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong bg-sunken/40',
      )}
    >
      {icon && <span className={clsx('mt-0.5', selected ? 'text-accent' : 'text-muted')}>{icon}</span>}
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-xs text-muted">{note}</span>
      </span>
    </button>
  )
}

export default function SettingsPage() {
  const { hash } = useLocation()
  const ready = useAppStore((s) => s.backend === 'ready')
  const ytDlpVersion = useAppStore((s) => s.ytDlpVersion)
  const updateStatus = useAppStore((s) => s.update)
  const prefs = usePrefsStore((s) => s.prefs)
  const storage = usePrefsStore((s) => s.storage)
  const update = usePrefsStore((s) => s.update)
  const refreshStorage = usePrefsStore((s) => s.refreshStorage)
  const theme = useThemeStore((s) => s.preference)
  const setTheme = useThemeStore((s) => s.setPreference)
  const [libraryText, setLibraryText] = useState('')
  const [custom, setCustom] = useState<Partial<Record<CollectionType, boolean>>>({})
  const [savedAt, setSavedAt] = useState(0)
  const [busy, setBusy] = useState<'clear' | 'ytdlp' | null>(null)
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (prefs) setLibraryText(prefs.library_dir)
  }, [prefs?.library_dir])

  useEffect(() => {
    window.electronAPI?.getVersion().then(setVersion)
    if (ready) refreshStorage()
  }, [ready, refreshStorage])

  useEffect(() => {
    if (!hash || !prefs) return
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hash, prefs])

  if (!prefs) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin text-muted" aria-label="Loading settings" />
      </div>
    )
  }

  const save = async (patch: Partial<Preferences>) => {
    try {
      await update(patch)
      setSavedAt(Date.now())
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const chooseFolder = async () => {
    const folder = await window.electronAPI?.selectFolder({ defaultPath: prefs.library_dir, title: 'Save songs to' })
    if (folder) save({ library_dir: folder, save_mode: 'library' })
  }

  const clearDownloads = async () => {
    setBusy('clear')
    try {
      const r = await api.clearDownloads()
      await refreshStorage()
      toast.success(r.jobs_cleared ? `Freed ${formatBytes(r.freed_bytes)}` : 'Nothing to clear. Splits you are still reviewing are kept.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const updateYtDlp = async () => {
    setBusy('ytdlp')
    try {
      const r = await api.updateYtDlp()
      toast.success(r.updated ? 'yt-dlp updated. Restart Cadence to use it.' : 'yt-dlp is already up to date.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const justSaved = Date.now() - savedAt < 2500
  const updateHint = (() => {
    const v = `Version ${version || '…'}`
    switch (updateStatus.state) {
      case 'unsupported':
        return `${v} · Updates work in the installed app`
      case 'checking':
        return `${v} · Checking for updates…`
      case 'none':
        return `${v} · You have the latest version`
      case 'downloading':
        return `${v} · Downloading ${updateStatus.version} (${updateStatus.percent ?? 0}%)`
      case 'ready':
        return `${v} · Version ${updateStatus.version} is ready to install`
      case 'error':
        return `${v} · ${updateStatus.message}`
      default:
        return `${v} · © 2026 Urgen Dorjee`
    }
  })()

  return (
    <div className="max-w-5xl mx-auto px-8 py-8 flex gap-10">
      <nav className="hidden lg:flex flex-col gap-0.5 w-44 shrink-0 sticky top-8 self-start" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#/settings#${s.id}`}
            className={clsx(
              'h-8 px-2.5 rounded-md flex items-center text-[13px] transition-colors',
              hash === `#${s.id}` ? 'bg-raised text-ink font-medium' : 'text-muted hover:text-ink hover:bg-raised/60',
            )}
          >
            {s.label}
          </a>
        ))}
      </nav>

      <div className="flex-1 min-w-0 flex flex-col gap-8">
        <header className="flex items-end gap-4">
          <div className="flex-1">
            <h1 className="font-display text-xl font-semibold tracking-tight">Settings</h1>
            <p className="text-muted">Changes save automatically.</p>
          </div>
          <span className={clsx('flex items-center gap-1.5 text-xs text-ok transition-opacity', justSaved ? 'opacity-100' : 'opacity-0')} aria-live="polite">
            <Check size={14} aria-hidden="true" /> Saved
          </span>
        </header>

        <Section id="saving" title="Saving songs" description="Where your songs go and how the folders are organised.">
          <Row title="Where to save" hint="You can also pick a different folder for one split on its review screen." stack>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2" role="radiogroup" aria-label="Where to save">
              <Choice
                selected={prefs.save_mode === 'library'}
                onClick={() => save({ save_mode: 'library' })}
                icon={<FolderInput size={16} />}
                title="Always save to my library folder"
                note="Songs go straight into the folder below."
              />
              <Choice
                selected={prefs.save_mode === 'ask'}
                onClick={() => save({ save_mode: 'ask' })}
                icon={<MessageSquareMore size={16} />}
                title="Ask me each time"
                note="Choose a folder whenever you save a split."
              />
            </div>
          </Row>

          <Row title="Library folder" hint={prefs.save_mode === 'ask' ? 'Used as the starting folder when Cadence asks.' : 'Every split is saved inside this folder.'} htmlFor="library-dir" stack>
            <div className="flex gap-2">
              <input
                id="library-dir"
                className="field font-mono text-[12.5px]"
                value={libraryText}
                onChange={(e) => setLibraryText(e.target.value)}
                onBlur={() => libraryText.trim() !== prefs.library_dir && save({ library_dir: libraryText.trim() })}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                spellCheck={false}
              />
              <button className="btn-secondary h-9" onClick={chooseFolder}>
                <FolderOpen size={14} aria-hidden="true" /> Choose…
              </button>
              <button className="btn-ghost h-9" onClick={() => window.electronAPI?.openPath(prefs.library_dir)}>
                Open
              </button>
            </div>
            {storage && (
              <p className="text-xs text-faint mt-2 tnum">
                {formatBytes(storage.free_bytes)} free of {formatBytes(storage.total_bytes)} on this drive
                {!storage.library_exists && ' · the folder will be created when you first save'}
              </p>
            )}
          </Row>

          <Row title="Folder layout" hint="How songs are arranged inside the save folder. Cadence never overwrites an existing file." stack>
            <div className="flex flex-col gap-3">
              {LAYOUT_TYPES.map(({ type, label, example }) => {
                const key = TEMPLATE_KEY[type]
                const template = prefs[key] as string
                const index = presetIndex(type, template)
                const isCustom = custom[type] || index === -1
                const preview = previewPath(SAMPLE, 3, { type, ...example }, prefs)
                return (
                  <div key={type} className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-x-4 gap-y-1.5 items-start">
                    <label htmlFor={`layout-${type}`} className="text-[13px] text-muted pt-2">{label}</label>
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <select
                        id={`layout-${type}`}
                        className="field"
                        value={isCustom ? 'custom' : String(index)}
                        onChange={(e) => {
                          if (e.target.value === 'custom') return setCustom({ ...custom, [type]: true })
                          setCustom({ ...custom, [type]: false })
                          save({ [key]: LAYOUT_PRESETS[type][Number(e.target.value)].template })
                        }}
                      >
                        {LAYOUT_PRESETS[type].map((p, i) => (
                          <option key={p.template} value={i}>{p.label}</option>
                        ))}
                        <option value="custom">Custom…</option>
                      </select>
                      {isCustom && (
                        <input
                          className="field font-mono text-[12.5px]"
                          defaultValue={template}
                          aria-label={`Custom layout for ${label}`}
                          onBlur={(e) => e.target.value.trim() && e.target.value !== template && save({ [key]: e.target.value.trim() })}
                          spellCheck={false}
                        />
                      )}
                      <p className="text-[11.5px] font-mono text-faint break-words">{breakablePath(preview)}</p>
                    </div>
                  </div>
                )
              })}
              <p className="text-xs text-muted">
                Custom layouts can use <code className="font-mono">{'{artist}'}</code>, <code className="font-mono">{'{album}'}</code>,{' '}
                <code className="font-mono">{'{year_suffix}'}</code>, <code className="font-mono">{'{collection}'}</code>,{' '}
                <code className="font-mono">{'{title}'}</code> and <code className="font-mono">{'{track:02}'}</code>. Use / for folders.
              </p>
            </div>
          </Row>

          <Row title="Show songs in File Explorer when saving finishes" htmlFor="open-when-done">
            <Switch id="open-when-done" checked={prefs.open_when_done} onChange={(v) => save({ open_when_done: v })} />
          </Row>

          <Row
            title="Keep downloaded audio after saving"
            hint="Lets you change cuts and save a split again later. Turn off to save disk space."
            htmlFor="keep-downloads"
          >
            <Switch id="keep-downloads" checked={prefs.keep_downloads} onChange={(v) => save({ keep_downloads: v })} />
          </Row>
          <Row
            title="Playlist file"
            hint="Writes an .m3u8 playlist next to each album or collection, so other players and phones keep the song order."
            htmlFor="write-playlist"
          >
            <Switch id="write-playlist" checked={prefs.write_playlist} onChange={(v) => save({ write_playlist: v })} />
          </Row>

          <Row
            title="Downloaded audio"
            hint={
              storage
                ? storage.downloads_count
                  ? `${formatBytes(storage.downloads_bytes)} across ${storage.downloads_count} video${storage.downloads_count === 1 ? '' : 's'}. Saved songs are not affected.`
                  : 'No downloaded audio is being kept.'
                : 'Measuring…'
            }
          >
            <button className="btn-secondary" onClick={clearDownloads} disabled={busy === 'clear' || !storage?.downloads_count}>
              {busy === 'clear' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
              Clear downloads
            </button>
          </Row>
        </Section>

        <Section id="names" title="Song names" description="Name songs automatically when a video has no tracklist.">
          <Row
            title="Identify songs by their sound"
            hint="When songs are found from the audio and only have names like “Track 3”, Cadence fingerprints each one and looks it up on AcoustID / MusicBrainz. Only the fingerprint is sent, never the audio. Coverage of Indian film music is good but not complete."
            htmlFor="identify-songs"
          >
            <Switch id="identify-songs" checked={prefs.identify_songs} onChange={(v) => save({ identify_songs: v })} />
          </Row>
          <Row
            title="AcoustID API key"
            hint={
              <>
                Free. Create one at{' '}
                <a href="https://acoustid.org/new-application" target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  acoustid.org/new-application
                </a>{' '}
                (sign in, name it “Cadence”), then paste the key here.
              </>
            }
            htmlFor="acoustid-key"
            stack
          >
            <input
              id="acoustid-key"
              className="field font-mono text-[12.5px] max-w-md"
              type="password"
              autoComplete="off"
              placeholder="Paste your key"
              defaultValue={prefs.acoustid_key}
              onBlur={(e) => e.target.value.trim() !== prefs.acoustid_key && save({ acoustid_key: e.target.value.trim() })}
              spellCheck={false}
            />
            {prefs.identify_songs && !prefs.acoustid_key && (
              <p className="text-xs text-warn mt-1.5">Add a key to turn identification on.</p>
            )}
          </Row>
        </Section>

        <Section id="claude" title="Tidy names with Claude" description="Optional. Cleans up messy song and album names using Anthropic's Claude.">
          <Row
            title="Tidy names after each split"
            hint="Turns titles like “Song Two (Official Audio) | Channel” into “Song Two”, fills in singers and the album when the video's description names them, and picks the right collection type. You can also run it from the review screen."
            htmlFor="tidy-names"
          >
            <Switch id="tidy-names" checked={prefs.tidy_names} onChange={(v) => save({ tidy_names: v })} />
          </Row>
          <Row
            title="Anthropic API key"
            hint={
              <>
                Uses your own key and account, at roughly 1–5 US cents per split depending on its length. Create one at{' '}
                <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  platform.claude.com
                </a>
                . What's sent: the video title, channel, description and the song names. Never the audio.
              </>
            }
            htmlFor="anthropic-key"
            stack
          >
            <input
              id="anthropic-key"
              className="field font-mono text-[12.5px] max-w-md"
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…"
              defaultValue={prefs.anthropic_api_key}
              onBlur={(e) => e.target.value.trim() !== prefs.anthropic_api_key && save({ anthropic_api_key: e.target.value.trim() })}
              spellCheck={false}
            />
            {prefs.tidy_names && !prefs.anthropic_api_key && <p className="text-xs text-warn mt-1.5">Add a key to turn this on.</p>}
          </Row>
        </Section>

        <Section id="audio" title="Audio" description="File format, quality and how cuts are placed.">
          <Row title="Format" stack>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2" role="radiogroup" aria-label="Audio format">
              {FORMATS.map((f) => (
                <Choice key={f.value} selected={prefs.audio_format === f.value} onClick={() => save({ audio_format: f.value })} title={f.label} note={f.note} />
              ))}
            </div>
          </Row>
          {prefs.audio_format !== 'flac' && (
            <Row title="Quality" hint="Higher sounds closer to the original but makes bigger files." htmlFor="bitrate">
              <select id="bitrate" className="field w-44" value={prefs.audio_bitrate} onChange={(e) => save({ audio_bitrate: Number(e.target.value) })}>
                {[128, 192, 256, 320].map((b) => (
                  <option key={b} value={b}>{b} kbps{b === 320 ? ' (best)' : ''}</option>
                ))}
              </select>
            </Row>
          )}
          <Row title="Cut snapping" hint="How far a cut may move from the tracklist time to land in the gap between songs. Tracklist times are often a few seconds off." htmlFor="snap">
            <div className="flex items-center gap-3">
              <input id="snap" type="range" min={0} max={10} step={0.5} value={prefs.snap_window_s}
                onChange={(e) => save({ snap_window_s: Number(e.target.value) })} className="w-44 accent-[rgb(var(--accent))]" />
              <span className="text-[13px] tnum w-14 text-right">{prefs.snap_window_s === 0 ? 'Off' : `±${prefs.snap_window_s} s`}</span>
            </div>
          </Row>
          <Row title="Trim silence" hint="Removes silence at the start and end of each song, keeping a 0.15 s pause." htmlFor="trim-silence">
            <Switch id="trim-silence" checked={prefs.trim_silence} onChange={(v) => save({ trim_silence: v })} />
          </Row>
          <Row title="Fade in and out" hint="Audible fades at the start and end of each song. Useful when songs blend into each other." stack>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {([
                ['song-fade-in', 'In', 'song_fade_in_s'],
                ['song-fade-out', 'Out', 'song_fade_out_s'],
              ] as const).map(([id, label, key]) => (
                <label key={id} htmlFor={id} className="flex items-center gap-3">
                  <span className="text-[13px] text-muted w-7">{label}</span>
                  <input id={id} type="range" min={0} max={5} step={0.5} value={prefs[key]}
                    onChange={(e) => save({ [key]: Number(e.target.value) })} className="w-36 accent-[rgb(var(--accent))]" />
                  <span className="text-[13px] tnum w-10 text-right">{prefs[key] === 0 ? 'Off' : `${prefs[key]} s`}</span>
                </label>
              ))}
            </div>
          </Row>
          <Row title="Even out loudness" hint="Measured to the EBU R128 standard, so jukebox songs from different sources play at the same volume." stack>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2" role="radiogroup" aria-label="Even out loudness">
              {LOUDNESS.map((l) => (
                <Choice key={l.value} selected={prefs.loudness === l.value} onClick={() => save({ loudness: l.value })} title={l.label} note={l.note} />
              ))}
            </div>
          </Row>
          {prefs.loudness === 'normalize' && (
            <Row title="Target loudness" hint="Peaks are never pushed above -1 dB, and nothing is compressed." htmlFor="loudness-target">
              <select id="loudness-target" className="field w-72" value={prefs.loudness_target}
                onChange={(e) => save({ loudness_target: Number(e.target.value) })}>
                {LOUDNESS_TARGETS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Row>
          )}
          <Row title="Edge fade" hint="A tiny fade at each cut removes clicks. 10 ms can't be heard." htmlFor="fade">
            <div className="flex items-center gap-3">
              <input id="fade" type="range" min={0} max={50} step={5} value={prefs.edge_fade_ms}
                onChange={(e) => save({ edge_fade_ms: Number(e.target.value) })} className="w-44 accent-[rgb(var(--accent))]" />
              <span className="text-[13px] tnum w-14 text-right">{prefs.edge_fade_ms === 0 ? 'Off' : `${prefs.edge_fade_ms} ms`}</span>
            </div>
          </Row>
        </Section>

        <Section id="appearance" title="Appearance" description="How Cadence looks.">
          <Row title="Theme" stack>
            <div className="grid grid-cols-3 gap-2 max-w-lg" role="radiogroup" aria-label="Theme">
              {([
                ['dark', 'Dark', <Moon key="d" size={16} />],
                ['light', 'Light', <Sun key="l" size={16} />],
                ['system', 'System', <Monitor key="s" size={16} />],
              ] as [ThemePreference, string, ReactNode][]).map(([value, label, icon]) => (
                <Choice key={value} selected={theme === value} onClick={() => setTheme(value)} icon={icon} title={label} note={value === 'system' ? 'Match Windows' : `Always ${label.toLowerCase()}`} />
              ))}
            </div>
          </Row>
        </Section>

        <Section id="updates" title="Updates" description="Keep the YouTube downloader current.">
          <Row title="YouTube downloader" hint="YouTube changes often. Update yt-dlp if downloads start failing.">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-muted">yt-dlp {ytDlpVersion || '…'}</span>
              <button className="btn-secondary" onClick={updateYtDlp} disabled={busy === 'ytdlp'}>
                {busy === 'ytdlp' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                Check for update
              </button>
            </div>
          </Row>
          <Row title="Cadence" hint={updateHint}>
            <div className="flex items-center gap-2">
              {updateStatus.state === 'ready' ? (
                <button className="btn-primary" onClick={() => window.electronAPI?.installUpdate()}>
                  <RefreshCw size={14} aria-hidden="true" /> Restart to update
                </button>
              ) : (
                <button
                  className="btn-secondary"
                  onClick={() => window.electronAPI?.checkForUpdates()}
                  disabled={updateStatus.state === 'unsupported' || updateStatus.state === 'checking' || updateStatus.state === 'downloading'}
                >
                  {updateStatus.state === 'checking' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                  Check for updates
                </button>
              )}
            </div>
          </Row>
          <Row title="Troubleshooting" hint="Log files record what Cadence did. Include them if you report a problem.">
            <button className="btn-ghost" onClick={() => window.electronAPI?.openLogs()}>
              <FolderOpen size={14} aria-hidden="true" /> Open logs
            </button>
          </Row>
        </Section>
      </div>
    </div>
  )
}
