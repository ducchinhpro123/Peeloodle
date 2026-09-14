import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportFileName, usePresentationExport } from './usePresentationExport'
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
})
