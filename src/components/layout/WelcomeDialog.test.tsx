import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import WelcomeDialog from './WelcomeDialog'

describe('WelcomeDialog', () => {
  it('saves the chosen format and loudness with the library folder', async () => {
    const onFinish = vi.fn().mockResolvedValue(undefined)
    render(<WelcomeDialog initial={{ library_dir: 'C:\\Music\\Cadence', audio_format: 'mp3', loudness: 'tags' }} onFinish={onFinish} />)
    expect(screen.getByText('C:\\Music\\Cadence')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Original/ }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Start splitting' }))
    await waitFor(() =>
      expect(onFinish).toHaveBeenCalledWith({ library_dir: 'C:\\Music\\Cadence', audio_format: 'original', loudness: 'off' }),
    )
  })
})
