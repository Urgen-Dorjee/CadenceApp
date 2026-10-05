import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import http from 'http'

interface PythonManagerOptions {
  port: number
  token: string
  appPath: string
  isPackaged: boolean
  resourcesPath: string
  ffmpegPath: string | null
  denoPath: string | null
  fpcalcPath: string | null
}

type Logger = (level: 'info' | 'warn' | 'error', message: string) => void

/** Log level for a line of backend output: errors and tracebacks stay errors, routine INFO stays info. */
export function levelOf(line: string): 'info' | 'warn' | 'error' {
  if (/^\s*(INFO|DEBUG)\b|\[(INFO|DEBUG)\]|^\[Backend\]/.test(line)) return 'info'
  if (/^\s*WARNING\b|\[WARNING\]/.test(line)) return 'warn'
  return 'error'
}

export class PythonManager {
  private process: ChildProcess | null = null
  private options: PythonManagerOptions
  private stopping = false
  private healthy = false
  private recentOutput: string[] = []

  /** Called when the backend dies after it was running. */
  onCrash: ((code: number | null) => void) | null = null
  log: Logger = (level, message) => (level === 'error' ? console.error : console.log)(message)

  constructor(options: PythonManagerOptions) {
    this.options = options
  }

  /** Start the backend and resolve once /api/health answers. */
  async start(): Promise<void> {
    this.stopping = false
    this.healthy = false
    this.recentOutput = []
    const { cmd, args, cwd } = this.getCommand()
    const env = {
      ...process.env,
      BACKEND_PORT: String(this.options.port),
      CADENCE_TOKEN: this.options.token,
      FFMPEG_PATH: this.options.ffmpegPath ?? '',
      DENO_PATH: this.options.denoPath ?? '',
      FPCALC_PATH: this.options.fpcalcPath ?? '',
      PYTHONIOENCODING: 'utf-8',
      ...(this.options.isPackaged ? { CADENCE_PACKAGED: '1' } : {}),
    }

    this.log('info', `[PythonManager] Starting: ${cmd} ${args.join(' ')}`)
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...(cwd ? { cwd } : {}) })
    this.process = child

    const remember = (data: Buffer, level: 'info' | 'auto') => {
      for (const line of data.toString().split(/\r?\n/).filter(Boolean)) {
        this.recentOutput.push(line)
        if (this.recentOutput.length > 30) this.recentOutput.shift()
        this.log(level === 'info' ? 'info' : levelOf(line), `[Python] ${line}`)
      }
    }
    // Python's logging and uvicorn write everything to stderr, so judge the level by the line itself.
    child.stdout?.on('data', (d: Buffer) => remember(d, 'info'))
    child.stderr?.on('data', (d: Buffer) => remember(d, 'auto'))

    const exited = new Promise<never>((_, reject) => {
      child.on('error', (err) => reject(new Error(`Couldn't start the audio engine: ${err.message}`)))
      child.on('exit', (code) => {
        this.log('warn', `[PythonManager] Backend exited with code ${code}`)
        if (this.process === child) this.process = null
        if (this.stopping) return
        if (this.healthy) {
          this.onCrash?.(code)
        } else {
          const tail = this.recentOutput.slice(-5).join(' | ')
          reject(new Error(`The audio engine stopped while starting (code ${code}).${tail ? ' ' + tail : ''}`))
        }
      })
    })

    try {
      await Promise.race([this.waitForHealth(45000), exited])
      this.healthy = true
      this.log('info', '[PythonManager] Backend is healthy')
    } catch (err) {
      this.stop()
      throw err
    }
  }

  stop(): void {
    this.stopping = true
    const child = this.process
    this.process = null
    if (child && child.exitCode === null) {
      this.log('info', '[PythonManager] Stopping backend')
      child.kill()
    }
  }

  private getCommand(): { cmd: string; args: string[]; cwd?: string } {
    if (this.options.isPackaged) {
      // Production: use standalone Python bundled in resources/backend/python/
      const backendDir = path.join(this.options.resourcesPath, 'backend')
      const pythonExe = path.join(backendDir, 'python', 'python.exe')
      const mainPy = path.join(backendDir, 'main.py')
      return {
        cmd: pythonExe,
        args: [mainPy, '--port', String(this.options.port)],
        cwd: backendDir,
      }
    }

    // In dev mode, appPath may point to dist-electron/ after build.
    // We need the project root to find backend/main.py
    let projectRoot = this.options.appPath
    if (projectRoot.endsWith('dist-electron') || projectRoot.endsWith('dist-electron/') || projectRoot.endsWith('dist-electron\\')) {
      projectRoot = path.dirname(projectRoot)
    }
    // Also handle if appPath is inside dist-electron
    if (!fs.existsSync(path.join(projectRoot, 'backend', 'main.py'))) {
      // Walk up until we find it
      let candidate = projectRoot
      for (let i = 0; i < 3; i++) {
        candidate = path.dirname(candidate)
        if (fs.existsSync(path.join(candidate, 'backend', 'main.py'))) {
          projectRoot = candidate
          break
        }
      }
    }

    const backendPath = path.join(projectRoot, 'backend', 'main.py')
    // Try venv first, then system python
    const venvPython = path.join(projectRoot, 'backend', 'venv', 'Scripts', 'python.exe')
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python'

    return {
      cmd: pythonCmd,
      args: [backendPath, '--port', String(this.options.port)],
    }
  }

  private waitForHealth(timeoutMs: number): Promise<void> {
    const startTime = Date.now()
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.stopping) return
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error('The audio engine did not start within 45 seconds'))
          return
        }

        const req = http.get(
          {
            host: '127.0.0.1',
            port: this.options.port,
            path: '/api/health',
            headers: { 'x-cadence-token': this.options.token },
          },
          (res) => {
            res.resume()
            if (res.statusCode === 200) {
              resolve()
            } else {
              setTimeout(check, 500)
            }
          },
        )

        req.on('error', () => {
          setTimeout(check, 500)
        })

        req.setTimeout(2000, () => {
          req.destroy()
        })
      }

      check()
    })
  }
}
