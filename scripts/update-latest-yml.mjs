#!/usr/bin/env node
/**
 * After the Windows installer is signed (which changes its bytes), point latest.yml at the
 * signed file: installed copies check each update's sha512 and size before installing it.
 *
 *   node scripts/update-latest-yml.mjs <latest.yml> <signed installer.exe>
 */
import { createHash } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { basename } from 'path'
import { fileURLToPath } from 'url'

export function updateFeed(yml, installer) {
  const data = readFileSync(installer)
  const sha512 = createHash('sha512').update(data).digest('base64')
  const name = basename(installer)
  let text = readFileSync(yml, 'utf8')
  if (!text.includes(name)) throw new Error(`${yml} doesn't mention ${name}`)
  text = text.replace(/^(\s*-?\s*sha512:\s*).+$/gm, `$1${sha512}`).replace(/^(\s*size:\s*)\d+$/gm, `$1${data.length}`)
  writeFileSync(yml, text)
  return { sha512, size: data.length }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [yml, installer] = process.argv.slice(2)
  if (!yml || !installer) {
    console.error('usage: update-latest-yml.mjs <latest.yml> <installer.exe>')
    process.exit(2)
  }
  const { size } = updateFeed(yml, installer)
  console.log(`latest.yml now points at the signed ${basename(installer)} (${size} bytes)`)
}
