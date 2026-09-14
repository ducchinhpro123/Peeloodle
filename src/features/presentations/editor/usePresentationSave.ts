/**
 * React adapter over `presentationSaving.ts`: it publishes the saver's status as
 * state and attaches the autosave/beforeunload lifecycle. The write rules and the
 * single-writer queue live in the saver, not here.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { PresentationRepository } from '@/lib/persistence/presentations/repository'
import { createPresentationSaving } from './presentationSaving'

export { AUTOSAVE_DELAY_MS, createPresentationSaving } from './presentationSaving'
export type {
  ConflictRecoveryOutcome,
  PersistInsertOutcome,
  PersistOutcome,
  PresentationSaveState,
  PresentationSaveStatus,
} from './presentationSaving'

export function usePresentationSave(input: {
  repository: PresentationRepository
  documentId: string | null
  /** The owning text session's flush; commits on-screen text before a save reads the store. */
  flushText: () => void
}) {
  const { repository, documentId, flushText } = input
  // The saver lives for the open document: only a different document or
  // repository replaces it. The flush is read through a ref so an inline callback
  // cannot drop the writer that is mid-save.
  const flushTextRef = useRef(flushText)
  flushTextRef.current = flushText
  const saver = useMemo(
    () => createPresentationSaving({ repository, documentId, flushText: () => flushTextRef.current() }),
    [repository, documentId],
  )
  const state = useSyncExternalStore(saver.subscribeStatus, saver.getStatus, saver.getStatus)

  useEffect(() => {
    const attachment = saver.attachAutosave()
    // Unsaved local work must not disappear behind a silent tab close. Browsers
    // show their own generic prompt; this only asks for one.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!attachment.shouldWarnBeforeUnload()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      attachment.detach()
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [saver])

  const saveNow = useCallback(async (): Promise<void> => {
    await saver.save()
  }, [saver])

  const requestSave = useCallback(() => {
    void saver.save()
  }, [saver])

  return {
    state,
    saveNow,
    requestSave,
    saveBeforeLeave: saver.saveBeforeLeave,
    persistInsert: saver.persistInsert,
    persistReplace: saver.persistReplace,
    keepMineAsCopy: saver.keepMineAsCopy,
  }
}
