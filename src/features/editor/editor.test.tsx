import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAppRoutes } from '../../app/routes'
import { createMemoryRepository, createProjectDocument } from '../../lib/persistence/repository'
import { resetEditorStore, useEditorStore } from './store'

const pngBytes = readFileSync('e2e/fixtures/red.png')

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserver
  globalThis.createImageBitmap = async () =>
    ({
      width: 64,
      height: 64,
      close() {},
    }) as ImageBitmap
  let created = 0
  URL.createObjectURL = () => `blob:test-${created++}`
  URL.revokeObjectURL = () => {}
})

afterEach(() => {
  cleanup()
  resetEditorStore()
})

function renderApp(path = '/create', repo = createMemoryRepository()) {
  const router = createMemoryRouter(createAppRoutes({ repository: repo }), { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return repo
}

function pngFile(name = 'pet.png') {
  return new File([pngBytes], name, { type: 'image/png' })
}

function uploadPhoto(file = pngFile()) {
  const input = screen.getByTestId('photo-file-input') as HTMLInputElement
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  fireEvent.change(input)
}

describe('editor integration', () => {
  it('uploads, edits text, saves, and reopens the composition', async () => {
    const repo = renderApp()
    expect(await screen.findByRole('heading', { name: /untitled sticker/i })).toBeInTheDocument()

    uploadPhoto()
    await waitFor(() => expect(screen.getAllByAltText('Image').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    const content = await screen.findByLabelText('Text content')
    fireEvent.focus(content)
    fireEvent.change(content, { target: { value: 'Hello sticker' } })
    fireEvent.blur(content)
    expect(screen.getAllByText('Hello sticker').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /save to my stickers/i }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved locally/i))

    const saved = await repo.listProjects()
    expect(saved).toHaveLength(1)
    expect(saved[0]?.layers).toHaveLength(2)

    fireEvent.click(screen.getByRole('link', { name: 'Home' }))
    await screen.findByRole('heading', { name: /small stickers/i })
    fireEvent.click(screen.getByRole('link', { name: /untitled sticker/i }))
    await waitFor(() => expect(screen.getAllByText('Hello sticker').length).toBeGreaterThan(0))
  })

  it('starts text editing from a double click on the canvas', async () => {
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    const canvasText = (await screen.findAllByText('Text')).find((node) => node.tagName === 'P')
    expect(canvasText).toBeTruthy()
    fireEvent.doubleClick(canvasText!)
    expect(screen.getAllByLabelText('Text content').some((field) => field === document.activeElement)).toBe(true)
  })

  it('keeps local work and reports save failed when persistence rejects', async () => {
    const repo = renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    const content = await screen.findByLabelText('Text content')
    fireEvent.focus(content)
    fireEvent.change(content, { target: { value: 'Unsaved text' } })
    fireEvent.blur(content)
    repo.injectWriteFailure()
    fireEvent.click(screen.getByRole('button', { name: /save to my stickers/i }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/save failed/i))
    expect(screen.getAllByText('Unsaved text').length).toBeGreaterThan(0)
    expect(await repo.listProjects()).toEqual([])
  })

  it('rehydrates assets and fonts from a saved document', async () => {
    const repo = renderApp()
    await screen.findByRole('heading', { name: /untitled sticker/i })
    uploadPhoto()
    await waitFor(() => expect(screen.getAllByAltText('Image').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    fireEvent.change(await screen.findByLabelText('Font family'), { target: { value: 'Georgia' } })
    fireEvent.click(screen.getByRole('button', { name: /save to my stickers/i }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved locally/i))
    const id = useEditorStore.getState().document?.id
    if (!id) throw new Error('missing project id')
    resetEditorStore()
    cleanup()
    renderApp(`/editor/${id}`, repo)
    await waitFor(() => {
      const text = useEditorStore.getState().document?.layers.find((layer) => layer.kind === 'text')
      expect(text && text.kind === 'text' ? text.fontFamily : undefined).toBe('Georgia')
    })
    expect(screen.getAllByAltText('Image').length).toBeGreaterThan(0)
  })

  it.each(['/create?tool=text', '/editor/another-project'])('retains a failed draft instead of replacing it from %s', async (path) => {
    const repo = createMemoryRepository()
    useEditorStore.getState().createDraft('retained-draft')
    useEditorStore.getState().updateTitle('Retained draft')
    repo.injectWriteFailure()
    renderApp(path, repo)
    expect(await screen.findByRole('heading', { name: 'Retained draft' })).toBeInTheDocument()
    expect(useEditorStore.getState().document?.id).toBe('retained-draft')
    expect(useEditorStore.getState().dirty).toBe(true)
    expect(await repo.listProjects()).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent(/save failed/i)
  })

  it('does not intercept undo or nudge while typing in the text field', async () => {
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    const content = await screen.findByLabelText('Text content')
    fireEvent.focus(content)
    fireEvent.change(content, { target: { value: 'Typed in field' } })
    const past = useEditorStore.getState().past.length
    const x = useEditorStore.getState().document!.layers[0]!.transform.x
    fireEvent.keyDown(content, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(content, { key: 'ArrowRight' })
    expect(useEditorStore.getState().past.length).toBe(past)
    expect(useEditorStore.getState().document!.layers[0]!.transform.x).toBe(x)
    const text = useEditorStore.getState().document!.layers.find((layer) => layer.kind === 'text')
    expect(text && text.kind === 'text' ? text.content : undefined).toBe('Typed in field')
    fireEvent.blur(content)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(useEditorStore.getState().document!.layers[0]!.transform.x).toBe(x + 1)
  })

  it('saves a newer dirty revision after an in-flight save finishes', async () => {
    const repo = createMemoryRepository()
    let release = () => {}
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let started = 0
    const inner = repo.saveProjectWithAssets.bind(repo)
    repo.saveProjectWithAssets = async (document, assets) => {
      started += 1
      if (started === 1) await blocked
      return inner(document, assets)
    }
    renderApp('/create', repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    fireEvent.click(screen.getByRole('button', { name: /save to my stickers/i }))
    await waitFor(() => expect(started).toBe(1))
    fireEvent.change(screen.getByLabelText('Sticker title'), { target: { value: 'After save started' } })
    fireEvent.click(screen.getByRole('button', { name: /save to my stickers/i }))
    release()
    await waitFor(async () => {
      const saved = await repo.listProjects()
      expect(saved[0]?.title).toBe('After save started')
    })
    expect(useEditorStore.getState().document?.title).toBe('After save started')
  })

  it('does not hydrate a stale project load after leaving the editor', async () => {
    const repo = createMemoryRepository()
    const document = createProjectDocument({ id: 'stale-load', title: 'From disk' })
    await repo.saveProject(document)
    let release = () => {}
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const inner = repo.getProject.bind(repo)
    repo.getProject = async (id) => {
      await blocked
      return inner(id)
    }
    renderApp('/editor/stale-load', repo)
    expect(await screen.findByText(/opening sticker/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Home' }))
    await screen.findByRole('heading', { name: /small stickers/i })
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(useEditorStore.getState().document?.id).not.toBe('stale-load')
  })

  it('flushes a dirty draft when leaving before the autosave debounce', async () => {
    const repo = renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    const content = await screen.findByLabelText('Text content')
    fireEvent.focus(content)
    fireEvent.change(content, { target: { value: 'Keep me' } })
    fireEvent.blur(content)
    fireEvent.click(screen.getByRole('link', { name: 'Home' }))
    await waitFor(async () => {
      const saved = await repo.listProjects()
      expect(saved).toHaveLength(1)
      const text = saved[0]?.layers.find((layer) => layer.kind === 'text')
      expect(text && text.kind === 'text' ? text.content : undefined).toBe('Keep me')
    })
  })

  it('discards a stale upload and sample after the project is replaced', async () => {
    let releaseUpload = () => {}
    const blockedUpload = new Promise<void>((resolve) => {
      releaseUpload = resolve
    })
    globalThis.createImageBitmap = async () => {
      await blockedUpload
      return { width: 64, height: 64, close() {} } as ImageBitmap
    }
    renderApp()
    await screen.findByRole('heading', { name: /untitled sticker/i })
    const firstId = useEditorStore.getState().document!.id
    uploadPhoto()
    useEditorStore.getState().createDraft()
    const secondId = useEditorStore.getState().document!.id
    expect(secondId).not.toBe(firstId)
    releaseUpload()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(useEditorStore.getState().document?.id).toBe(secondId)
    expect(useEditorStore.getState().document?.layers).toEqual([])
    expect(useEditorStore.getState().uploadError).toBe(null)

    useEditorStore.getState().createDraft(firstId)
    await screen.findByRole('button', { name: 'Add Cat in console' })
    let releaseSample = () => {}
    const blockedSample = new Promise<void>((resolve) => {
      releaseSample = resolve
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      await blockedSample
      return new Response(pngBytes, { status: 200, headers: { 'Content-Type': 'image/png' } })
    }) as typeof fetch
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Add Cat in console' }))
      useEditorStore.getState().createDraft()
      const thirdId = useEditorStore.getState().document!.id
      expect(thirdId).not.toBe(firstId)
      releaseSample()
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(useEditorStore.getState().document?.id).toBe(thirdId)
      expect(useEditorStore.getState().document?.layers).toEqual([])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not nudge a layer while the font size slider is focused', async () => {
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    const slider = await screen.findByRole('slider', { name: 'Font size' })
    slider.focus()
    const x = useEditorStore.getState().document!.layers[0]!.transform.x
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(useEditorStore.getState().document!.layers[0]!.transform.x).toBe(x)
    expect(useEditorStore.getState().gestureActive).toBe(false)
  })

  it('finishes unchanged and keyboard color-picker gestures', async () => {
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open color picker' }))
    const alpha = await screen.findByRole('slider', { name: 'Alpha' })

    fireEvent.pointerDown(alpha, { button: 0 })
    fireEvent.pointerUp(alpha, { button: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Open color picker' }))
    expect(useEditorStore.getState().gestureActive).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Open color picker' }))
    const keyboardAlpha = await screen.findByRole('slider', { name: 'Alpha' })
    const historyBefore = useEditorStore.getState().past.length
    keyboardAlpha.focus()
    fireEvent.keyDown(keyboardAlpha, { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37 })
    fireEvent.keyDown(keyboardAlpha, { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37 })
    fireEvent.keyUp(keyboardAlpha, { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37 })
    await waitFor(() => expect(useEditorStore.getState().gestureActive).toBe(false))
    expect(useEditorStore.getState().past).toHaveLength(historyBefore + 1)
  })

  it('saves, rehydrates, and retains mask work across reload and save failures', async () => {
    const repo = renderApp()
    await screen.findByTestId('photo-file-input')
    uploadPhoto()
    await waitFor(() => expect(screen.getAllByAltText('Image').length).toBeGreaterThan(0))

    const imgId = useEditorStore.getState().document!.layers[0]!.id
    const maskBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    useEditorStore.getState().applyMask(imgId, 'mask-abc', maskBlob)

    // Save locally
    fireEvent.click(screen.getByRole('button', { name: /save to my stickers/i }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved locally/i))

    const projectId = useEditorStore.getState().document!.id
    const savedMask = await repo.getMask('mask-abc')
    expect(savedMask.size).toBe(maskBlob.size)

    // Reopen in fresh render
    resetEditorStore()
    cleanup()
    renderApp(`/editor/${projectId}`, repo)

    await waitFor(() => {
      const doc = useEditorStore.getState().document
      const layer = doc?.layers.find((l) => l.id === imgId)
      expect(layer?.kind === 'image' && layer.maskKey).toBe('mask-abc')
      expect(useEditorStore.getState().masks['mask-abc']).toBeDefined()
    })

    // Save failure retains mask edits
    const newMaskBlob = new Blob([new Uint8Array([7, 8, 9])], { type: 'image/png' })
    useEditorStore.getState().applyMask(imgId, 'mask-def', newMaskBlob)
    repo.injectWriteFailure()
    fireEvent.click(screen.getByRole('button', { name: /save to my stickers/i }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/save failed/i))

    // In-memory mask work is preserved!
    const savedLayer = useEditorStore.getState().document?.layers[0]
    expect(savedLayer?.kind === 'image' ? savedLayer.maskKey : undefined).toBe('mask-def')
    expect(useEditorStore.getState().masks['mask-def']).toBe(newMaskBlob)
  })
})
