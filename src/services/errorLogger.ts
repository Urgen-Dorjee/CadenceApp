const MAX_LOG_ENTRIES = 100
const LOG_KEY = 'cadence_error_log'

interface ErrorLogEntry {
  timestamp: string
  message: string
  stack?: string
  context?: string
}

function getLog(): ErrorLogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || '[]')
  } catch {
    return []
  }
}

function saveLog(entries: ErrorLogEntry[]) {
  localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_LOG_ENTRIES)))
}

export function logError(error: unknown, context?: string) {
  const entry: ErrorLogEntry = {
    timestamp: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    context,
  }

  const log = getLog()
  log.push(entry)
  saveLog(log)

  console.error(`[Cadence Error]${context ? ` (${context})` : ''}:`, error)
}

export function getErrorLog(): ErrorLogEntry[] {
  return getLog()
}

export function clearErrorLog() {
  localStorage.removeItem(LOG_KEY)
}

export function setupGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    logError(event.error || event.message, 'uncaught')
  })

  window.addEventListener('unhandledrejection', (event) => {
    logError(event.reason, 'unhandled-promise')
  })
}
