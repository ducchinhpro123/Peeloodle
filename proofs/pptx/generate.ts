/**
 * P03 proof entry point. Run with:
 *   npx vite-node proofs/pptx/generate.ts
 * Writes proofs/out/fixture-sticker.png and proofs/out/p02-fixture.pptx.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixtureImagePng } from '../../src/features/presentations/model/fixtures/fixture'
import { buildFixturePptx } from './exportFixture'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'out')

await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'fixture-sticker.png'), fixtureImagePng())
const { buffer, report } = await buildFixturePptx()
await writeFile(join(outDir, 'p02-fixture.pptx'), buffer)
await writeFile(join(outDir, 'p02-mapping-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`wrote ${buffer.length} bytes`)
console.log(JSON.stringify(report))
