/** Each system's own words and keys, so the interface reads naturally on Windows, macOS and Linux. */

export function platform(): string {
  return window.electronAPI?.platform ?? 'win32'
}

export const isMac = () => platform() === 'darwin'

/** Where deleted files go. */
export const trashName = () => (platform() === 'win32' ? 'Recycle Bin' : 'Trash')

/** The app that shows files in folders. */
export const fileManagerName = () => (platform() === 'win32' ? 'File Explorer' : isMac() ? 'Finder' : 'your file manager')

/** The system, as in "Match Windows". */
export const systemName = () => (platform() === 'win32' ? 'Windows' : isMac() ? 'macOS' : 'your system')

/** The shortcut modifier key: ⌘ on a Mac, Ctrl elsewhere. */
export const modKey = () => (isMac() ? '⌘' : 'Ctrl')
