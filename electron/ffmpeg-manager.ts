import path from 'path'
import fs from 'fs'

export class FFmpegManager {
  private ffmpegDir: string
  private ffmpegPath: string
  private ffprobePath: string

  constructor(appPath: string, isPackaged: boolean) {
    this.ffmpegDir = isPackaged
      ? path.join(process.resourcesPath, 'ffmpeg')
      : path.join(appPath, 'resources', 'ffmpeg')

    this.ffmpegPath = path.join(this.ffmpegDir, 'ffmpeg.exe')
    this.ffprobePath = path.join(this.ffmpegDir, 'ffprobe.exe')
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
      const candidate = path.join(dir, 'ffmpeg.exe')
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
