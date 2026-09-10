import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as persistence from '../../lib/persistence/repository'
import { resetEditorStore, useEditorStore } from '../editor/store'
import { WorkspaceProvider, flushWorkspace } from './Workspace'

// Session restoration exercises the real workspace flush/reset path without cloud I/O.
vi.mock('./client', () => ({
  readCloudConfig: () => ({ url: 'https://example.supabase.co', key: 'test' }),
  getAuthClient: async () => ({ auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
}))

let repo: ReturnType<typeof persistence.createMemoryRepository>
beforeEach(() => {
  resetEditorStore()
  useEditorStore.getState().createDraft('workspace-draft')
  useEditorStore.getState().updateTitle('Retained work')
  repo = persistence.createMemoryRepository()
  vi.spyOn(persistence, 'getLocalRepository').mockReturnValue(repo)
})
afterEach(() => {
  cleanup()
  resetEditorStore()
  vi.restoreAllMocks()
})

function openWorkspace() {
  render(<MemoryRouter><WorkspaceProvider><p>Workspace ready</p></WorkspaceProvider></MemoryRouter>)
}

it('awaits persistence before resetting the editor during session restoration', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const original = repo.saveProjectWithAssets.bind(repo)
  const write = vi.spyOn(repo, 'saveProjectWithAssets').mockImplementationOnce(async (...args) => {
    await gate
    return original(...args)
  })
  const epoch = useEditorStore.getState().workspaceEpoch
  openWorkspace()
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('heading', { name: 'Opening private workspace' })).toBeInTheDocument()
  expect(useEditorStore.getState().document?.title).toBe('Retained work')
  expect(useEditorStore.getState().workspaceEpoch).toBe(epoch)
  await act(async () => { release() })
  await screen.findByText('Workspace ready')
  expect((await repo.getProject('workspace-draft')).title).toBe('Retained work')
  expect(useEditorStore.getState().document).toBeNull()
  expect(useEditorStore.getState().workspaceEpoch).toBe(epoch + 1)
})

it('keeps the workspace locked and draft intact on failure, then permits retry', async () => {
  repo.injectWriteFailure()
  const epoch = useEditorStore.getState().workspaceEpoch
  openWorkspace()
  expect(await screen.findByRole('alert')).toHaveTextContent(/draft could not be saved locally/i)
  expect(useEditorStore.getState().document?.title).toBe('Retained work')
  expect(useEditorStore.getState().workspaceEpoch).toBe(epoch)
  expect(screen.queryByText('Workspace ready')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Retry local save and session' }))
  await screen.findByText('Workspace ready')
  expect((await repo.getProject('workspace-draft')).title).toBe('Retained work')
  expect(useEditorStore.getState().document).toBeNull()
})

it('rejects the account-facing flush if its originating workspace was superseded', async () => {
  let finish!: () => void
  const stroke = new Promise<void>((resolve) => { finish = resolve })
  useEditorStore.setState({ finishMaskStroke: () => stroke })
  const result = flushWorkspace(repo)
  const rejected = expect(result).rejects.toThrow(/could not save the current draft/i)
  resetEditorStore()
  useEditorStore.getState().createDraft('replacement')
  finish()
  await rejected
  expect(useEditorStore.getState().document?.id).toBe('replacement')
  expect(await repo.listProjects()).toEqual([])
})
