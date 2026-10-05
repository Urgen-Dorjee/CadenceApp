import type { CollectionType, Preferences } from '../types/job'

export interface LayoutPreset {
  label: string
  template: string
}

/** Folder layouts offered in Settings. Paths use "/" and are relative to the save folder. */
export const LAYOUT_PRESETS: Record<CollectionType, LayoutPreset[]> = {
  artist: [
    { label: 'Artists › Singer › Singer - Song', template: 'Artists/{artist}/{artist} - {title}' },
    { label: 'Singer › Song', template: '{artist}/{title}' },
    { label: 'Singer - Song, all in one folder', template: '{artist} - {title}' },
  ],
  album: [
    { label: 'Albums › Movie (Year) › 01 - Song', template: 'Albums/{album}{year_suffix}/{track:02} - {title}' },
    { label: 'Movie (Year) › 01 - Song', template: '{album}{year_suffix}/{track:02} - {title}' },
    { label: 'Movie - 01 - Song, all in one folder', template: '{album} - {track:02} - {title}' },
  ],
  collection: [
    { label: 'Collections › Name › 01 - Song', template: 'Collections/{collection}/{track:02} - {title}' },
    { label: 'Name › 01 - Song', template: '{collection}/{track:02} - {title}' },
  ],
  single: [
    { label: 'Singles › Song', template: 'Singles/{title}' },
    { label: 'Song, straight into the save folder', template: '{title}' },
  ],
}

export const TEMPLATE_KEY: Record<CollectionType, keyof Preferences> = {
  artist: 'artist_template',
  album: 'album_template',
  collection: 'collection_template',
  single: 'single_template',
}

/** Index of the preset matching a template, or -1 for a custom layout. */
export function presetIndex(type: CollectionType, template: string): number {
  return LAYOUT_PRESETS[type].findIndex((p) => p.template === template)
}
