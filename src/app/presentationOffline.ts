/**
 * Presentation offline readiness (P45 follow-up).
 *
 * Why this exists: the production build serves the presentation routes and each
 * export builder as separate modules fetched over the network, and a static host
 * answers `Cache-Control: no-cache` for them, so a module that is not already in
 * memory cannot be fetched once the connection is gone. A student who is editing
 * when the network disappears can keep saving, reopening and exporting — but only
 * if the modules that local flow needs were fetched while the connection was there.
 *
 * What it warms: the modules the presentation flow renders (the library and editor
 * routes, the editor's lazy canvas) and every export builder, plus the presentation
 * fonts. Fonts are part of readiness rather than a detail of it: the editor refuses
 * to open a presentation while their faces are unavailable, so a cold font fetch is
 * a cold editor.
 *
 * What it never does: retry. A dynamic import that failed is cached as failed for
 * the life of the page, so recovery is a reload while online — the status says that
 * instead of promising a retry, and the reload instruction is composed from the
 * caller's save state so it is never given over unwritten work. Failures stay in
 * here: they never reject into a page, never touch the document or its saving, and a
 * session that never opens the presentation flow never starts this work.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { ensurePresentationFonts } from '@/features/presentations/rendering/fonts'
import { PRESENTATION_OFFLINE_MODULES } from '@/features/presentations/offlineModules'

export type PresentationOfflineStatus = 'idle' | 'preparing' | 'ready' | 'failed'

export type PresentationOfflineSnapshot = {
  status: PresentationOfflineStatus
  /** Why readiness failed; null while it is pending or ready. */
  message: string | null
}

const IDLE_PRESENTATION_OFFLINE: PresentationOfflineSnapshot = { status: 'idle', message: null }

/**
 * What the page knows about work that is still only in memory. A reload is the only
 * recovery from an unprepared session, but a reload discards whatever is unwritten,
 * so the module cannot word that instruction on its own: the editor passes its own
 * save state in.
 */
export type ReloadSafety = {
  /** Changes the editor has not written yet. */
  unsavedWork: boolean
  /** The last local write failed or conflicted. */
  saveFailed: boolean
}

/** Pages with no editor of their own: the library holds no unwritten work. */
export const NOTHING_UNSAVED: ReloadSafety = { unsavedWork: false, saveFailed: false }

/**
 * The instruction that follows "…reconnect": safe to give once the work is written,
 * and explicit that a failing save must not be answered with a reload or a tab close.
 */
export function reloadInstruction(safety: ReloadSafety = NOTHING_UNSAVED): string {
  if (safety.saveFailed) {
    return 'Do not reload or close this tab: saving is failing, and reloading would discard the edits still in this page. Reconnect and press Save to keep them.'
  }
  if (safety.unsavedWork) {
    return 'Reconnect and press Save, then wait for “Saved locally” before reloading this page.'
  }
  return 'Reconnect and reload the page. Your saved work is not affected.'
}

const OFFLINE_CAUSE_BEFORE_LOAD = 'Offline use needs one online load.'
const OFFLINE_CAUSE_UNPREPARED = 'Offline use could not be prepared in this page.'

/** The connection was already gone, so nothing was fetched and nothing is poisoned. */
export const OFFLINE_READINESS_OFFLINE_MESSAGE = `${OFFLINE_CAUSE_BEFORE_LOAD} ${reloadInstruction()}`

/** A required module did not arrive. Reloading while online is the only recovery. */
export const OFFLINE_READINESS_FAILED_MESSAGE = `${OFFLINE_CAUSE_UNPREPARED} ${reloadInstruction()}`

export type PresentationOfflineSources = {
  /** A skipped attempt leaves every module unpoisoned for a later reconnect. */
  isOnline: () => boolean
  /** Fetches the fonts, route modules and export builders the local flow needs. */
  prepare: () => Promise<void>
}

const PRESENTATION_OFFLINE_SOURCES: PresentationOfflineSources = {
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  prepare: async () => {
    await Promise.all([ensurePresentationFonts(), ...PRESENTATION_OFFLINE_MODULES.map((load) => load())])
  },
}

export type PresentationOfflineReadiness = {
  getSnapshot: () => PresentationOfflineSnapshot
  subscribe: (listener: () => void) => () => void
  /** Starts the shared work once; later calls return the same promise. */
  prepare: () => Promise<void>
}

export function createPresentationOfflineReadiness(sources: PresentationOfflineSources): PresentationOfflineReadiness {
  let snapshot = IDLE_PRESENTATION_OFFLINE
  let running: Promise<void> | null = null
  const listeners = new Set<() => void>()

  const publish = (next: PresentationOfflineSnapshot) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const run = async (): Promise<void> => {
    publish({ status: 'preparing', message: null })
    if (!sources.isOnline()) {
      publish({ status: 'failed', message: OFFLINE_READINESS_OFFLINE_MESSAGE })
      return
    }
    try {
      await sources.prepare()
      publish({ status: 'ready', message: null })
    } catch {
      publish({ status: 'failed', message: OFFLINE_READINESS_FAILED_MESSAGE })
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    prepare: () => (running ??= run()),
  }
}

/** One record per page session: the presentation routes below share it. */
export const presentationOffline = createPresentationOfflineReadiness(PRESENTATION_OFFLINE_SOURCES)

/**
 * What the UI may claim: only a completed run says the session is offline-ready, and
 * the two failure messages are recomposed with the caller's reload safety so an editor
 * holding unwritten work is never told to reload over it.
 */
export function offlineReadinessLabel(
  snapshot: PresentationOfflineSnapshot,
  safety: ReloadSafety = NOTHING_UNSAVED,
): string {
  if (snapshot.status === 'ready') return 'Ready for offline use.'
  if (snapshot.status === 'failed') {
    const cause = snapshot.message === OFFLINE_READINESS_OFFLINE_MESSAGE ? OFFLINE_CAUSE_BEFORE_LOAD : OFFLINE_CAUSE_UNPREPARED
    return `${cause} ${reloadInstruction(safety)}`
  }
  return 'Preparing offline use…'
}

/**
 * Starts readiness when a presentation route opens and reports it. The work waits
 * for an idle moment so it does not compete with the page's own route and font
 * loading; the timeout keeps that wait bounded on a busy page.
 */
export function usePresentationOfflineReadiness(): PresentationOfflineSnapshot {
  const snapshot = useSyncExternalStore(
    presentationOffline.subscribe,
    presentationOffline.getSnapshot,
    presentationOffline.getSnapshot,
  )
  useEffect(() => whenIdle(() => void presentationOffline.prepare()), [])
  return snapshot
}

function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(task, { timeout: 2_000 })
    return () => cancelIdleCallback(handle)
  }
  const handle = setTimeout(task, 0)
  return () => clearTimeout(handle)
}
