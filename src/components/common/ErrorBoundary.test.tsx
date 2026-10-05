import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import ErrorBoundary from './ErrorBoundary'

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test explosion')
  return <div>All good</div>
}

describe('ErrorBoundary', () => {
  // Suppress console.error for expected errors
  const originalError = console.error
  beforeAll(() => { console.error = vi.fn() })
  afterAll(() => { console.error = originalError })

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('renders fallback when child throws', () => {
    render(
      <ErrorBoundary fallbackTitle="Page crashed">
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Page crashed')).toBeInTheDocument()
    expect(screen.getByText('Test explosion')).toBeInTheDocument()
  })

  it('renders default title when no fallbackTitle provided', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('shows Try Again button in error state', () => {
    render(
      <ErrorBoundary fallbackTitle="Oops">
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Oops')).toBeInTheDocument()
    expect(screen.getByText('Try Again')).toBeInTheDocument()
    expect(screen.getByText('Test explosion')).toBeInTheDocument()
  })
})
