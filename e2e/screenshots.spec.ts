import { expect, test } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ROOT, api, ffmpeg, launch, python, quit, type Launched } from './app'

// Screenshots for the website (docs/screenshots). Run on request:
//   SCREENSHOTS=1 SCREENSHOT_SONGS=<a folder with a few songs> npx playwright test -c e2e/playwright.config.ts screenshots
// The songs are joined into one "jukebox" file and split by Cadence; nothing is downloaded.

const OUT = join(ROOT, 'docs', 'screenshots')
let run: Launched
test.describe.configure({ mode: 'serial' })

function jukebox(dir: string): string {
  const folder = process.env.SCREENSHOT_SONGS
  if (!folder) throw new Error('Set SCREENSHOT_SONGS to a folder with a few songs')
  const songs = readdirSync(folder).filter((f) => /\.(mp3|m4a|flac|opus)$/i.test(f)).slice(0, 4).map((f) => join(folder, f))
  const out = join(dir, '90s Romantic Hits - Audio Jukebox.mp3')
  const inputs = songs.flatMap((s) => ['-i', s])
  const parts = songs.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]`)
  const silence = `anullsrc=r=44100:cl=stereo:d=2`
  const chain = songs.map((_, i) => (i ? `[s${i}][a${i}]` : `[a${i}]`)).join('')
  execFileSync(ffmpeg(), ['-v', 'error', '-y', ...inputs, ...songs.slice(1).flatMap(() => ['-f', 'lavfi', '-i', silence]),
    '-filter_complex', [...parts, ...songs.slice(1).map((_, i) => `[${songs.length + i}:a]anull[s${i + 1}]`),
      `${chain}concat=n=${songs.length * 2 - 1}:v=0:a=1`].join(';'), '-b:a', '192k', out])
  return out
}

function lecture(dataDir: string, videoDir: string) {
  const dir = join(videoDir, 'Open Course', 'Linear Algebra')
  mkdirSync(dir, { recursive: true })
  const chapters = join(dir, 'chapters.txt')
  writeFileSync(chapters, ';FFMETADATA1\n' + ['Vectors and spaces', 'Linear combinations', 'Span and basis', 'Summary']
    .map((t, i) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${i * 5000}\nEND=${(i + 1) * 5000}\ntitle=${t}\n`).join(''))
  const video = join(dir, '01 - Vectors and Spaces.mp4')
  execFileSync(ffmpeg(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'mandelbrot=size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=330',
    '-i', chapters, '-t', '20', '-map', '0:v', '-map', '1:a', '-map_metadata', '2', '-map_chapters', '2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video])
  writeFileSync(video.replace(/\.mp4$/, '.en.srt'), '1\n00:00:00,500 --> 00:00:19,500\nA vector space is a set you can add and scale, and stay inside.\n')
  const record = JSON.stringify({ path: video, video_id: 'demoLinAlg01', title: 'Vectors and Spaces', channel: 'Open Course', playlist: 'Linear Algebra',
    playlist_index: 1, duration: 20, height: 720, ext: 'mp4', subtitles: ['en'] })
  execFileSync(python(), ['-c', 'import json, sys; sys.path.insert(0, "backend"); from core.db import get_store; get_store().add_video(json.loads(sys.argv[1]))', record],
    { cwd: ROOT, env: { ...process.env, CADENCE_DATA_DIR: dataDir } })
}

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true })
  run = await launch(({ dataDir, videoDir }) => lecture(dataDir, videoDir))
  const prefs = await api<Record<string, unknown>>(run.page, 'GET', '/api/preferences')
  await api(run.page, 'PUT', '/api/preferences', { ...prefs, onboarded: true, identify_songs: true, download_mode: 'music' })
  await run.page.reload()
  await expect(run.page.locator('footer[role=status]')).toContainText('Ready', { timeout: 60_000 })
})

test.afterAll(async () => {
  if (run) await quit(run)
})

const shot = (name: string) => run.page.screenshot({ path: join(OUT, `${name}.png`) })

test('screenshots', async () => {
  const { page } = run
  await shot('home-music')

  const job = await api<{ id: string }>(page, 'POST', '/api/jobs', { path: jukebox(join(run.musicDir, '..')) })
  await expect.poll(async () => (await api<{ status: string }>(page, 'GET', `/api/jobs/${job.id}`)).status, { timeout: 300_000 }).toBe('review')
  await page.evaluate((id) => { location.hash = `#/jobs/${id}` }, job.id)
  await page.waitForTimeout(3000)
  await shot('review')

  await page.getByRole('button', { name: /^Save \d+ songs?$/ }).click()
  await expect.poll(async () => (await api<{ status: string }>(page, 'GET', `/api/jobs/${job.id}`)).status, { timeout: 120_000 }).toBe('completed')
  await page.getByRole('link', { name: 'Library', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Songs', exact: true }).click()
  await page.waitForTimeout(1500)
  await shot('library')

  await page.getByRole('link', { name: 'New download', exact: true }).first().click()
  await page.getByRole('button', { name: /^Video/ }).first().click()
  await page.waitForTimeout(800)
  await shot('home-video')

  await page.getByRole('link', { name: 'Library', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Videos', exact: true }).click()
  await page.getByRole('button', { name: 'Play Vectors and Spaces' }).click()
  await page.waitForTimeout(2000)
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 6 })
  const player = page.getByRole('dialog', { name: 'Vectors and Spaces' })
  await player.getByRole('button', { name: 'Chapters' }).click()
  await player.getByRole('button', { name: /^Subtitles/ }).click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await page.mouse.move(400, 400)
  await page.waitForTimeout(1500)
  await shot('player')
  await player.getByRole('button', { name: 'Back', exact: true }).click()

  await page.getByRole('link', { name: 'Downloads', exact: true }).first().click()
  await page.waitForTimeout(800)
  await shot('downloads')
})
