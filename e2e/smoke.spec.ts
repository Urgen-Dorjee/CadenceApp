import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync } from 'fs'
import { basename, join } from 'path'
import { ROOT, api, launch, makeTwoSongs, quit, seedLecture, type Launched } from './app'

let run: Launched

// One app, one story: each step builds on the one before.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  run = await launch(({ dataDir, videoDir }) => seedLecture(dataDir, videoDir))
})

test.afterAll(async () => {
  if (run) await quit(run)
})

test('starts, connects to the audio engine and welcomes a new user', async () => {
  const { page } = run
  // The status bar (hidden from accessibility queries while the welcome dialog is open).
  await expect(page.locator('footer[role=status]')).toContainText('Ready', { timeout: 60_000 })
  await expect(page.getByText('Welcome to Cadence')).toBeVisible()
  await page.getByRole('button', { name: 'Start splitting' }).click()
  await expect(page.getByText('Welcome to Cadence')).toBeHidden()
  const prefs = await api<{ onboarded: boolean; library_dir: string }>(page, 'GET', '/api/preferences')
  expect(prefs.onboarded).toBe(true)
  expect(prefs.library_dir).toBe(run.musicDir)
  // The audio engine reports the app's own version (package.json).
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  expect((await api<{ text: string }>(page, 'GET', '/api/diagnostics')).text).toContain(`version ${version}`)
})

test('every page opens', async () => {
  const { page } = run
  for (const [link, heading] of [['Downloads', 'Downloads'], ['Library', 'Library'], ['Settings', 'Settings'], ['New download', 'New download']]) {
    await page.getByRole('link', { name: link, exact: true }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
  }
})

test('a setting changed in Settings is saved', async () => {
  const { page } = run
  await page.getByRole('link', { name: 'Settings', exact: true }).first().click()
  await page.getByRole('radio', { name: /Opus/ }).click()
  await expect.poll(async () => (await api<{ audio_format: string }>(page, 'GET', '/api/preferences')).audio_format).toBe('opus')
  await page.getByRole('radio', { name: /MP3/ }).first().click()
  await expect.poll(async () => (await api<{ audio_format: string }>(page, 'GET', '/api/preferences')).audio_format).toBe('mp3')
})

test('a file from the computer is split and its songs saved', async () => {
  const { page } = run
  const file = makeTwoSongs(join(run.musicDir, '..'))
  const job = await api<{ id: string }>(page, 'POST', '/api/jobs', { path: file })
  await page.getByRole('link', { name: 'Downloads', exact: true }).first().click()
  await page.getByRole('link', { name: /Review/ }).or(page.getByRole('button', { name: /Review/ })).first().click({ timeout: 90_000 })
  await expect(page.getByRole('textbox', { name: 'Title of song 2' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Title of song 1' }).fill('First Tone')
  await page.getByRole('textbox', { name: 'Title of song 2' }).fill('Second Tone')
  await page.getByRole('button', { name: /^Save 2 songs$/ }).click()
  await expect.poll(async () => (await api<{ status: string }>(page, 'GET', `/api/jobs/${job.id}`)).status, { timeout: 60_000 }).toBe('completed')
  const saved = (await api<{ outputs: { path: string }[] }>(page, 'GET', `/api/jobs/${job.id}`)).outputs.map((o) => o.path)
  expect(saved.map((p) => basename(p))).toEqual(['01 - First Tone.mp3', '02 - Second Tone.mp3'])
})

test('saved songs are in the library and play', async () => {
  const { page } = run
  await page.getByRole('link', { name: 'Library', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Songs', exact: true }).click()
  await expect(page.getByText('Second Tone')).toBeVisible()
  await page.getByRole('button', { name: 'Play First Tone', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Close player' }).click()
})

test('a video plays in the built-in player, with a way back that nothing covers', async () => {
  const { page } = run
  await page.getByRole('link', { name: 'Library', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Videos', exact: true }).click()
  await page.getByRole('button', { name: 'Play Lecture 1' }).click()
  const video = page.locator('video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && !v.error)).toBe(true)
  // The player is a dialog named after the video.
  const player = page.getByRole('dialog', { name: 'Lecture 1' })
  await expect(player).toBeVisible()
  // The window's own buttons (Windows) or traffic lights (Mac) sit in the 40 px title bar.
  const back = player.getByRole('button', { name: 'Back', exact: true })
  await page.mouse.move(300, 300)
  await expect(back).toBeVisible()
  expect((await back.boundingBox())!.y).toBeGreaterThanOrEqual(40)
  await page.getByRole('button', { name: 'Chapters' }).click()
  await expect(page.getByRole('complementary', { name: 'Chapters and course' })).toContainText('Main part')
  await back.click()
  await expect(player).toBeHidden()
})

test('nothing went wrong along the way', async () => {
  // Network errors for media that can't exist in tests aren't problems; anything else is.
  expect(run.problems).toEqual([])
  expect(readdirSync(join(run.dataDir, 'backups')).some((f) => f.endsWith('.db'))).toBe(true)
})
