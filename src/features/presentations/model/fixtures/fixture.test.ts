import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PRESENTATION_KIND, PRESENTATION_SCHEMA_VERSION } from '../types'
import {
  FIXTURE_FONTS,
  FIXTURE_IMAGE_ASSET_ID,
  FIXTURE_IMAGE_SHA256,
  createFixturePresentation,
  fixtureImagePng,
} from './fixture'

describe('P02 presentation fixture', () => {
  it('is a presentation document with the required structure', () => {
    const doc = createFixturePresentation()
    expect(doc.kind).toBe(PRESENTATION_KIND)
    expect(doc.schemaVersion).toBe(PRESENTATION_SCHEMA_VERSION)
    expect(doc.pageSize).toEqual({ width: 1280, height: 720 })
    expect(doc.slides).toHaveLength(2)
    expect(doc.slides[0]!.name).toBe('Title slide')
    expect(doc.slides[1]!.name).toBe('Bullets slide')
  })

  it('contains English and Vietnamese text with mixed bold/italic runs and a safe link', () => {
    const doc = createFixturePresentation()
    const title = doc.slides[0]!.elements.find((element) => element.id === 'fixture-text-title')
    if (title?.kind !== 'text') throw new Error('expected fixture title text')
    expect(title.paragraphs[0]!.runs[0]!.text).toBe('Nghiên cứu và trình bày')
    expect(title.paragraphs[0]!.runs[0]!.bold).toBe(true)
    const subtitleRuns = title.paragraphs[1]!.runs
    expect(subtitleRuns.map((run) => run.italic ?? false)).toEqual([false, true, false])
    expect(subtitleRuns[2]!.bold).toBe(true)

    const bullets = doc.slides[1]!.elements.find((element) => element.id === 'fixture-text-bullets')
    if (bullets?.kind !== 'text') throw new Error('expected fixture bullets text')
    expect(bullets.paragraphs[0]!.runs[0]!.text).toContain('Tóm tắt kết quả:')
    expect(bullets.paragraphs[1]!.bullet).toBe('bullet')
    expect(bullets.paragraphs[1]!.bulletLevel).toBe(1)
    expect(bullets.paragraphs[1]!.runs[0]!.link).toBe('https://example.edu/guide')
    expect(bullets.paragraphs[2]!.bullet).toBe('number')
  })

  it('contains a shape, a line and an image referencing a transparent asset', () => {
    const doc = createFixturePresentation()
    const kinds = doc.slides.flatMap((slide) => slide.elements.map((element) => element.kind))
    expect(kinds).toContain('shape')
    expect(kinds).toContain('image')
    const image = doc.slides[0]!.elements.find((element) => element.id === 'fixture-image-sticker')
    if (image?.kind !== 'image') throw new Error('expected fixture image')
    expect(image.assetId).toBe(FIXTURE_IMAGE_ASSET_ID)
    expect(doc.assets.map((asset) => asset.id)).toContain(FIXTURE_IMAGE_ASSET_ID)
    expect(doc.assets[0]!.mimeType).toBe('image/png')
  })

  it('references the two chosen font families by stable ID', () => {
    const doc = createFixturePresentation()
    expect(doc.theme.headingFontId).toBe(FIXTURE_FONTS.heading)
    expect(doc.theme.bodyFontId).toBe(FIXTURE_FONTS.body)
    const fontIds = new Set(
      doc.slides.flatMap((slide) =>
        slide.elements.flatMap((element) =>
          element.kind === 'text' ? element.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.fontId)) : [],
        ),
      ),
    )
    expect([...fontIds].sort()).toEqual(['be-vietnam-pro', 'spectral'])
  })

  it('is deterministic and matches the recorded image hash', () => {
    const first = fixtureImagePng()
    const second = fixtureImagePng()
    expect(Array.from(first)).toEqual(Array.from(second))
    const digest = createHash('sha256').update(first).digest('hex')
    expect(digest).toBe(FIXTURE_IMAGE_SHA256)
  })
})
