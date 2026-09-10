/**
 * P07 benchmark: bounded PNG/WebP/SVG processing with measured CPU and memory.
 * Run with: npx vite-node proofs/processing/benchmark.ts
 * Writes proofs/out/p07-processing-report.json
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { processAssetBytes } from '../../server/processing'
import { fixtureImagePng } from '../../src/features/presentations/model/fixtures/fixture'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'out')

const ITERATIONS = 20

const validSvg = new TextEncoder().encode(
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs><radialGradient id="g"><stop offset="0" stop-color="#08b879"/><stop offset="1" stop-color="#0b1f3b"/></radialGradient></defs>
    <circle cx="128" cy="128" r="120" fill="url(#g)"/>
    <rect x="60" y="60" width="136" height="136" rx="24" fill="#ffd166" opacity="0.85"/>
  </svg>`,
)

const hostileSvg = new TextEncoder().encode(
  '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><text>&xxe;</text></svg>',
)

const webpBytes = new Uint8Array(
  await sharp({ create: { width: 320, height: 240, channels: 4, background: { r: 8, g: 184, b: 121, alpha: 0.6 } } }).webp().toBuffer(),
)

type Case = { name: string; bytes: Uint8Array; expectError?: string }
const cases: Case[] = [
  { name: 'png-256', bytes: fixtureImagePng() },
  { name: 'webp-320x240', bytes: webpBytes },
  { name: 'svg-256', bytes: validSvg },
  { name: 'svg-hostile-rejected', bytes: hostileSvg, expectError: 'svg_unsafe' },
]

const report: Record<string, unknown> = { iterations: ITERATIONS, cases: [] as unknown[] }
const results: unknown[] = []

for (const testCase of cases) {
  // Warm up once (decoder/JIT) so measurements are steady-state.
  await processAssetBytes(testCase.bytes).catch(() => undefined)
  const startRss = process.memoryUsage().rss
  const timings: number[] = []
  let outputBytes = 0
  let failure: string | null = null
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now()
    try {
      const result = await processAssetBytes(testCase.bytes)
      outputBytes = result.png.length + result.thumbnail.length
    } catch (error) {
      failure = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : 'unknown'
    }
    timings.push(performance.now() - start)
  }
  const peakRss = process.memoryUsage().rss
  timings.sort((a, b) => a - b)
  results.push({
    case: testCase.name,
    failure,
    expectedError: testCase.expectError ?? null,
    medianMs: Number(timings[Math.floor(timings.length / 2)]!.toFixed(2)),
    p95Ms: Number(timings[Math.floor(timings.length * 0.95)]!.toFixed(2)),
    maxMs: Number(timings.at(-1)!.toFixed(2)),
    outputBytes,
    rssDeltaMb: Number(((peakRss - startRss) / 1024 / 1024).toFixed(1)),
  })
}

report.cases = results
await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'p07-processing-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
