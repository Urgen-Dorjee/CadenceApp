import { describe, expect, it } from 'vitest'
import type { Preferences, Track } from '../types/job'
import { breakablePath, folderOf, previewPath } from './paths'

const prefs: Preferences = {
  library_dir: 'C:\\Users\\me\\Music\\Cadence',
  save_mode: 'library',
  open_when_done: true,
  keep_downloads: true,
  write_playlist: true,
  square_cover: true,
  lyrics: 'off',
  cookies_from: '',
  cookies_file: '',
  proxy: '',
  onboarded: true,
  identify_songs: false,
  acoustid_key: '',
  tidy_names: false,
  anthropic_api_key: '',
  audio_format: 'mp3',
  audio_bitrate: 320,
  edge_fade_ms: 10,
  snap_window_s: 5,
  trim_silence: true,
  song_fade_in_s: 0,
  song_fade_out_s: 0,
  loudness: 'off',
  loudness_target: -14,
  artist_template: 'Artists/{artist}/{artist} - {title}',
  album_template: 'Albums/{album}{year_suffix}/{track:02} - {title}',
  collection_template: 'Collections/{collection}/{track:02} - {title}',
  single_template: 'Singles/{title}',
}

const song: Track = { id: '1', title: 'Pehla Nasha', artist: '', start: 0, end: 1, source_id: 's', origin: 'chapters', confidence: 1, include: true }

describe('previewPath', () => {
  it('matches the backend layout for singer collections', () => {
    const p = previewPath(song, 1, { type: 'artist', artist: 'Udit Narayan', name: '', album: '', year: '' }, prefs)
    expect(p).toBe('C:\\Users\\me\\Music\\Cadence\\Artists\\Udit Narayan\\Udit Narayan - Pehla Nasha.mp3')
  })
  it('pads track numbers and adds the year for albums', () => {
    const p = previewPath(song, 4, { type: 'album', album: 'Jo Jeeta Wohi Sikandar', year: '1992', artist: '', name: '' }, prefs)
    expect(p).toBe('C:\\Users\\me\\Music\\Cadence\\Albums\\Jo Jeeta Wohi Sikandar (1992)\\04 - Pehla Nasha.mp3')
  })
  it('never lets a title create folders', () => {
    const p = previewPath({ ...song, title: 'Love / Hate: Live?' }, 1, { type: 'single', artist: '', name: '', album: '', year: '' }, prefs)
    expect(p).toBe('C:\\Users\\me\\Music\\Cadence\\Singles\\Love Hate Live.mp3')
  })
  it('breakablePath adds a break opportunity after each separator', () => {
    expect(breakablePath('C:\\a\\b.mp3')).toBe('C:\\\u200ba\\\u200bb.mp3')
    expect(breakablePath('x/y')).toBe('x/\u200by')
  })
  it('folderOf strips the file name', () => {
    expect(folderOf('C:\\a\\b\\c.mp3')).toBe('C:\\a\\b')
  })
})

describe('previewPath with the Original format', () => {
  it('leaves the extension to the saved file', () => {
    const p = previewPath(song, 1, { type: 'single', artist: '', name: '', album: '', year: '' }, { ...prefs, audio_format: 'original' })
    expect(p).toBe('C:\\Users\\me\\Music\\Cadence\\Singles\\Pehla Nasha')
  })
})
