import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportFailureMessage, exportFileName, usePresentationExport } from './usePresentationExport'
import { createMemoryPresentationRepository } from '@/lib/persistence/presentations/repository'
import { createPresentationDocument, createSlide } from '../model/factories'
import { usePresentationStore } from './store'
import type { PresentationExportSnapshot } from '../exports/snapshot'

function snapshotWith(slideCount: number, warnings: PresentationExportSnapshot['warnings'] = []): PresentationExportSnapshot {
  const document = createPresentationDocument({ id: 'deck', title: 'Deck' })
  document.slides = Array.from({ length: slideCount }, (_, index) => createSlide({ id: `slide-${index}`, name: `Slide ${index + 1}` }))
  return { document, revision: document.revision, images: new Map(), media: new Map(), warnings, dispose: vi.fn() }
}

beforeEach(() => {
  usePresentationStore.getState().loadDocument(createPresentationDocument({ id: 'live', title: 'Live deck' }), { saved: true })
})

afterEach(() => {
  usePresentationStore.getState().closeDocument()
})

describe('presentation export controller', () => {
  it('reports that no presentation is open instead of exporting', async () => {
    usePresentationStore.getState().closeDocument()
    const repository = createMemoryPresentationRepository()
    const { result } = renderHook(() => usePresentationExport({ repository, flushText: () => {} }))

    await act(async () => { await result.current.exportDeck('pdf') })

    expect(result.current.state).toMatchObject({ phase: 'failed', message: expect.stringContaining('Open a presentation before exporting.') })
  })

  it('prepares, reports progress, downloads once and disposes the snapshot', async () => {
    const repository = createMemoryPresentationRepository()
    const snapshot = snapshotWith(2)
    const download = vi.fn()
    const progress: number[] = []
    const { result } = renderHook(() => usePresentationExport({
      repository,
      flushText: () => {},
      prepare: async () => snapshot,
      download,
      buildPdf: async (_snapshot, _rasterize, options) => {
        options?.onProgress?.(1, 2)
        progress.push(1)
        options?.onProgress?.(2, 2)
        progress.push(2)
        return new Uint8Array([1, 2, 3])
      },
    }))

    await act(async () => { await result.current.exportDeck('pdf') })

    expect(progress).toEqual([1, 2])
    expect(download).toHaveBeenCalledTimes(1)
    const [blob, filename] = download.mock.calls[0]!
    expect((blob as Blob).type).toBe('application/pdf')
    expect(filename).toBe('Deck.pdf')
    expect(snapshot.dispose).toHaveBeenCalledTimes(1)
    expect(result.current.state).toMatchObject({ phase: 'done', format: 'pdf', completed: 2, total: 2 })
  })

  it('cancels between slides without downloading and still disposes', async () => {
    const repository = createMemoryPresentationRepository()
    const snapshot = snapshotWith(3)
    const download = vi.fn()
    const { result } = renderHook(() => usePresentationExport({
      repository,
      flushText: () => {},
      prepare: async () => snapshot,
      download,
      buildPdf: (_snapshot, _rasterize, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')))
      }),
    }))

    let exportPromise: Promise<void> | undefined
    act(() => {
      exportPromise = result.current.exportDeck('pdf')
    })
    await waitFor(() => expect(result.current.state.phase).toBe('rendering'))
    act(() => result.current.cancel())
    await act(async () => { await exportPromise })

    expect(download).not.toHaveBeenCalled()
    expect(snapshot.dispose).toHaveBeenCalledTimes(1)
    expect(result.current.state.phase).toBe('cancelled')
  })

  it('reports a failure in words and never downloads partial bytes', async () => {
    const repository = createMemoryPresentationRepository()
    const snapshot = snapshotWith(1)
    const download = vi.fn()
    const { result } = renderHook(() => usePresentationExport({
      repository,
      flushText: () => {},
      prepare: async () => snapshot,
      download,
      buildPdf: async () => { throw new Error('Some artwork could not be decoded') },
    }))

    await act(async () => { await result.current.exportDeck('pdf') })

    expect(download).not.toHaveBeenCalled()
    expect(snapshot.dispose).toHaveBeenCalledTimes(1)
    expect(result.current.state).toMatchObject({ phase: 'failed', message: 'Some artwork could not be decoded' })
  })

  it('runs one export at a time', async () => {
    const repository = createMemoryPresentationRepository()
    const snapshot = snapshotWith(1)
    const download = vi.fn()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const buildPdf = vi.fn(async () => {
      await gate
      return new Uint8Array([1])
    })
    const { result } = renderHook(() => usePresentationExport({ repository, flushText: () => {}, prepare: async () => snapshot, download, buildPdf }))

    let first: Promise<void> | undefined
    act(() => {
      first = result.current.exportDeck('pdf')
    })
    await act(async () => { await result.current.exportDeck('pdf') })
    release!()
    await act(async () => { await first })

    expect(buildPdf).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('sanitizes the download name and keeps the extension', () => {
    expect(exportFileName('Bài: "Deck" *', 'pptx')).toBe('Bài Deck.pptx')
    expect(exportFileName('   ', 'pdf')).toBe('presentation.pdf')
  })

  it('turns an unloadable builder into reload guidance instead of a browser string', () => {
    // Chromium, Firefox and Safari word the same failure differently; all three
    // mean the chunk is not in memory and cannot be fetched again in this page.
    for (const raw of [
      'Failed to fetch dynamically imported module: http://localhost/assets/pdf-x.js',
      'error loading dynamically imported module: http://localhost/assets/pptx-x.js',
      'Importing a module script failed.',
    ]) {
      const message = exportFailureMessage(new Error(raw))
      expect(message).toContain('Reconnect and reload the page')
      expect(message).toContain('Your saved work is not affected.')
      expect(message).not.toContain('dynamically imported module')
    }
    expect(exportFailureMessage(new Error('The presentation has no slides'))).toBe('The presentation has no slides')
    expect(exportFailureMessage(undefined)).toBe('The export failed.')
  })

  it('never words the reload instruction over the editor’s unwritten work', async () => {
    const moduleError = 'Failed to fetch dynamically imported module: http://127.0.0.1:4176/assets/pdf-x.js'
    // Saved work keeps the plain instruction; unwritten work must be written first.
    expect(exportFailureMessage(new Error(moduleError), { unsavedWork: false, saveFailed: false })).toContain('Reconnect and reload the page')
    expect(exportFailureMessage(new Error(moduleError), { unsavedWork: true, saveFailed: false })).toBe(
      'This export needs a part of the app that could not be loaded. Reconnect and press Save, then wait for “Saved locally” before reloading this page.',
    )
    expect(exportFailureMessage(new Error(moduleError), { unsavedWork: true, saveFailed: true })).toContain('Do not reload or close this tab')

    // The same state reaches the dialog's message: a failed export while the save is
    // failing must not offer a reload, because the browser's close prompt would take
    // the edits with it.
    const repository = createMemoryPresentationRepository()
    const snapshot = snapshotWith(1)
    const { result } = renderHook(() => usePresentationExport({
      repository,
      flushText: () => {},
      reloadSafety: { unsavedWork: true, saveFailed: true },
      prepare: async () => snapshot,
      buildPdf: async () => { throw new Error(moduleError) },
    }))

    await act(async () => { await result.current.exportDeck('pdf') })

    expect(result.current.state).toMatchObject({ phase: 'failed', message: expect.stringContaining('Do not reload or close this tab') })
    expect(result.current.state.message).not.toContain('reload the page')
  })
})
