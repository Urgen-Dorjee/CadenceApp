import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Track } from '../../types/job'
import SongScrubber from './SongScrubber'

const track: Track = {
  id: 't18', title: 'Sexual Healing - Marvin Gaye', artist: '', start: 4469, end: 4701, source_id: 's',
  origin: 'chapters', confidence: 1, include: true,
}

function setup(time: number) {
  const props = { onToggle: vi.fn(), onPlayFrom: vi.fn(), onInclude: vi.fn() }
  render(
    <table>
      <tbody>
        <SongScrubber track={track} time={time} playing colSpan={9} {...props} />
      </tbody>
    </table>,
  )
  return props
}

describe('SongScrubber', () => {
  it('shows the time within the song, not the whole video', () => {
    setup(4469 + 72)
    expect(screen.getByText('1:12')).toBeTruthy()
    expect(screen.getByText('/ 3:52')).toBeTruthy()
  })

  it('jumps 10 s within the song and stays inside it', () => {
    const p = setup(4469 + 5)
    fireEvent.click(screen.getByLabelText('Forward 10 seconds'))
    expect(p.onPlayFrom).toHaveBeenLastCalledWith(4469 + 15)
    fireEvent.click(screen.getByLabelText('Back 10 seconds'))
    expect(p.onPlayFrom).toHaveBeenLastCalledWith(4469)
  })

  it('moves along the song and unticks it', () => {
    const p = setup(4469)
    fireEvent.change(screen.getByLabelText(`Position in ${track.title}`), { target: { value: '100' } })
    expect(p.onPlayFrom).toHaveBeenLastCalledWith(4569)
    fireEvent.click(screen.getByLabelText('Keep this song'))
    expect(p.onInclude).toHaveBeenCalledWith(false)
  })
})
