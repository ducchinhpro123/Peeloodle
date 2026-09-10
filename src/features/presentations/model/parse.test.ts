import { describe, expect, it } from 'vitest'
import { parsePresentationDocument, presentationDocumentToJson, serializePresentationDocument, validatePresentationDocument } from './parse'
import { createPresentationDocument } from './factories'
import { createFixturePresentation } from './fixtures/fixture'
import { PRESENTATION_LIMITS } from './limits'
import { PRESENTATION_SCHEMA_VERSION, type PresentationDocument } from './types'

function validDocument(): PresentationDocument {
  return createPresentationDocument({ id: 'doc-1', title: 'Valid', now: '2026-09-10T00:00:00.000Z' })
}

function mutate(mutator: (document: PresentationDocument) => void): PresentationDocument {
  const document = structuredClone(validDocument())
  mutator(document)
  return document
}

describe('presentation parser', () => {
  it('round-trips the P02 fixture unchanged', () => {
    const fixture = createFixturePresentation()
    expect(parsePresentationDocument(fixture)).toEqual(fixture)
    expect(parsePresentationDocument(JSON.stringify(fixture))).toEqual(fixture)
  })

  it('serializes only validated serializable data', () => {
    const withExtra = { ...validDocument(), temporaryUrl: 'blob:http://localhost/x' } as unknown as PresentationDocument
    const clean = serializePresentationDocument(withExtra)
    expect('temporaryUrl' in clean).toBe(false)
    expect(JSON.parse(presentationDocumentToJson(clean))).toEqual(clean)
  })

  it('rejects unknown schema versions and foreign documents', () => {
    expect(() => parsePresentationDocument({ ...validDocument(), schemaVersion: 99 })).toThrowError(expect.objectContaining({ code: 'unsupported_schema' }))
    expect(() => parsePresentationDocument({ ...validDocument(), kind: 'project' })).toThrowError(expect.objectContaining({ code: 'invalid' }))
  })

  it('rejects duplicate IDs anywhere in the document', () => {
    expect(() => parsePresentationDocument(mutate((document) => { document.slides.push({ id: 'doc-1', name: 'dup', background: '#ffffff', elements: [] }) }))).toThrow(/Duplicate id/)
    expect(() =>
      parsePresentationDocument(
        mutate((document) => {
          document.slides[0]!.elements.push(
            { id: 'same', kind: 'shape', name: 'a', x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, visible: true, locked: false, shape: 'rectangle', fill: '#ffffff', stroke: null, strokeWidth: 0 },
            { id: 'same', kind: 'shape', name: 'b', x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, visible: true, locked: false, shape: 'rectangle', fill: '#ffffff', stroke: null, strokeWidth: 0 },
          )
        }),
      ),
    ).toThrow(/Duplicate id/)
  })

  it('rejects non-finite geometry and impossible values', () => {
    expect(() => parsePresentationDocument(mutate((document) => { document.slides[0]!.elements.push({ id: 'e', kind: 'shape', name: 'x', x: Number.NaN, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, visible: true, locked: false, shape: 'rectangle', fill: '#ffffff', stroke: null, strokeWidth: 0 }) }))).toThrow(/finite/)
    expect(() => parsePresentationDocument(mutate((document) => { document.slides[0]!.elements.push({ id: 'e', kind: 'shape', name: 'x', x: 0, y: 0, width: -5, height: 10, rotation: 0, opacity: 1, visible: true, locked: false, shape: 'rectangle', fill: '#ffffff', stroke: null, strokeWidth: 0 }) }))).toThrow(/positive/)
    expect(() => parsePresentationDocument(mutate((document) => { document.slides[0]!.elements.push({ id: 'e', kind: 'shape', name: 'x', x: 0, y: 0, width: 5, height: 10, rotation: 0, opacity: 2, visible: true, locked: false, shape: 'rectangle', fill: '#ffffff', stroke: null, strokeWidth: 0 }) }))).toThrow(/opacity/)
    expect(() => parsePresentationDocument(mutate((document) => { document.slides[0]!.background = 'red' }))).toThrow(/color/)
  })

  it('rejects unsafe links but accepts safe ones', () => {
    const run = { text: 'click', fontId: 'be-vietnam-pro', size: 24, color: '#08152f' }
    const withLink = (link: string) =>
      mutate((document) => {
        document.slides[0]!.elements.push({
          id: 'text-1',
          kind: 'text',
          name: 'link',
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          padding: 4,
          lineHeight: 1.3,
          verticalAlign: 'top',
          paragraphs: [{ runs: [{ ...run, link }], alignment: 'left', bullet: 'none', bulletLevel: 0 }],
        })
      })
    expect(() => parsePresentationDocument(withLink('https://example.edu'))).not.toThrow()
    expect(() => parsePresentationDocument(withLink('mailto:teacher@example.edu'))).not.toThrow()
    for (const unsafe of ['javascript:alert(1)', 'data:text/html;base64,PHN2Zz4=', '/relative', 'file:///etc/passwd']) {
      expect(() => parsePresentationDocument(withLink(unsafe))).toThrowError(expect.objectContaining({ code: 'invalid' }))
    }
  })

  it('rejects image elements that reference missing assets or leave their crop bounds', () => {
    expect(() =>
      parsePresentationDocument(
        mutate((document) => {
          document.slides[0]!.elements.push({
            id: 'img',
            kind: 'image',
            name: 'img',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            assetId: 'missing',
            crop: { x: 0, y: 0, width: 1, height: 1 },
            flipX: false,
            flipY: false,
            alt: '',
          })
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'missing_reference' }))
  })

  it('rejects oversized documents, slides, elements and text', () => {
    const tooManySlides = mutate((document) => {
      for (let i = 0; i <= PRESENTATION_LIMITS.maxSlides; i += 1) {
        document.slides.push({ id: `slide-${i}`, name: `s${i}`, background: '#ffffff', elements: [] })
      }
    })
    expect(() => parsePresentationDocument(tooManySlides)).toThrowError(expect.objectContaining({ code: 'limit_exceeded' }))

    const tooMuchText = mutate((document) => {
      document.slides[0]!.elements.push({
        id: 'big-text',
        kind: 'text',
        name: 'big',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        padding: 0,
        lineHeight: 1,
        verticalAlign: 'top',
        paragraphs: [{ runs: [{ text: 'x'.repeat(PRESENTATION_LIMITS.maxTextLength + 1), fontId: 'be-vietnam-pro', size: 20, color: '#000000' }], alignment: 'left', bullet: 'none', bulletLevel: 0 }],
      })
    })
    expect(() => parsePresentationDocument(tooMuchText)).toThrowError(expect.objectContaining({ code: 'limit_exceeded' }))

    const bigJson = `{"kind":"presentation","padding":"${'x'.repeat(PRESENTATION_LIMITS.maxDocumentChars)}"}`
    expect(() => parsePresentationDocument(bigJson)).toThrowError(expect.objectContaining({ code: 'limit_exceeded' }))
  })

  it('rejects malformed JSON and invalid runs', () => {
    expect(() => parsePresentationDocument('{not json')).toThrowError(expect.objectContaining({ code: 'malformed_data' }))
    expect(() =>
      parsePresentationDocument(
        mutate((document) => {
          document.slides[0]!.elements.push({
            id: 'text-bad',
            kind: 'text',
            name: 'bad',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            padding: 0,
            lineHeight: 1,
            verticalAlign: 'top',
            paragraphs: [{ runs: [{ text: 'x', fontId: 'be-vietnam-pro', size: 0, color: '#000000' }], alignment: 'left', bullet: 'none', bulletLevel: 0 }],
          })
        }),
      ),
    ).toThrow(/size/)
  })

  it('reports validation failures without throwing', () => {
    const good = validatePresentationDocument(validDocument())
    expect(good.ok).toBe(true)
    const bad = validatePresentationDocument({ kind: 'presentation', schemaVersion: 99 })
    expect(bad).toEqual({ ok: false, code: 'unsupported_schema', message: expect.any(String) })
  })

  it('accepts a document at the schema boundary version only', () => {
    const document = validDocument()
    expect(document.schemaVersion).toBe(PRESENTATION_SCHEMA_VERSION)
  })
})
