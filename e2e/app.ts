import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'

/** The FFmpeg Cadence bundles (npm run setup:ffmpeg), else one on PATH. */
export function ffmpeg(): string {
  const bundled = join(ROOT, 'resources', 'ffmpeg', isWindows ? 'ffmpeg.exe' : 'ffmpeg')
  return existsSync(bundled) ? bundled : 'ffmpeg'
}

function python(): string {
  const venv = join(ROOT, 'backend', 'venv', isWindows ? 'Scripts/python.exe' : 'bin/python')
  return existsSync(venv) ? venv : isWindows ? 'python' : 'python3'
}

/** Two 100-second (Cadence never makes songs under 90 s) "songs" (different tones) with 3 s of silence between them. */
export function makeTwoSongs(dir: string): string {
  const out = join(dir, 'two-songs.mp3')
  execFileSync(ffmpeg(), [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=100', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=3',
    '-f', 'lavfi', '-i', 'sine=frequency=660:duration=100',
    '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1', '-b:a', '128k', out,
  ])
  return out
}

/** A 4-second MP4 lecture with two chapters, recorded in the data folder's video library. */
export function seedLecture(dataDir: string, videoDir: string): string {
  mkdirSync(videoDir, { recursive: true })
  const chapters = join(videoDir, 'chapters.txt')
  writeFileSync(chapters, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=2000\ntitle=Intro\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=2000\nEND=4000\ntitle=Main part\n')
  const video = join(videoDir, 'Lecture 1.mp4')
  execFileSync(ffmpeg(), [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=500:duration=4', '-i', chapters, '-map', '0:v', '-map', '1:a',
    '-map_metadata', '2', '-map_chapters', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video,
  ])
  const record = JSON.stringify({ path: video, video_id: 'e2eLecture1', title: 'Lecture 1', channel: 'Test School', duration: 4, height: 240, ext: 'mp4' })
  execFileSync(python(), ['-c', `import json, sys; sys.path.insert(0, 'backend'); from core.db import get_store; get_store().add_video(json.loads(sys.argv[1]))`, record], {
    cwd: ROOT, env: { ...process.env, CADENCE_DATA_DIR: dataDir },
  })
  return video
}

export interface Launched {
  app: ElectronApplication
  page: Page
  dataDir: string
  musicDir: string
  videoDir: string
  /** Console errors, page errors and Content-Security-Policy violations seen so far. */
  problems: string[]
}

/** Start the built app with its own data folder and music/video folders in a temp directory. */
export async function launch(setup?: (dirs: { dataDir: string; videoDir: string }) => void): Promise<Launched> {
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(join(ROOT, 'dist-electron', 'main.js'))) {
    throw new Error('Build the app first: npm run build:frontend')
  }
  const base = mkdtempSync(join(tmpdir(), 'cadence-e2e-'))
  const dataDir = join(base, 'data')
  const musicDir = join(base, 'music')
  const videoDir = join(base, 'videos')
  mkdirSync(dataDir, { recursive: true })
  // Never the real Music folder; no song identification or lyrics (they'd use the network).
  writeFileSync(join(dataDir, 'preferences.json'), JSON.stringify({
    version: 3, onboarded: false, library_dir: musicDir, video_dir: videoDir, identify_songs: false, lyrics: 'off',
  }))
  setup?.({ dataDir, videoDir })
  const app = await electron.launch({
    args: [ROOT, `--user-data-dir=${dataDir}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    cwd: ROOT,
    env: { ...process.env, VITE_DEV_SERVER_URL: '' },
  })
  const page = await app.firstWindow()
  const problems: string[] = []
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()} (${m.location().url})`))
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  // Chromium reports Content-Security-Policy violations as console errors. Reload once so the
  // first load is watched too.
  await page.waitForLoadState('domcontentloaded')
  await page.reload()
  return { app, page, dataDir, musicDir, videoDir, problems }
}

/** Call the app's backend from the window, as the interface does. */
export async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(async ({ method, path, body }) => {
    const info = await window.electronAPI!.getBackendInfo()
    const res = await fetch(`http://127.0.0.1:${info.port}${path}`, {
      method,
      headers: { 'x-cadence-token': info.token, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
    return res.json()
  }, { method, path, body }) as Promise<T>
}
