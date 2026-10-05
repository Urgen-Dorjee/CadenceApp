import '@testing-library/jest-dom/vitest'

// Mock window.electronAPI for tests
Object.defineProperty(window, 'electronAPI', {
  value: undefined,
  writable: true,
})
