import path from 'path'
import fs from 'fs'

/** "ffmpeg" -> "ffmpeg.exe" on Windows. */
export const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name)

export class FFmpegManager {
  private ffmpegDir: string
  private ffmpegPath: string
  private ffprobePath: string

  constructor(appPath: string, isPackaged: boolean) {
    this.ffmpegDir = isPackaged
      ? path.join(process.resourcesPath, 'ffmpeg')
      : path.join(appPath, 'resources', 'ffmpeg')

    this.ffmpegPath = path.join(this.ffmpegDir, exe('ffmpeg'))
    this.ffprobePath = path.join(this.ffmpegDir, exe('ffprobe'))
  }

  isInstalled(): boolean {
    return fs.existsSync(this.ffmpegPath)
  }

  getPath(): string | null {
    if (this.isInstalled()) {
      return this.ffmpegPath
    }
    // Check system PATH
    const systemPaths = (process.env.PATH || '').split(path.delimiter)
    for (const dir of systemPaths) {
      const candidate = path.join(dir, exe('ffmpeg'))
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    return null
  }

  getDir(): string {
    return this.ffmpegDir
  }
}
