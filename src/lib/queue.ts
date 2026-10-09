/** Play-queue rules for the library player, kept free of audio so they can be tested. */

export type RepeatMode = 'off' | 'all' | 'one'

export const REPEAT_ORDER: RepeatMode[] = ['off', 'all', 'one']

/** The song after `index`, or null at the end. `auto` is true when a song finished on its own. */
export function nextIndex(index: number, length: number, repeat: RepeatMode, auto: boolean): number | null {
  if (length === 0) return null
  if (auto && repeat === 'one') return index
  if (index + 1 < length) return index + 1
  return repeat === 'all' ? 0 : null
}

/** The song before `index`; with repeat all, the first song goes back to the last. */
export function previousIndex(index: number, length: number, repeat: RepeatMode): number {
  if (index > 0) return index - 1
  return repeat === 'all' && length > 0 ? length - 1 : 0
}

/** `items` with the one at `keep` first and the rest in random order. */
export function shuffleFrom<T>(items: T[], keep: number, random: () => number = Math.random): T[] {
  const rest = items.filter((_, i) => i !== keep)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return keep >= 0 && keep < items.length ? [items[keep], ...rest] : rest
}

/** Put `songs` right after the current song. */
export function insertAfter<T>(queue: T[], index: number, songs: T[]): T[] {
  return [...queue.slice(0, index + 1), ...songs, ...queue.slice(index + 1)]
}

/**
 * Remove the song at `at`. Returns the new queue and the index of the current song, which
 * moves back one when a song before it is removed. Removing the current song makes the
 * next one current (or the new last one, at the end); `index` is -1 when the queue is empty.
 */
export function removeAt<T>(queue: T[], index: number, at: number): { queue: T[]; index: number } {
  if (at < 0 || at >= queue.length) return { queue, index }
  const next = queue.filter((_, i) => i !== at)
  if (!next.length) return { queue: next, index: -1 }
  if (at < index) return { queue: next, index: index - 1 }
  return { queue: next, index: Math.min(index, next.length - 1) }
}
