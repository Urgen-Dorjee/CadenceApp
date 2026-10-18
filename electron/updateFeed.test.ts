import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'
// @ts-expect-error - a plain JavaScript script, run by the release workflow
import { updateFeed } from '../scripts/update-latest-yml.mjs'

describe('update feed after signing', () => {
  it('points latest.yml at the signed installer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-'))
    const exe = join(dir, 'Cadence-Setup-9.9.9.exe')
    writeFileSync(exe, 'signed bytes')
    const yml = join(dir, 'latest.yml')
    writeFileSync(yml, [
      'version: 9.9.9',
      'files:',
      '  - url: Cadence-Setup-9.9.9.exe',
      '    sha512: OLDHASH==',
      '    size: 1',
      'path: Cadence-Setup-9.9.9.exe',
      'sha512: OLDHASH==',
      "releaseDate: '2026-10-18T00:00:00.000Z'",
    ].join('\n'))
    updateFeed(yml, exe)
    const hash = createHash('sha512').update('signed bytes').digest('base64')
    const text = readFileSync(yml, 'utf8')
    expect(text.split(hash).length - 1).toBe(2) // the file entry and the top-level one
    expect(text).toContain('    size: 12')
    expect(text).not.toContain('OLDHASH')
  })
})
