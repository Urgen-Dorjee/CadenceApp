import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import TracklistDialog from './TracklistDialog'

function setup(onImport: (text: string) => Promise<void>) {
  const onOpenChange = vi.fn()
  render(<TracklistDialog open onOpenChange={onOpenChange} onImport={onImport} />)
  return { onOpenChange, textarea: screen.getByLabelText('Tracklist') }
}

describe('TracklistDialog', () => {
  it('sends the pasted text and closes', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined)
    const { onOpenChange, textarea } = setup(onImport)
    fireEvent.change(textarea, { target: { value: '0:00 A\n4:00 B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use tracklist' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onImport).toHaveBeenCalledWith('0:00 A\n4:00 B')
  })

  it('stays open and shows why a tracklist was rejected', async () => {
    const onImport = vi.fn().mockRejectedValue(new Error('No times found.'))
    const { onOpenChange, textarea } = setup(onImport)
    fireEvent.change(textarea, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use tracklist' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No times found.')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(textarea).toHaveValue('hello')
  })

  it('submits with Ctrl+Enter and not when empty', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined)
    const { textarea } = setup(onImport)
    expect(screen.getByRole('button', { name: 'Use tracklist' })).toBeDisabled()
    fireEvent.change(textarea, { target: { value: '0:00 A\n4:00 B' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
  })
})
