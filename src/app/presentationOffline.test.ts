import '@testing-library/jest-dom/vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  OFFLINE_READINESS_FAILED_MESSAGE,
  OFFLINE_READINESS_OFFLINE_MESSAGE,
  createPresentationOfflineReadiness,
  offlineReadinessLabel,
  usePresentationOfflineReadiness,
} from './presentationOffline'

// The hook's two sources are replaced so this file stays a test of the readiness
// store and its UI wiring. What the real sources do — requesting all eight font
// faces, fetching the route and builder modules — is covered deterministically in
// `features/presentations/rendering/fonts.test.ts` and
// `features/presentations/offlineModules.test.ts`, and in the browser by
// `e2e/presentations-production-offline.spec.ts`.
vi.mock('@/features/presentations/rendering/fonts', () => ({ ensurePresentationFonts: vi.fn(async () => {}) }))
vi.mock('@/features/presentations/offlineModules', () => ({ PRESENTATION_OFFLINE_MODULES: [async () => {}] }))

describe('presentation offline readiness', () => {
  it('reports preparing until every required module and font is ready', async () => {
    let finish = () => {}
    const prepare = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const readiness = createPresentationOfflineReadiness({ isOnline: () => true, prepare })
    const seen: string[] = []
    readiness.subscribe(() => seen.push(readiness.getSnapshot().status))

    const first = readiness.prepare()
    const second = readiness.prepare()

    expect(readiness.getSnapshot()).toEqual({ status: 'preparing', message: null })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)

    finish()
    await first
    expect(readiness.getSnapshot()).toEqual({ status: 'ready', message: null })
    expect(seen).toEqual(['preparing', 'ready'])
  })

  it('fetches nothing when the connection is already gone', async () => {
    const prepare = vi.fn(async () => {})
    const readiness = createPresentationOfflineReadiness({ isOnline: () => false, prepare })

    await readiness.prepare()

    // Skipping matters: an import attempted offline is cached as failed for the page,
    // so the reconnect would still find nothing loadable.
    expect(prepare).not.toHaveBeenCalled()
    expect(readiness.getSnapshot()).toEqual({ status: 'failed', message: OFFLINE_READINESS_OFFLINE_MESSAGE })
  })

  it('reports a failed preparation with reload guidance and never retries it', async () => {
    const prepare = vi.fn(async () => {
      throw new Error('Failed to fetch dynamically imported module: http://localhost/assets/pdf-x.js')
    })
    const readiness = createPresentationOfflineReadiness({ isOnline: () => true, prepare })

    await expect(readiness.prepare()).resolves.toBeUndefined()
    expect(readiness.getSnapshot()).toEqual({ status: 'failed', message: OFFLINE_READINESS_FAILED_MESSAGE })

    await readiness.prepare()
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(readiness.getSnapshot()).toEqual({ status: 'failed', message: OFFLINE_READINESS_FAILED_MESSAGE })
  })

  it('labels only a finished run as ready', () => {
    expect(offlineReadinessLabel({ status: 'idle', message: null })).toBe('Preparing offline use…')
    expect(offlineReadinessLabel({ status: 'preparing', message: null })).toBe('Preparing offline use…')
    expect(offlineReadinessLabel({ status: 'ready', message: null })).toBe('Ready for offline use.')
    expect(offlineReadinessLabel({ status: 'failed', message: OFFLINE_READINESS_FAILED_MESSAGE })).toBe(OFFLINE_READINESS_FAILED_MESSAGE)
  })

  it('never words reload guidance over the editor’s unwritten work', () => {
    const failed = { status: 'failed', message: OFFLINE_READINESS_FAILED_MESSAGE } as const
    const offline = { status: 'failed', message: OFFLINE_READINESS_OFFLINE_MESSAGE } as const

    // Unsaved edits: the reload waits for a completed local save.
    expect(offlineReadinessLabel(failed, { unsavedWork: true, saveFailed: false })).toBe(
      'Offline use could not be prepared in this page. Reconnect and press Save, then wait for “Saved locally” before reloading this page.',
    )
    // A failing save: no reload and no tab close, because they would discard the edits.
    expect(offlineReadinessLabel(failed, { unsavedWork: true, saveFailed: true })).toBe(
      'Offline use could not be prepared in this page. Do not reload or close this tab: saving is failing, and reloading would discard the edits still in this page. Reconnect and press Save to keep them.',
    )
    // The cause differs when the connection was already gone; the instruction does not.
    expect(offlineReadinessLabel(offline, { unsavedWork: true, saveFailed: false })).toBe(
      'Offline use needs one online load. Reconnect and press Save, then wait for “Saved locally” before reloading this page.',
    )
    // A ready session says nothing about reloading, whatever the editor is holding.
    expect(offlineReadinessLabel({ status: 'ready', message: null }, { unsavedWork: true, saveFailed: true })).toBe('Ready for offline use.')
  })

  it('starts the shared preparation when a presentation page mounts', async () => {
    const { result } = renderHook(() => usePresentationOfflineReadiness())

    expect(result.current.status).toBe('idle')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.message).toBeNull()
  })
})
