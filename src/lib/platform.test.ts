import { afterEach, describe, expect, it } from 'vitest'
import { fileManagerName, modKey, systemName, trashName } from './platform'

const as = (platform: string) => {
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { platform }
}

afterEach(() => {
  ;(window as unknown as { electronAPI: unknown }).electronAPI = undefined
})

describe('platform words', () => {
  it('uses Windows words on Windows (and when unknown)', () => {
    expect([trashName(), fileManagerName(), systemName(), modKey()]).toEqual(['Recycle Bin', 'File Explorer', 'Windows', 'Ctrl'])
    as('win32')
    expect(trashName()).toBe('Recycle Bin')
  })

  it("uses a Mac's words and the Command key on macOS", () => {
    as('darwin')
    expect([trashName(), fileManagerName(), systemName(), modKey()]).toEqual(['Trash', 'Finder', 'macOS', '⌘'])
  })

  it('stays general on Linux', () => {
    as('linux')
    expect([trashName(), fileManagerName(), systemName(), modKey()]).toEqual(['Trash', 'your file manager', 'your system', 'Ctrl'])
  })
})
