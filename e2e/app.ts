import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync, execSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
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

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise.then(() => true), new Promise<boolean>((done) => setTimeout(() => done(false), ms))])

/** Electron's helper processes (zygote, GPU, crash reporter) still running from this checkout. */
function electronLeftovers(): string[] {
  if (isWindows) return []
  try {
    return execSync('ps -eo pid,cmd', { encoding: 'utf8' }).split('\n').filter((l) => l.includes(join(ROOT, 'node_modules', 'electron')))
  } catch {
    return []
  }
}

/**
 * Quit the app as a user would and check its process exits within 15 s; otherwise show why
 * (the end of its log and the processes still running), stop it, and fail.
 *
 * On Linux, Electron's helper processes can keep the output pipes Playwright watches open after
 * the app itself has exited, so app.close() may never finish: what's checked is the exit.
 */
export async function quit(run: Launched): Promise<void> {
  const child = run.app.process()
  const pid = child.pid
  const exitedEvent = new Promise<void>((done) => (child.exitCode !== null ? done() : child.once('exit', () => done())))
  run.app.evaluate(({ app }) => app.quit()).catch(() => undefined)  // the call ends when the app does
  const exited = await within(exitedEvent, 15_000)
  if (exited) {
    if (!(await within(run.app.close(), 10_000))) {
      const leftovers = electronLeftovers()
      if (leftovers.length) execSync(`kill -KILL ${leftovers.map((l) => l.trim().split(/\s+/)[0]).join(' ')}`)
    }
    return
  }
  const log = join(run.dataDir, 'logs', 'main.log')
  const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').slice(-60) : ['(none)']
  console.error(['--- main.log (end) ---', ...lines].join('\n'))
  try {
    const running = execSync(isWindows ? 'tasklist' : 'ps -eo pid,ppid,stat,etime,cmd --forest', { encoding: 'utf8' })
      .split('\n')
      .filter((l) => /electron|python|Cadence/i.test(l))
    console.error(['--- still running ---', ...running].join('\n'))
  } catch {
    /* listing processes is only for the report */
  }
  if (pid) {
    try {
      execSync(isWindows ? `taskkill /T /F /PID ${pid}` : `pkill -KILL -P ${pid}; kill -KILL ${pid}`)
    } catch {
      /* already gone */
    }
  }
  throw new Error('Cadence did not quit within 15 s of closing (its log and processes are printed above)')
}
