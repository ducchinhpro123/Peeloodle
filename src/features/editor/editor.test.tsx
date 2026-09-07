import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../../main'
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
  render(
    <MemoryRouter initialEntries={[path]}>
      <App repository={repo} />
    </MemoryRouter>,
  )
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
    await screen.findByRole('heading', { name: /create custom/i })
    fireEvent.click(screen.getByRole('link', { name: /untitled sticker/i }))
    await waitFor(() => expect(screen.getAllByText('Hello sticker').length).toBeGreaterThan(0))
    expect(screen.getAllByAltText('Image').length).toBeGreaterThan(0)
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
    render(
      <MemoryRouter initialEntries={[`/editor/${id}`]}>
        <App repository={repo} />
      </MemoryRouter>,
    )
    await waitFor(() => {
      const text = useEditorStore.getState().document?.layers.find((layer) => layer.kind === 'text')
      expect(text && text.kind === 'text' ? text.fontFamily : undefined).toBe('Georgia')
    })
    expect(screen.getAllByAltText('Image').length).toBeGreaterThan(0)
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
    await screen.findByRole('heading', { name: /create custom/i })
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(useEditorStore.getState().document?.id).not.toBe('stale-load')
  })
})
