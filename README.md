# Cadence

**Split YouTube jukeboxes, movie albums and singer collections into separate, tagged songs.**

Paste a link to a two-hour "Udit Narayan Superhits" jukebox or a full movie album. Cadence finds where each song starts and ends, cuts in the gap between songs so nothing is clipped and nothing spills over, and files the songs into your music library with titles, album, year, track numbers and cover art.

![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6)
![Electron](https://img.shields.io/badge/Electron-33-47848F)
![React](https://img.shields.io/badge/React-19-61DAFB)
![Python](https://img.shields.io/badge/Python-3.12-3776AB)
![License](https://img.shields.io/badge/license-MIT-green)

**[⬇ Download the latest Windows installer](https://github.com/Urgen-Dorjee/CadenceApp/releases/latest)** (`Cadence-Setup-<version>.exe`). Installed copies update themselves.

---

## Contents

- [Features](#features)
- [How it finds the songs](#how-it-finds-the-songs)
- [Naming songs](#naming-songs)
- [Where songs go](#where-songs-go)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [Architecture](#architecture)
- [Building and releasing](#building-and-releasing)
- [Data, logs and troubleshooting](#data-logs-and-troubleshooting)
- [Legal note](#legal-note)
- [License](#license)

---

## Features

- **One link in, an album out.** Works with single videos (jukeboxes, full albums, mixes) and playlists.
- **Finds song boundaries automatically** from chapters, the description, top comments or, as a last resort, the audio itself.
- **Clean, exact cuts.** Each cut moves to the real gap between songs, is sample-accurate and gets a short fade so there's no click.
- **Review before saving.** Waveform overview, per-cut close-ups, play any song, nudge cuts by 0.1 s, split at the playhead, join songs, include or skip songs.
- **Proper tags.** Title, artist, album artist, album, year, track number and cover art in MP3, M4A (AAC), Opus or FLAC.
- **Organised library.** Configurable folder layouts per collection type, and a built-in Library with search, cover art and a player.
- **Optional naming helpers.** Identify songs by sound with AcoustID, or tidy messy names with AI.
- **Resilient.** Jobs persist across restarts, the audio engine restarts itself if it crashes, and the app updates itself in the background.
- **Themes.** Dark (default), Light or follow Windows.

## How it finds the songs

Cadence trusts the most reliable source it can find, in this order:

| Source | How | Confidence |
|---|---|---|
| Playlist | Each video is one song | Exact |
| YouTube chapters | Read from the video's metadata | High |
| Description timestamps | `00:00 Song name`, `1. Song - 3:45`, `[04:12] Song`, ranges | High |
| Top comments | The comment with the most timestamps | Medium |
| Audio gaps | Quiet stretches in the waveform, longest first, songs at least 90 s long | Lower, flagged for review |

Timestamps are whole seconds and are often a few seconds off, so every cut then moves to where one song really ends and the next begins, within ±5 s (configurable in **Settings → Audio**):

- **Songs separated by a gap:** the cut goes in the middle of the silence. Short dips between notes or drum hits (under 150 ms) are ignored, so a cut can't land inside the end of a song.
- **Crossfaded songs (no gap):** the cut goes to the quietest point of the crossfade.
- If several gaps are in range, the one nearest the timestamp wins.

The audio is then decoded and cut at exactly that point (accurate to about 1 ms), with a 10 ms fade so there's no click. Neighbouring songs share one cut point, so there's never a gap or an overlap.

Nothing is saved until you review the result. Uncertain cuts and segments too short to be a song are flagged.

## Naming songs

When a video has no tracklist, songs start out as "Track 1", "Track 2"… Two optional helpers can name them. Both are off by default and both use your own key:

| Helper | What it does | What is sent | Key |
|---|---|---|---|
| **Identify by sound** | Fingerprints each song with Chromaprint and looks it up on AcoustID / MusicBrainz | The audio fingerprint and duration only | Free, from [acoustid.org](https://acoustid.org/new-application) |
| **Tidy names (AI)** | Cleans titles like "Song (Official Audio) \| Channel", fills in singers and album from the description, picks the collection type | Text only (title, channel, description, song names). Never audio | Anthropic API key, about 1–5 US cents per split |

Both can run automatically after a split or from buttons on the review screen. Both can be undone. Keys are entered in **Settings** and stored locally in `preferences.json`.

## Where songs go

Cadence guesses what kind of video it is from the title, and you can change the guess on the review screen.

```
Music/Cadence/
├── Artists/Udit Narayan/Udit Narayan - Pehla Nasha.mp3                 singer collection
├── Albums/Dilwale Dulhania Le Jayenge (1995)/03 - Tujhe Dekha To.mp3   movie album
├── Collections/90s Romantic Hits/07 - ….mp3                             mixed collection
└── Singles/….mp3
```

Saving options (**Settings → Saving songs**):

- **Where to save:** always your library folder, or ask for a folder each time.
- **This split only:** "Change folder" on the review screen saves one split somewhere else.
- **Folder layout:** a preset per collection type (e.g. `Singer › Song`, `Movie - 01 - Song`) or your own template using `{artist}`, `{album}`, `{collection}`, `{year}`, `{year_suffix}`, `{track:02}` and `{title}`.
- **When saving finishes:** optionally show the songs in File Explorer.
- **Disk space:** keep or delete downloaded audio after saving, and see and clear what's kept.

Cadence never overwrites an existing file. A clash becomes `Song (2).mp3`.

## Tech stack

| Layer | Technologies |
|---|---|
| Desktop shell | Electron 33, electron-builder (NSIS installer), electron-updater, electron-log |
| UI | React 19, TypeScript, Vite 6, Tailwind CSS, Radix UI, Zustand, Framer Motion, wavesurfer.js, lucide-react |
| Audio engine | Python 3.12, FastAPI, Uvicorn, WebSockets, SQLite, numpy, mutagen |
| Media tools | yt-dlp (+ Deno for YouTube's player JavaScript), FFmpeg, Chromaprint `fpcalc` |
| Tests | Vitest + Testing Library (frontend), pytest (backend, including real FFmpeg cuts) |

## Getting started

### Prerequisites

- **Windows 10 or 11** (x64). The build scripts and bundled tools are Windows-specific.
- **Node.js 20+** and npm
- **Python 3.12** on `PATH`
- About 400 MB free for FFmpeg, Deno and fpcalc, which are downloaded by the setup scripts

### Install and run

```bash
git clone https://github.com/Urgen-Dorjee/CadenceApp.git
cd CadenceApp

npm install
npm run setup:all     # creates backend/venv, downloads FFmpeg, Deno and fpcalc into resources/
npm run dev           # starts Vite, Electron and the Python backend
```

`setup:all` runs four steps you can also run on their own: `setup:python`, `setup:ffmpeg`, `setup:deno` and `setup:chromaprint`.

### Running the backend on its own

Electron normally starts the backend with a random port and a per-launch token. To run it directly:

```bash
cd backend
venv\Scripts\python.exe main.py --port 8321
```

If `CADENCE_TOKEN` isn't set, the backend prints a generated token. Every request needs it in the `x-cadence-token` header.

| Variable | Purpose |
|---|---|
| `CADENCE_TOKEN` | Shared secret required on every request (set by Electron) |
| `BACKEND_PORT` | Port to listen on (default `8321`; Electron picks a free one) |
| `CADENCE_DATA_DIR` | Override the data folder (default `%APPDATA%\Cadence`) |
| `FFMPEG_PATH`, `DENO_PATH`, `FPCALC_PATH` | Paths to the bundled tools (fall back to `resources/` and `PATH`) |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the app in development with hot reload |
| `npm test` | Frontend tests (Vitest) |
| `npm run test:watch` | Frontend tests in watch mode |
| `npm run test:backend` | Backend tests (pytest, needs `backend/venv` and FFmpeg) |
| `npm run setup:all` | Set up the Python venv and download FFmpeg, Deno and fpcalc |
| `npm run build` | Build the backend bundle, the frontend and the Windows installer |
| `npm run release` | Build and publish the installer to GitHub Releases (see below) |

## Project structure

```
.
├── electron/                Electron main process
│   ├── main.ts              Window, menus, IPC, backend lifecycle and crash restarts
│   ├── preload.ts           The only bridge between the UI and Node (contextIsolation + sandbox)
│   ├── python-manager.ts    Starts the backend, waits for /api/health, forwards logs
│   ├── ffmpeg-manager.ts    Locates FFmpeg
│   └── auto-updater.ts      Background updates via electron-updater
├── src/                     React UI
│   ├── pages/               Home, Review, Library and Settings screens
│   ├── components/          Layout, job cards, review editor, waveform, player
│   ├── stores/              Zustand stores (jobs, player, preferences, theme)
│   ├── services/api.ts      REST + WebSocket client
│   └── lib/                 Pure helpers (time, tracks, waveform, paths), unit-tested
├── backend/                 Python audio engine (FastAPI)
│   ├── main.py              App, token and Host-header checks, WebSocket endpoint
│   ├── config.py            Process settings and user preferences
│   ├── core/                SQLite job store, FFmpeg/Deno lookup, WebSocket manager
│   ├── routers/             /api/jobs, /api/library and system endpoints
│   ├── services/            Pipeline, tracklist parsing, audio analysis, export, library index,
│   │                        AcoustID identification and AI name tidying
│   └── tests/               pytest suite
├── scripts/                 Setup, tool download and backend packaging scripts
├── resources/               App icon; FFmpeg, Deno and fpcalc are downloaded here (git-ignored)
└── package.json             Scripts and electron-builder configuration
```

## Architecture

```
Electron (React UI) ──REST + WebSocket, per-launch token──► FastAPI on 127.0.0.1:<random port>
                                                              │
                                    SQLite job store ◄── pipeline: resolve → download → analyze → review → export
                                                              │
                                                yt-dlp · FFmpeg · numpy · mutagen
```

Key modules:

- `backend/services/tracklist.py`: tracklist parsing and collection classification (pure, unit-tested)
- `backend/services/audio_analysis.py`: silence-based fallback and cut snapping
- `backend/services/exporter.py`: sample-accurate cuts, encoding, tags and cover art
- `backend/services/pipeline.py`: job stages, progress, cancellation and concurrency limits
- `src/pages/ReviewPage.tsx`: the review and editing screen

Job lifecycle: `queued → resolving → downloading → analyzing → review → exporting → completed`. Any running job can become `failed` or `cancelled`. Jobs interrupted by closing the app can be retried.

### Security

- The backend listens only on `127.0.0.1`.
- Every request needs a random token that Electron generates at each launch. Requests with a foreign `Host` header are rejected, which blocks DNS rebinding.
- Media is only served from a job's own work folder, and the token is redacted from logs.
- The renderer runs with `contextIsolation`, `sandbox` and no Node integration. External links open in the system browser.

## Building and releasing

### Build the installer

```bash
npm run build
```

This packages a standalone Python runtime with only the dependencies in `backend/requirements.txt`, builds the UI and creates `Cadence-Setup-<version>.exe` in `C:\temp\Cadence-release\`. Intermediate files go to `C:\temp\` to avoid OneDrive file locks. The build fails if the backend can't import its dependencies or if the preload script isn't CommonJS.

### Publish an update

Installed copies check for updates every six hours, download them in the background and show **Restart to update**. Updates are published to this repository's [Releases](https://github.com/Urgen-Dorjee/CadenceApp/releases) (configured under `build.publish` in `package.json`).

1. Bump `version` in `package.json` and commit.
2. Create a GitHub token with **Contents: read and write** on `CadenceApp`.
3. Publish:

   ```powershell
   $env:GH_TOKEN = "<token>"
   npm run release
   ```

   This uploads the installer and `latest.yml`, which is the update feed.
4. Tag the source: `git tag v<version> && git push --tags`.

### Code signing (optional)

Unsigned installers work, but Windows SmartScreen shows "Windows protected your PC" until the download builds a reputation. To sign, get an OV/EV code-signing certificate or use Azure Trusted Signing. For a `.pfx` file, set `CSC_LINK` (path or base64) and `CSC_KEY_PASSWORD` before building, and electron-builder will sign automatically.

## Data, logs and troubleshooting

| What | Where |
|---|---|
| Jobs database | `%APPDATA%\Cadence\cadence.db` |
| Preferences (including API keys) | `%APPDATA%\Cadence\preferences.json` |
| Downloaded audio, waveforms, thumbnails | `%APPDATA%\Cadence\work\<job id>\` |
| Logs | `%APPDATA%\Cadence\logs\main.log` (**Settings → Updates → Open logs**) |
| Saved songs | `%USERPROFILE%\Music\Cadence` by default |

- **"Sign in to confirm you're not a bot" or downloads failing:** YouTube changes often. Open **Settings → Updates** and update the YouTube downloader (yt-dlp), then restart Cadence.
- **"FFmpeg not found" in development:** run `npm run setup:ffmpeg`.
- **Identify by sound says fpcalc is missing:** run `npm run setup:chromaprint`.
- **The audio engine keeps stopping:** it restarts automatically up to three times in ten minutes. After that, check `main.log`.

## Legal note

Downloading from YouTube is against its Terms of Service unless you own the content or have permission. Cadence is intended for personal use with content you're allowed to download. You are responsible for how you use it.

## License

[MIT](LICENSE) © 2026 Urgen Dorjee
