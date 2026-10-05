import { describe, it, expect, beforeEach } from 'vitest'
import { logError, getErrorLog, clearErrorLog } from './errorLogger'

describe('errorLogger', () => {
  beforeEach(() => {
    clearErrorLog()
  })

  it('logs an error string', () => {
    logError('Something went wrong', 'test')
    const log = getErrorLog()
    expect(log).toHaveLength(1)
    expect(log[0].message).toBe('Something went wrong')
    expect(log[0].context).toBe('test')
    expect(log[0].timestamp).toBeTruthy()
  })

  it('logs an Error object with stack', () => {
    logError(new Error('Test error'), 'unit-test')
    const log = getErrorLog()
    expect(log).toHaveLength(1)
    expect(log[0].message).toBe('Test error')
    expect(log[0].stack).toBeTruthy()
  })

  it('accumulates multiple errors', () => {
    logError('Error 1')
    logError('Error 2')
    logError('Error 3')
    expect(getErrorLog()).toHaveLength(3)
  })

  it('clears the log', () => {
    logError('Error')
    clearErrorLog()
    expect(getErrorLog()).toHaveLength(0)
  })
})
