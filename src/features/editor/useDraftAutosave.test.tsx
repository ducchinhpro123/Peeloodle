import { StrictMode, type ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryRepository } from '../../lib/persistence/repository'
import { resetEditorStore, useEditorStore } from './store'
import { useDraftAutosave } from './useDraftAutosave'

beforeEach(() => {
  vi.useFakeTimers()
  resetEditorStore()
  useEditorStore.getState().createDraft('lifecycle-draft')
})
afterEach(() => {
  cleanup()
  resetEditorStore()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('connects browser events once in StrictMode and removes them on unmount', async () => {
  const repo = createMemoryRepository()
  const write = vi.spyOn(repo, 'saveProjectWithAssets')
  const { unmount } = renderHook(() => useDraftAutosave(repo), {
    wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
  })
  useEditorStore.getState().updateTitle('Before page hide')
  const before = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(before)
  expect(before.defaultPrevented).toBe(true)
  await act(async () => {
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(write).toHaveBeenCalledTimes(1)
  expect((await repo.getProject('lifecycle-draft')).title).toBe('Before page hide')
  const saved = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(saved)
  expect(saved.defaultPrevented).toBe(false)

  useEditorStore.getState().updateTitle('After unmount')
  unmount()
  window.dispatchEvent(new Event('pagehide'))
  const detached = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(detached)
  expect(detached.defaultPrevented).toBe(false)
  await vi.advanceTimersByTimeAsync(1000)
  expect(write).toHaveBeenCalledTimes(1)
})
