import { describe, expect, it } from 'vitest'
import { isNewer } from './version'

describe('isNewer', () => {
  it('compares versions number by number', () => {
    expect(isNewer('2.1.2', '2.1.1')).toBe(true)
    expect(isNewer('2.10.0', '2.9.1')).toBe(true)
    expect(isNewer('3.0.0', '2.99.99')).toBe(true)
  })
  it('is false for the same or an older version', () => {
    expect(isNewer('2.1.1', '2.1.1')).toBe(false)
    expect(isNewer('v2.1.1', '2.1.1')).toBe(false)
    expect(isNewer('2.0.9', '2.1.0')).toBe(false)
  })
})
