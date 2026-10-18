# Cadence

**A free, open-source YouTube downloader that splits jukeboxes, movie albums and singer collections into separate, tagged songs, and saves whole videos, playlists and courses.**

[Website](https://urgen-dorjee.github.io/CadenceApp/) · [Download](https://github.com/Urgen-Dorjee/CadenceApp/releases/latest)

Paste a link to a two-hour "Udit Narayan Superhits" jukebox or a full movie album. Cadence finds where each song starts and ends, cuts in the gap between songs so nothing is clipped and nothing spills over, and files the songs into your music library with titles, album, year, track numbers and cover art.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D6)
![Electron](https://img.shields.io/badge/Electron-33-47848F)
![React](https://img.shields.io/badge/React-19-61DAFB)
![Python](https://img.shields.io/badge/Python-3.12-3776AB)
![License](https://img.shields.io/badge/license-MIT-green)

**[⬇ Download the latest version](https://github.com/Urgen-Dorjee/CadenceApp/releases/latest)**

| System | Download | Updates |
|---|---|---|
| Windows 10/11 | `Cadence-Setup-<version>.exe` | Automatic |
| macOS, Apple Silicon (M1 and later) | `Cadence-<version>-mac-AppleSilicon.dmg` | From the Releases page |
| macOS, Intel | `Cadence-<version>-mac-Intel.dmg` | From the Releases page |
| Linux | `Cadence-<version>-linux-x86_64.AppImage`, or `.deb` for Ubuntu/Debian | Automatic (AppImage) |

**First launch on Windows:** the installer isn't code-signed yet, so Windows may say *"Windows protected your PC"*. Click **More info**, then **Run anyway**. Cadence is open source and each installer is built in public by GitHub (see *Checking a download* below).

**First launch on a Mac:** pick the download for your Mac's chip ( → About This Mac: "Apple M…" is `mac-AppleSilicon`, "Intel" is `mac-Intel`). The app isn't signed with an Apple Developer ID yet, so the first time you open it macOS says *"Cadence" Not Opened*. Click **Done**, then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. After that it opens normally.

If macOS ever says Cadence *"is damaged and can't be opened"*, click **Cancel** and run this once in Terminal, then open it again:

```bash
xattr -cr /Applications/Cadence.app
```

**AppImage on Linux:** make it executable (`chmod +x Cadence-*.AppImage`) and run it.

**Checking a download:** each release lists `SHA256SUMS.txt`, and every installer carries a GitHub build attestation proving it was built by this repository's release workflow from the tagged source. With the [GitHub CLI](https://cli.github.com/):

```bash
gh attestation verify Cadence-Setup-<version>.exe --repo Urgen-Dorjee/CadenceApp
```

Cadence is free and open source under the MIT license. Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md), and report security problems privately as described in [SECURITY.md](SECURITY.md).

---

## Contents

- [Features](#features)
- [How it finds the songs](#how-it-finds-the-songs)
- [Pasting a link again](#pasting-a-link-again)
- [Naming songs](#naming-songs)
- [Where songs go](#where-songs-go)
- [Video downloads](#video-downloads)
- [Library](#library)
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

- **Music or video.** New download has a **Music | Video** switch. Music splits a video into tagged songs; Video saves the whole video (lectures, documentaries, talks, courses) with subtitles and chapters.
- **One link in, an album out.** Works with single videos (jukeboxes, full albums, mixes) and playlists.
- **Many at once.** Paste several links or drop several files; they're split two at a time (1–4, in Settings). **Save all ready** saves every split whose cuts all look right and leaves the ones with cuts to check for you.
- **Whole playlists and channels.** Paste a playlist or channel link and choose: **Split each video** (a playlist of jukeboxes or full albums), **One album** (each video is one song) or **Just this video**. Cadence lists the videos with their length, can show only those of 20 minutes or more, and marks the ones already in your list or saved before so nothing is downloaded twice.
- **Your own files too.** Open or drop an audio or video file (MP3, FLAC, M4A, WAV, MKV, MP4…). Songs are cut straight from the original, which is never changed or deleted.
- **Finds song boundaries automatically** from chapters, the description, top comments or, as a last resort, the audio itself.
- **Clean, exact cuts.** Each cut moves to the real gap between songs, is sample-accurate and gets a short fade so there's no click.
- **Review before saving.** Waveform overview, per-cut close-ups, play any song, nudge cuts by 0.1 s, split at the playhead, join songs, include or skip songs.
- **Proper tags.** Title, artist, album artist, album, year, track number and cover art in MP3, M4A (AAC), Opus or FLAC.
- **Even loudness.** ReplayGain tags (audio untouched) or one fixed gain per song to a target loudness, measured to EBU R128. Silence at song edges is trimmed.
- **Organised library.** Configurable folder layouts per collection type, and a built-in Library with search and cover art.
- **Built-in player.** Play a song, an album or a singer; **Play next** and **Add to queue** on any song; a queue you can jump around in and trim; shuffle and repeat (all or one). Keyboard media keys, the Windows media overlay and macOS Now Playing show the song and its cover.
- **Send to phones, drives and music apps.** Copy a song, an album or a singer to a USB stick, SD card or a phone's music folder, in Singer/Album folders or all in one, optionally converted to MP3 for car stereos (tags and covers kept). Or add them to Apple Music / iTunes in one click when it's installed. The library itself is never changed.
- **Album details from MusicBrainz.** Look up a movie or album to fill in its name, year, singer and cover art, and every song name when the track count matches. No key needed.
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
| Listening | Silences between songs, and clear changes in the music for crossfaded songs | Lower, guesses flagged for review |
| Your own tracklist | Pasted on the review screen, or a `.cue` file | High |

When Cadence listens, a cut is kept only if the two sides are different songs. Songs repeat themselves (a chorus comes back), so if music after a cut repeats music before it, it's one song and the cut is dropped. A song is never cut just for being long, and a video under 12 minutes with no silence anywhere is treated as one song. When song recognition names two neighbouring pieces as the same song, they are joined.

`scripts/bench-cuts.py` measures this on any folder of songs (one song per file): it checks that each song alone stays whole, and that songs joined into jukeboxes are cut at the right places.

Timestamps are whole seconds and are often a few seconds off, so every cut then moves to where one song really ends and the next begins, within ±5 s (configurable in **Settings → Audio**):

- **Songs separated by a gap:** the cut goes in the middle of the silence. Short dips between notes or drum hits (under 150 ms) are ignored, so a cut can't land inside the end of a song.
- **Crossfaded songs (no gap):** the cut goes to the quietest point of the crossfade.
- If several gaps are in range, the one nearest the timestamp wins.
- **Drifting timestamps:** tracklists often fall further behind the audio as a video goes on (10 s or more by the end). Each cut that lands in a gap measures that drift, and the next cut is searched with it taken into account. If no gap is in range, a wider search (±15 s) accepts only a clear gap; failing that, the cut is marked **Check**.

The audio is then decoded and cut at exactly that point (accurate to about 1 ms), with a 10 ms fade so there's no click. Neighbouring songs share one cut point, so there's never a gap or an overlap.

### Your own tracklist

If YouTube has no tracklist, or a wrong one, click **Tracklist** on the review screen and paste one, one song per line:

```
0:00 Tujhe Dekha To
5:03 Mere Khwabon Mein
10:21 Ho Gaya Hai Tujhko
```

Start times (`0:00 Song`) and song lengths (`1. Song 4:12`, added up) are both understood, or open a `.cue` file, which also brings singers, album and year. Cuts are still moved to the real gaps, and the change can be undone.

Nothing is saved until you review the result. Uncertain cuts and segments too short to be a song are flagged.

Songs already in your library are marked **In library**, with a **Skip them** button. A match needs the same title once case, punctuation and upload noise are ignored, a shared singer when both name one, and lengths within 10 s.

The review screen is keyboard-friendly: **Space** plays, **←/→** move the cut (Shift for 1 s), **[ ]** jump between cuts, **H** plays the audio around a cut, **↑/↓** select songs, **X** includes or skips one, **S** splits at the playhead, **J** joins with the next song, and **Ctrl+Z / Ctrl+Shift+Z** undo and redo any change. Press **?** for the full list.

## Pasting a link again

Cadence remembers which songs it saved from each YouTube video and which part of the video each one is (in `cadence.db`, kept even after a split leaves the list), so a link pasted again carries on instead of starting over:

- **Its split is still in the list:** it opens. Songs saved before are marked **Saved**, and **Select the remaining** ticks only the ones not saved yet; saving those just adds them, numbered after the first ones, and the album's playlist is rewritten with every song.
- **The split was removed, but songs from it are in your library:** Cadence says so, with **Show them** (those songs in the Library) or **Split it again**, where the songs you already have come unticked. They're recognised by the part of the video they came from, so renamed songs and ones still called "Track 3" count too.
- **A video downloaded whole before:** "Video ready" offers to play your copy or download it again in another quality (with the choices screen off, it just plays).

Saving songs that were saved before still asks whether to replace them or keep both. Replacing never removes a song you only left unticked.

## Splitting files from your computer

Click **Open a file…** on the New split screen, or drop a file onto it. Cadence finds the songs in this order:

1. A `.cue` sheet with the same name next to the file (`Album.flac` + `Album.cue`), which also brings singers, album and year
2. Chapters inside the file (MKV, MP4, M4B)
3. The audio itself, as for YouTube videos

Songs are cut from the original file, so there's no extra quality loss. Files the built-in player can't play (most video formats, WMA, APE) get a small playback copy in the job's work folder. Cadence never moves, changes or deletes the original, not even when you remove the job or clear downloads.

## Naming songs

When a video has no tracklist, songs start out as "Track 1", "Track 2"… Two optional helpers can name them. Both are off by default and both use your own key:

| Helper | What it does | What is sent | Key |
|---|---|---|---|
| **Identify by sound** | Fingerprints each song with Chromaprint and looks it up on AcoustID / MusicBrainz | The audio fingerprint and duration only | Free, from [acoustid.org](https://acoustid.org/new-application) |
| **Tidy names (AI)** | Cleans titles like "Song (Official Audio) \| Channel", fills in singers and album from the description, picks the collection type | Text only (title, channel, description, song names). Never audio | Anthropic API key, about 1–5 US cents per split |

Both can run automatically after a split or from buttons on the review screen. Both can be undone. Keys are entered in **Settings** and stored locally in `preferences.json`.

**Find album details** (for a movie album, next to the album name) needs no key. It searches [MusicBrainz](https://musicbrainz.org) for the album name (and singer, if typed), lists the matching albums with their cover, year and number of songs, and fills in the chosen album's name, year, album singer and cover art from the [Cover Art Archive](https://coverartarchive.org). When the album has the same number of songs as the split, it also names every song and its singers, in order. Only the names you type are sent. **Undo** puts everything back, including the cover.

## Where songs go

Cadence guesses what kind of video it is from the title, and you can change the guess on the review screen.

```
Music/Cadence/
├── Artists/Udit Narayan/Udit Narayan - Pehla Nasha.mp3                 singer collection
├── Albums/Dilwale Dulhania Le Jayenge (1995)/03 - Tujhe Dekha To.mp3   movie album
├── Collections/90s Romantic Hits/07 - ….mp3                             mixed collection
└── Singles/….mp3
```

Audio options (**Settings → Audio**):

- **Format:** MP3, M4A (AAC), Opus, FLAC, or **Original**: the audio exactly as downloaded (usually Opus), copied without re-encoding so nothing is lost. With Original, cuts land within about 20 ms, audible fades are skipped and *Adjust volume* writes ReplayGain tags instead; audio that can't be copied as it is (WMA, WAV, video soundtracks) is saved as lossless FLAC.
- **Trim silence:** removes silence at the start and end of each song, keeping a 0.15 s pause (on by default).
- **Fade in and out:** audible fades of up to 5 s at song edges, useful when songs blend into each other.
- **Even out loudness:** *ReplayGain tags* measures each song and the whole album (EBU R128) and writes ReplayGain tags (and R128 gains for Opus); players even out the volume and the audio is untouched. *Adjust volume* applies one fixed gain per song to reach −14, −16, −18 or −23 LUFS, never pushing peaks above −1 dBTP and never compressing.

Saving options (**Settings → Saving songs**):

- **Where to save:** always your library folder, or ask for a folder each time.
- **This split only:** "Change folder" on the review screen saves one split somewhere else.
- **Folder layout:** a preset per collection type (e.g. `Singer › Song`, `Movie - 01 - Song`) or your own template using `{artist}`, `{album}`, `{collection}`, `{year}`, `{year_suffix}`, `{track:02}` and `{title}`.
- **Lyrics** (off by default): looked up on [LRCLIB](https://lrclib.net), a free lyrics database, and embedded in the songs, optionally with synced `.lrc` files next to them. Only the title, singer, album and length are sent
- **Cover art:** wide video thumbnails are cropped to a square album cover (can be turned off); **Change cover…** on the review screen uses your own image for a split
- **Playlist file:** an `.m3u8` playlist next to each album or collection keeps the song order in other players (on by default)
- **When saving finishes:** optionally show the songs in File Explorer.
- **Disk space:** keep or delete downloaded audio after saving, and see and clear what's kept.

Cadence never overwrites a file it didn't save. A clash becomes `Song (2).mp3`. When you save a split again, you can **replace** the songs it saved last time (anything no longer in the split goes to the Recycle Bin) or **keep both**.

## Video downloads

Switch **New download** to **Video** to save whole videos instead of songs.

- **Choose before downloading.** "Video ready" shows each quality the video has with its file size (4K, 1440p, 1080p, 720p, 480p, or sound only as M4A), its subtitles and its chapters. A video that doesn't have the chosen quality gets the next lower one. Turn the screen off in Settings to download straight away.
- **MP4 or MKV.** MP4 prefers H.264 and AAC, which play on every phone, TV and computer. MKV takes the best formats and keeps every track.
- **Subtitles** in your languages, inside the video, as .srt files or both, with YouTube's automatic captions when the uploader added none. One track per language.
- **Chapters, thumbnail and description** are kept with the video.
- **Playlists and courses** save in order as numbered files in their own folder, skip videos already saved, and pause 5–10 s between videos so YouTube doesn't block downloads.
- **Pause and resume.** A paused download carries on from where it stopped. Cancel removes the unfinished file.
- **Downloads** lists music splits and videos together; the **Library** has a **Videos** tab with search and filters for courses and subtitles.
- **Built-in player.** Videos play inside Cadence: subtitles (from the .srt files or inside the video), chapters on the seek bar and in a list, speed from 0.5× to 2×, full screen and picture in picture. It carries on where you stopped, marks watched videos in the library, and plays a course in order. Keys: Space or K play, ←/→ 5 s, J/L 10 s, ↑/↓ volume, M mute, C subtitles, F full screen, < and > speed, Shift+N/P next or previous video, 0–9 jump. A file whose picture or sound it can't decode opens in another player.

Videos go to `Videos\Cadence\<Channel>\` by default (Settings → Video downloads), with a speed limit if you share the connection.

## Library

The Library lists every saved song, and any audio already in your library folder, by album, singer or song, with cover art, search and a built-in player. It rescans at startup to pick up files added, changed or deleted outside Cadence.

Click the pencil on a song to fix its title, singer, album, year or track number, or **Edit all** on an album or singer to change every song there at once. Only the tags you change are rewritten; cover art and ReplayGain values are kept.

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

- **Windows 10/11, macOS 12+ or Linux** (x64; Apple Silicon on macOS)
- **Node.js 20+** and npm
- **Python 3.12** (`python` on Windows, `python3` on macOS and Linux)
- About 400 MB free for FFmpeg, Deno and fpcalc, which are downloaded by the setup scripts

### Install and run

```bash
git clone https://github.com/Urgen-Dorjee/CadenceApp.git
cd CadenceApp

npm install
npm run setup:all     # creates backend/venv, downloads FFmpeg, Deno and fpcalc for your system into resources/
npm run dev           # starts Vite, Electron and the Python backend
```

`setup:all` runs four steps you can also run on their own: `setup:python`, `setup:ffmpeg`, `setup:deno` and `setup:chromaprint`.

### Running the backend on its own

Electron normally starts the backend with a random port and a per-launch token. To run it directly:

```bash
cd backend
venv/Scripts/python main.py --port 8321    # Windows
venv/bin/python main.py --port 8321        # macOS and Linux
```

If `CADENCE_TOKEN` isn't set, the backend prints a generated token. Every request needs it in the `x-cadence-token` header.

| Variable | Purpose |
|---|---|
| `CADENCE_TOKEN` | Shared secret required on every request (set by Electron) |
| `BACKEND_PORT` | Port to listen on (default `8321`; Electron picks a free one) |
| `CADENCE_DATA_DIR` | Override the data folder (set by Electron; see [Data, logs and troubleshooting](#data-logs-and-troubleshooting)) |
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
| `npm run lint` | ESLint (frontend, Electron) and Ruff (backend) |

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

This bundles a standalone Python with only the dependencies in `backend/requirements.txt`, builds the UI and packages the app for the system you're on:

- **Windows:** `Cadence-Setup-<version>.exe` in `C:\temp\Cadence-release\` (intermediate files go to `C:\temp\` to avoid OneDrive file locks). Python is copied from your installed Python 3.12.
- **macOS:** a `.dmg` in `release/`. Python comes from [python-build-standalone](https://github.com/astral-sh/python-build-standalone), a relocatable build. The app gets an ad-hoc signature, which Apple Silicon requires; set `CSC_LINK` / `CSC_KEY_PASSWORD` to sign with a Developer ID instead.
- **Linux:** an AppImage and a `.deb` in `release/`, also with python-build-standalone.

The build fails if the backend can't import its dependencies or if the preload script isn't CommonJS. The Release workflow builds all of them on GitHub (Windows, macOS Apple Silicon and Intel, Linux), so you don't need a Mac or Linux machine.

### Publish an update

Installed copies on Windows and Linux (AppImage) check for updates every six hours, download them in the background and show **Restart to update**. macOS only installs updates for apps signed with an Apple Developer ID, so until Cadence is signed, the Mac app checks for a newer release and shows **Cadence X available** with a link to download it. The YouTube downloader (yt-dlp) can be updated separately from Settings; that update is kept in Cadence's data folder, never inside the app. Updates are published to this repository's [Releases](https://github.com/Urgen-Dorjee/CadenceApp/releases) (configured under `build.publish` in `package.json`).

**Automatically (recommended):**

1. Bump `version` in `package.json` (for example `npm version 2.1.0 --no-git-tag-version`) and commit.
2. Tag and push: `git tag v2.1.0 && git push origin master v2.1.0`.

The **Release** workflow (`.github/workflows/release.yml`) checks the tag matches `package.json`, then on Windows, macOS (Apple Silicon and Intel) and Linux runs all tests and builds the installers, and finally publishes them in one release with the update feeds (`latest.yml`, `latest-linux.yml`). It adds `SHA256SUMS.txt` and a build attestation for every installer. It uses the repository's built-in token, so no secrets are needed; Windows signing through SignPath (free for open source) switches on when its token is added, as described in [CONTRIBUTING.md](CONTRIBUTING.md#free-code-signing-for-windows). Pushing to a branch named `build/<anything>`, or running the workflow by hand, builds everything without publishing and keeps the installers as files of that run.

**By hand:** set `GH_TOKEN` to a GitHub token with **Contents: read and write** on this repository, then run `npm run release`.

Every push and pull request also runs the **CI** workflow on Windows, macOS and Linux: type check, frontend tests and backend tests with real FFmpeg.

### Code signing (optional)

Unsigned installers work, but Windows SmartScreen shows "Windows protected your PC" until the download builds a reputation. To sign, get an OV/EV code-signing certificate or use Azure Trusted Signing. For a `.pfx` file, set `CSC_LINK` (path or base64) and `CSC_KEY_PASSWORD` before building, or add them as repository secrets for the Release workflow, and electron-builder will sign automatically.

## Data, logs and troubleshooting

| What | Where |
|---|---|
| Data folder | Windows `%APPDATA%\Cadence`, macOS `~/Library/Application Support/Cadence`, Linux `~/.config/Cadence` |
| Jobs database | `<data folder>/cadence.db` |
| Preferences (including API keys) | `<data folder>/preferences.json` |
| Downloaded audio, waveforms, thumbnails | `<data folder>/work/<job id>/` |
| Backups | `<data folder>/backups/`: the database and settings, copied daily and before each database upgrade; the newest 7 are kept (**Settings → Updates → Backups**) |
| Logs | `<data folder>/logs/main.log` (**Settings → Updates → Open logs**) |
| Saved songs | `Music/Cadence` in your home folder by default |

- **"Sign in to confirm you're not a bot" or downloads failing:** YouTube changes often. Open **Settings → Updates** and update the YouTube downloader (yt-dlp), then restart Cadence.
- **Age-restricted videos, or the bot check keeps coming back:** Cadence needs the YouTube sign-in of a browser you're signed in to (**Settings → YouTube → YouTube sign-in**). Choose **Firefox** if you use it. On Windows, Chrome, Edge and Brave lock their sign-in so other apps can't read it: export it once with the free extension *Get cookies.txt LOCALLY* on youtube.com, then choose **A cookies.txt file…**. Cadence checks the file contains a current YouTube sign-in. (Google refuses sign-in inside app windows, so Cadence can't sign in by itself.) A proxy can be set there too.
- **"FFmpeg not found" in development:** run `npm run setup:ffmpeg`.
- **Identify by sound says fpcalc is missing:** run `npm run setup:chromaprint`.
- **Reporting a problem:** **Settings → Updates → Copy diagnostics** copies versions, tool status, settings (keys and the proxy only as "set") and the end of the log, with your home folder hidden. Paste it into the issue.
- **Restoring a backup:** quit Cadence, then copy a file from `backups/` over `cadence.db` (and the matching `preferences-….json` over `preferences.json`).
- **The audio engine keeps stopping:** it restarts automatically up to three times in ten minutes. After that, check `main.log`.

## Legal note

Downloading from YouTube is against its Terms of Service unless you own the content or have permission. Cadence is intended for personal use with content you're allowed to download. You are responsible for how you use it.

## License

[MIT](LICENSE) © 2026 Urgen Dorjee
