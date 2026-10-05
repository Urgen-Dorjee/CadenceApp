import { describe, expect, it } from 'vitest'
import { formatDuration, formatTime, parseTime } from './time'

describe('formatTime', () => {
  it('formats minutes and tenths', () => {
    expect(formatTime(75.44)).toBe('1:15.4')
    expect(formatTime(5)).toBe('0:05.0')
  })
  it('adds hours for long videos', () => {
    expect(formatTime(3723)).toBe('1:02:03.0')
    expect(formatTime(3723, false)).toBe('1:02:03')
  })
  it('handles bad input', () => {
    expect(formatTime(NaN)).toBe('0:00.0')
    expect(formatTime(-3)).toBe('0:00.0')
  })
})

describe('parseTime', () => {
  it('parses the formats people type', () => {
    expect(parseTime('1:15.4')).toBe(75.4)
    expect(parseTime('01:02:03')).toBe(3723)
    expect(parseTime('75')).toBe(75)
    expect(parseTime(' 0:05 ')).toBe(5)
  })
  it('round-trips with formatTime', () => {
    for (const t of [0, 12.3, 299.9, 4000.5]) expect(parseTime(formatTime(t))).toBe(t)
  })
  it('rejects nonsense', () => {
    expect(parseTime('abc')).toBeNull()
    expect(parseTime('1:75')).toBeNull()
    expect(parseTime('1:2:3:4')).toBeNull()
    expect(parseTime('')).toBeNull()
  })
})

describe('formatDuration', () => {
  it('reads naturally', () => {
    expect(formatDuration(19)).toBe('19 s')
    expect(formatDuration(600)).toBe('10 min')
    expect(formatDuration(7260)).toBe('2 h 1 min')
  })
})
