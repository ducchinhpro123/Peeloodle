import { useEffect } from 'react'
import type { StickerLabRepository } from '../../lib/persistence/repository'
import { draftSaving } from './draftSaving'

export function useDraftAutosave(repo: StickerLabRepository) {
  useEffect(() => {
    const attachment = draftSaving.attachAutosave(repo)
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (attachment.shouldWarnBeforeUnload()) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('pagehide', attachment.pageHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      attachment.detach()
      window.removeEventListener('pagehide', attachment.pageHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [repo])
}
