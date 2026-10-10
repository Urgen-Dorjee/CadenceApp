import { describe, expect, it } from 'vitest'
import { activeLine, parseLrc } from './lrc'

describe('parseLrc', () => {
  it('reads timed lines, skips tags and repeats lines with several stamps', () => {
    const lines = parseLrc('[ar:Kumar Sanu]\n[00:12.50] Tujhe dekha to\n[00:20.00][01:10.00] Yeh jaana sanam\n\n[00:30] ')
    expect(lines).toEqual([
      { time: 12.5, text: 'Tujhe dekha to' },
      { time: 20, text: 'Yeh jaana sanam' },
      { time: 30, text: '' },
      { time: 70, text: 'Yeh jaana sanam' },
    ])
  })
})

describe('activeLine', () => {
  const lines = parseLrc('[00:10.00] One\n[00:20.00] Two\n[00:30.00] Three')
  it('follows the playhead', () => {
    expect(activeLine(lines, 5)).toBe(-1)
    expect(activeLine(lines, 10)).toBe(0)
    expect(activeLine(lines, 25)).toBe(1)
    expect(activeLine(lines, 99)).toBe(2)
  })
})
