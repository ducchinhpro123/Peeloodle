import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'
import { usePresentationStore } from './store'

/**
 * Blocks every router navigation away from a dirty presentation — link clicks,
 * programmatic navigate() and the browser's Back/Forward buttons — and resolves
 * each block by saving first. The write is awaited; when it fails the editor
 * stays put and `onSaveFailed` explains why. Reload/tab-close stays covered by
 * the `beforeunload` handler in `usePresentationSave`.
 *
 * A clean or unopened document never blocks, so leaving an untouched editor
 * costs no write. The decision is taken from `useBlocker` inside the router that
 * owns history; individual links no longer consult a guard registry.
 */
export function useLeaveBlock(input: {
  documentId: string | null
  saveBeforeLeave: () => Promise<boolean>
  onSaveFailed: () => void
}): void {
  const { documentId, saveBeforeLeave, onSaveFailed } = input
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const store = usePresentationStore.getState()
    if (!documentId || store.document?.id !== documentId || !store.dirty) return false
    return currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search
  })

  // One block is resolved once, however many times StrictMode or a re-render
  // replays the effect. The key is the blocked destination; it is cleared as
  // soon as the block ends, so a later navigation is handled afresh.
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      handled.current = null
      return
    }
    const key = `${blocker.location.pathname}${blocker.location.search}`
    if (handled.current === key) return
    handled.current = key
    void (async () => {
      const mayLeave = await saveBeforeLeave()
      if (blocker.state !== 'blocked') return
      if (mayLeave) blocker.proceed()
      else {
        onSaveFailed()
        blocker.reset()
      }
    })()
  }, [blocker, saveBeforeLeave, onSaveFailed])
}
