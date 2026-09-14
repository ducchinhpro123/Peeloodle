/**
 * Lazy export orchestration (P40).
 *
 * PDF and PPTX builders are loaded on demand, so opening the editor never pays
 * for pdf-lib or PptxGenJS. One export runs at a time; its snapshot is always
 * disposed, downloads happen only after the bytes are complete, and cancellation
 * between slides stops the work without producing a partial file.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { downloadBlob } from '@/features/exports/download'
import type { PresentationRepository } from '@/lib/persistence/presentations/repository'
import type { ExportWarning } from '../exports/snapshot'
import type { buildPresentationPdf } from '../exports/pdf'
import type { buildPresentationPptx } from '../exports/pptx'
import type { prepareExportSnapshot } from '../exports/snapshot'

export type PresentationExportFormat = 'pdf' | 'pptx' | 'backup'
export type PresentationExportPhase = 'idle' | 'preparing' | 'rendering' | 'done' | 'failed' | 'cancelled'

export type PresentationExportState = {
  phase: PresentationExportPhase
  format: PresentationExportFormat | null
  /** Slides rendered so far, and the total for the running export. */
  completed: number
  total: number
  message: string | null
  warnings: ExportWarning[]
}

export const IDLE_PRESENTATION_EXPORT: PresentationExportState = {
  phase: 'idle',
  format: null,
  completed: 0,
  total: 0,
  message: null,
  warnings: [],
}

/** Seams the hook tests replace so no canvas or download is needed. */
export type PresentationExportOverrides = {
  prepare?: typeof prepareExportSnapshot
  buildPdf?: typeof buildPresentationPdf
  buildPptx?: typeof buildPresentationPptx
  download?: (blob: Blob, filename: string) => void
}

export function exportFileName(title: string, format: PresentationExportFormat): string {
  const base = title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60) || 'presentation'
  return format === 'backup' ? `${base}.stickerlab.zip` : `${base}.${format}`
}

const MIME: Record<PresentationExportFormat, string> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  backup: 'application/zip',
}

export function usePresentationExport(input: { repository: PresentationRepository; flushText: () => void } & PresentationExportOverrides): {
  state: PresentationExportState
  exportDeck: (format: PresentationExportFormat) => Promise<void>
  cancel: () => void
} {
  const [state, setState] = useState<PresentationExportState>(IDLE_PRESENTATION_EXPORT)
  const mounted = useRef(true)
  const running = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const latest = useRef(input)
  latest.current = input

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      abort.current?.abort()
    }
  }, [])

  const publish = useCallback((next: PresentationExportState) => {
    if (mounted.current) setState(next)
  }, [])

  const cancel = useCallback(() => {
    abort.current?.abort()
  }, [])

  const exportDeck = useCallback(async (format: PresentationExportFormat) => {
    if (running.current) return
    running.current = true
    const controller = new AbortController()
    abort.current = controller
    publish({ phase: 'preparing', format, completed: 0, total: 0, message: null, warnings: [] })

    let snapshot: Awaited<ReturnType<typeof prepareExportSnapshot>> | null = null
    try {
      const snapshotModule = await import('../exports/snapshot')
      const prepare = latest.current.prepare ?? snapshotModule.prepareExportSnapshot
      snapshot = await prepare(latest.current.repository, { flushText: latest.current.flushText })
      if (controller.signal.aborted) throw new Error('cancelled')

      const total = snapshot.document.slides.length
      publish({ phase: 'rendering', format, completed: 0, total, message: null, warnings: snapshot.warnings })

      let bytes: Uint8Array
      if (format === 'pdf') {
        const { buildPresentationPdf } = await import('../exports/pdf')
        const buildPdf = latest.current.buildPdf ?? buildPresentationPdf
        bytes = await buildPdf(snapshot, undefined, {
          signal: controller.signal,
          onProgress: (completed, count) => {
            publish({ phase: 'rendering', format, completed, total: count, message: null, warnings: snapshot!.warnings })
          },
        })
      } else if (format === 'pptx') {
        const { buildPresentationPptx } = await import('../exports/pptx')
        const buildPptx = latest.current.buildPptx ?? buildPresentationPptx
        bytes = await buildPptx(snapshot, { title: snapshot.document.title })
        publish({ phase: 'rendering', format, completed: total, total, message: null, warnings: snapshot.warnings })
      } else {
        const { createBackupArchive } = await import('../exports/backup')
        const media = new Map([...snapshot.media].map(([assetId, record]) => [assetId, record.bytes]))
        bytes = await createBackupArchive(snapshot.document, media)
        publish({ phase: 'rendering', format, completed: total, total, message: null, warnings: snapshot.warnings })
      }
      if (controller.signal.aborted) throw new Error('cancelled')

      const download = latest.current.download ?? downloadBlob
      download(new Blob([bytes], { type: MIME[format] }), exportFileName(snapshot.document.title, format))
      publish({ phase: 'done', format, completed: total, total, message: null, warnings: snapshot.warnings })
    } catch (error) {
      const wasCancelled = controller.signal.aborted || (error instanceof Error && error.message === 'cancelled')
      publish({
        phase: wasCancelled ? 'cancelled' : 'failed',
        format,
        completed: 0,
        total: 0,
        message: wasCancelled ? 'The export was cancelled.' : error instanceof Error ? error.message : 'The export failed.',
        warnings: [],
      })
    } finally {
      snapshot?.dispose()
      abort.current = null
      running.current = false
    }
  }, [publish])

  return { state, exportDeck, cancel }
}
