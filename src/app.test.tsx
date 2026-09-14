import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as assetLoader from './features/assets/assetLoader'
import { createAppRoutes } from './app/routes'
import { createMemoryRepository, createProjectDocument } from './lib/persistence/repository'
import { resetEditorStore, useEditorStore } from './features/editor/store'

class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserver

beforeEach(() => {
  vi.spyOn(assetLoader, 'ingestBundledImage').mockImplementation(async (src) => {
    const id = crypto.randomUUID()
    return { asset: { id, blobKey: id, mimeType: 'image/png', width: 344, height: 344, provenance: `bundled-asset:${src}` }, blob: new Blob(['artwork'], { type: 'image/png' }) }
  })
})

afterEach(() => {
  cleanup()
  resetEditorStore()
  vi.restoreAllMocks()
})

function renderAt(path: string, repository = createMemoryRepository()) {
  const router = createMemoryRouter(createAppRoutes({ repository }), { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

function renderRoute(path = '/') {
  return renderAt(path)
}

describe('foundation routes', () => {
  it.each([
    ['/', 'Small stickers'],
    ['/create', 'Untitled Sticker'],
    ['/templates', 'Find your vibe'],
    ['/my-stickers', 'Your little world'],
  ])('renders %s', async (path, heading) => {
    renderRoute(path)
    expect(await screen.findByRole('heading', { name: new RegExp(heading) })).toBeInTheDocument()
  })

  it('shows a recoverable missing-sticker state', async () => {
    renderRoute('/editor/sample-project')
    expect(await screen.findByRole('heading', { name: 'Sticker not found' })).toBeInTheDocument()
  })

  it('uses URL-backed Favorites navigation and ignores non-matching view parameters', async () => {
    renderRoute('/my-stickers')
    fireEvent.click(screen.getByRole('link', { name: 'Favorites' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'No favorite local packs yet' })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Favorites' })).toHaveAttribute('href', '/my-stickers?view=favorites')
    expect(screen.getByRole('link', { name: 'Favorites' })).toHaveClass('active')
    expect(screen.getAllByRole('link', { name: 'My Stickers' }).at(-1)).not.toHaveClass('active')

    cleanup()
    resetEditorStore()
    renderRoute('/my-stickers?view=favorites-other')
    expect(screen.getByRole('heading', { name: 'No local packs yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Favorites' })).not.toHaveClass('active')

    cleanup()
    resetEditorStore()
    renderRoute('/my-stickers?view=shared')
    expect(screen.getByRole('heading', { name: 'Sharing is not available yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Shared with Me' })).toHaveClass('active')
    expect(screen.getAllByRole('link', { name: 'My Stickers' }).at(-1)).not.toHaveClass('active')
  })
})

describe('foundation interactions', () => {
  it('restores focus after Escape closes an unavailable-action dialog', async () => {
    renderRoute('/')
    const opener = screen.getByRole('button', { name: /search templates and packs/i })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Search templates and packs' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it('closes the labelled mobile navigation sheet with its close button and restores focus', async () => {
    renderRoute()
    const opener = screen.getByRole('button', { name: 'Open navigation' })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it('dismisses mobile navigation when selecting a tool on the current route', async () => {
    renderRoute('/create')
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const sheet = screen.getByRole('dialog', { name: 'Navigation' })
    fireEvent.click(within(sheet).getByRole('link', { name: 'Background Eraser' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('filters sample templates and resets the selected filter and search', () => {
    renderRoute('/templates')
    fireEvent.click(screen.getByRole('button', { name: 'Cute Animals' }))
    expect(screen.getAllByText('Pet Bestie').length).toBeGreaterThan(0)
    expect(screen.queryByText('Orbit Pop')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search sample templates' }), { target: { value: 'no-match' } })
    expect(screen.getByRole('heading', { name: 'No sample templates found' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getByRole('textbox', { name: 'Search sample templates' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'All Templates' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('names the font size slider after adding text', async () => {
    renderRoute('/create')
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    expect(await screen.findByRole('slider', { name: 'Font size' })).toBeInTheDocument()
  })

  it('opens a template preview dialog and clones it into an independent editable project', async () => {
    const repo = createMemoryRepository()
    renderAt('/templates', repo)
    const cardTitle = screen.getAllByRole('button', { name: 'Orbit Pop' })[0]!
    fireEvent.click(cardTitle)
    const dialog = await screen.findByRole('dialog', { name: 'Orbit Pop' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/Your photo, Shooting star, Blue fish, Little mint sparkle, Caption backing, Your caption/i)).toBeInTheDocument()

    const useBtn = within(dialog).getByRole('button', { name: 'Use Template' })
    fireEvent.click(useBtn)

    await waitFor(() => {
      const doc = useEditorStore.getState().document
      expect(doc).not.toBeNull()
      expect(doc?.title).toBe('Orbit Pop Copy')
      expect(doc?.layers.length).toBeGreaterThan(0)
    })
    const saved = await repo.listProjects()
    expect(saved).toHaveLength(1)
    expect(saved[0]?.title).toBe('Orbit Pop Copy')
  })

  it('keeps a template preview open on save failure and restores focus on dismissal', async () => {
    const repo = createMemoryRepository()
    repo.injectWriteFailure()
    renderAt('/templates', repo)
    const opener = screen.getAllByRole('button', { name: 'Orbit Pop' })[0]!
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Orbit Pop' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use Template' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not save')
    expect(await repo.listProjects()).toHaveLength(0)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('toggles template favorites and stores them', () => {
    renderRoute('/templates')
    const favBtn = screen.getAllByRole('button', { name: 'Add Orbit Pop to favorites' })[0]!
    expect(favBtn).toHaveTextContent('♡')
    fireEvent.click(favBtn)
    expect(screen.getAllByRole('button', { name: 'Remove Orbit Pop from favorites' })[0]).toHaveTextContent('❤️')
    expect(screen.queryAllByRole('button', { name: 'Add Orbit Pop to favorites' })).toHaveLength(0)
  })

  it('shows pack write failures without closing the form or losing its title', async () => {
    const repo = createMemoryRepository()
    repo.injectWriteFailure()
    renderAt('/my-stickers', repo)
    fireEvent.click(screen.getByRole('button', { name: 'New Pack' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create New Pack' })
    fireEvent.change(within(dialog).getByLabelText('Pack Name'), { target: { value: 'Keep my title' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Pack' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Save failed')
    expect(within(dialog).getByLabelText('Pack Name')).toHaveValue('Keep my title')
    expect(await repo.listPacks()).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Pack' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await repo.listPacks()).toHaveLength(1)
  })

  it('searches pack titles and descriptions, sorts by name, and clears no results', async () => {
    const repo = createMemoryRepository()
    await repo.savePack({
      id: 'beta-pack',
      title: 'Beta Cats',
      description: 'Sleepy afternoon friends',
      visibility: 'local',
      projectIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    })
    await repo.savePack({
      id: 'alpha-pack',
      title: 'Alpha Days',
      description: 'Sunny little reactions',
      visibility: 'local',
      projectIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    renderAt('/my-stickers', repo)

    expect(await screen.findByRole('button', { name: /Beta Cats/ })).toBeInTheDocument()
    const search = screen.getByRole('searchbox', { name: 'Search packs' })
    fireEvent.change(search, { target: { value: 'sunny little' } })
    expect(screen.getByRole('button', { name: /Alpha Days/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Beta Cats/ })).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort packs' }), { target: { value: 'name' } })
    expect([...document.querySelectorAll('.pack-card-title b')].map((node) => node.textContent)).toEqual(['Alpha Days', 'Beta Cats'])

    fireEvent.change(search, { target: { value: 'nowhere' } })
    expect(screen.getByRole('heading', { name: 'No packs found' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search).toHaveValue('')
    expect(screen.getByRole('button', { name: /Beta Cats/ })).toBeInTheDocument()
  })

  it('creates, inspects, adds stickers to, duplicates, and deletes a pack', async () => {
    const repo = createMemoryRepository()
    const p1 = createProjectDocument({ id: 'proj-1', title: 'Happy Cat' })
    await repo.saveProject(p1)

    renderAt('/my-stickers', repo)

    expect(await screen.findByRole('heading', { name: 'No local packs yet' })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: /new pack/i })[0]!)
    const dialog = await screen.findByRole('dialog', { name: 'Create New Pack' })
    fireEvent.change(within(dialog).getByLabelText('Pack Name'), { target: { value: 'My Cats' } })
    fireEvent.change(within(dialog).getByLabelText('Description (optional)'), { target: { value: 'Cats stickers' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Pack' }))

    await waitFor(async () => {
      const packs = await repo.listPacks()
      expect(packs).toHaveLength(1)
      expect(packs[0]?.title).toBe('My Cats')
    })
    expect(await screen.findByRole('heading', { name: 'My Cats' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /add stickers/i }))
    const addDialog = await screen.findByRole('dialog', { name: /add stickers to my cats/i })
    const checkbox = within(addDialog).getByRole('checkbox')
    fireEvent.click(checkbox)
    fireEvent.click(within(addDialog).getByRole('button', { name: 'Close dialog' }))

    await waitFor(async () => {
      const packs = await repo.listPacks()
      expect(packs[0]?.projectIds).toContain('proj-1')
    })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Duplicate' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    await waitFor(async () => {
      const packs = await repo.listPacks()
      expect(packs).toHaveLength(2)
      expect(packs.some((p) => p.title === 'My Cats Copy')).toBe(true)
    })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const deleteDialog = screen.getByRole('dialog', { name: 'Delete this pack?' })
    expect(within(deleteDialog).getByRole('button', { name: 'Keep Pack' })).toHaveFocus()
    expect(await repo.listPacks()).toHaveLength(2)
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Keep Pack' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete this pack?' })).getByRole('button', { name: 'Delete Pack' }))
    await waitFor(async () => {
      const packs = await repo.listPacks()
      expect(packs).toHaveLength(1)
    })
    expect(await repo.listProjects()).toHaveLength(1)
  })

  it('lists recent stickers, previews them, and deletes with confirmation', async () => {
    const repo = createMemoryRepository()
    await repo.saveProject(createProjectDocument({ id: 'sticker-1', title: 'Happy Cat' }))
    renderAt('/', repo)
    expect(await screen.findByRole('link', { name: /Happy Cat/ })).toHaveAttribute('href', '/editor/sticker-1')
    expect(within(screen.getByRole('heading', { name: /Recent Projects/ }).parentElement!).getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/my-stickers#local-stickers')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Happy Cat' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this sticker?' })
    expect(within(dialog).getByRole('button', { name: 'Keep sticker' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete sticker' }))
    await waitFor(() => expect(screen.queryByRole('link', { name: /Happy Cat/ })).not.toBeInTheDocument())
    expect(await repo.listProjects()).toHaveLength(0)
  })

  it('opens export options without claiming messenger success', async () => {
    renderRoute('/create')
    fireEvent.click(await screen.findByRole('button', { name: /export and share/i }))
    expect(screen.getByRole('dialog', { name: 'Export sticker' })).toHaveTextContent('not a WhatsApp or Telegram sticker pack')
  })
})

describe('tool intent entry', () => {
  it('points sidebar, dashboard, and mobile tool links at typed intents instead of bare /create', () => {
    renderRoute('/')
    for (const [name, href] of [
      ['Background Eraser', '/create?tool=erase'],
      ['Text & Emoji', '/create?tool=text'],
      ['Filters & Effects', '/create?tool=effects'],
    ] as const) {
      const links = screen.getAllByRole('link', { name })
      expect(links.length).toBeGreaterThan(0)
      expect(links.every((link) => link.getAttribute('href') === href)).toBe(true)
    }
    expect(screen.getByRole('link', { name: 'Export & Share' })).toHaveAttribute('href', '/create?tool=export')
    expect(screen.getByRole('link', { name: /Share & Export/ })).toHaveAttribute('href', '/create?tool=export')
    expect(screen.getAllByRole('link', { name: 'Create a Sticker' })[0]).toHaveAttribute('href', '/create')
  })

  it('activates Background Eraser from the tool query without claiming success or inserting layers', async () => {
    renderRoute('/create?tool=erase')
    expect(await screen.findByRole('button', { name: 'Background Eraser', pressed: true })).toBeInTheDocument()
    expect(useEditorStore.getState().activeTool).toBe('erase')
    expect(useEditorStore.getState().document?.layers).toEqual([])
    expect(screen.getByRole('heading', { name: /upload a photo to erase the background/i })).toBeInTheDocument()
    expect(screen.queryByText(/removed automatically|success/i)).not.toBeInTheDocument()
  })

  it('opens Text & Emoji controls without inserting a text layer', async () => {
    renderRoute('/create?tool=text')
    expect(await screen.findByRole('button', { name: 'Text', pressed: true })).toBeInTheDocument()
    expect(useEditorStore.getState().activeTool).toBe('text')
    expect(useEditorStore.getState().document?.layers).toEqual([])
    expect(screen.getByRole('tab', { name: 'Stickers', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /add words or a sticker/i })).toBeInTheDocument()
  })

  it('opens Filters & Effects for a compatible layer and stays honest when none exists', async () => {
    renderRoute('/create?tool=effects')
    expect(await screen.findByRole('tab', { name: 'Effects', selected: true })).toBeInTheDocument()
    expect(screen.getByText(/no effect has been applied yet/i)).toBeInTheDocument()
    expect(useEditorStore.getState().document?.layers).toEqual([])
  })

  it('opens Export & Share for the intended document without claiming messenger success', async () => {
    renderRoute('/create?tool=export')
    const dialog = await screen.findByRole('dialog', { name: 'Export sticker' })
    expect(dialog).toHaveTextContent('not a WhatsApp or Telegram sticker pack')
    expect(useEditorStore.getState().document?.layers).toEqual([])
  })

  it('reopens export when Export & Share is chosen again on the same document', async () => {
    renderRoute('/create?tool=export')
    expect(await screen.findByRole('dialog', { name: 'Export sticker' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Export sticker' })).not.toBeInTheDocument())
    fireEvent.click(screen.getAllByRole('link', { name: 'Export & Share' })[0]!)
    expect(await screen.findByRole('dialog', { name: 'Export sticker' })).toBeInTheDocument()
  })

  it('reactivates Text & Emoji after the erase tool was chosen on the same route', async () => {
    renderRoute('/create?tool=text')
    expect(await screen.findByRole('button', { name: 'Text', pressed: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Background Eraser' }))
    await waitFor(() => expect(useEditorStore.getState().activeTool).toBe('erase'))
    fireEvent.click(screen.getAllByRole('link', { name: 'Text & Emoji' })[0]!)
    await waitFor(() => expect(useEditorStore.getState().activeTool).toBe('text'))
    expect(useEditorStore.getState().document?.layers).toEqual([])
  })

  it('does not re-apply a tool shortcut on Ctrl or Cmd click', async () => {
    renderRoute('/create?tool=text')
    expect(await screen.findByRole('button', { name: 'Text', pressed: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Background Eraser' }))
    await waitFor(() => expect(useEditorStore.getState().activeTool).toBe('erase'))
    const shortcut = screen.getAllByRole('link', { name: 'Text & Emoji' })[0]!
    fireEvent.click(shortcut, { ctrlKey: true })
    expect(useEditorStore.getState().activeTool).toBe('erase')
    fireEvent.click(shortcut, { metaKey: true })
    expect(useEditorStore.getState().activeTool).toBe('erase')
    fireEvent.click(shortcut, { button: 1 })
    expect(useEditorStore.getState().activeTool).toBe('erase')
  })

  it('keeps an open sticker when a tool is chosen instead of minting a blank', async () => {
    renderRoute('/create')
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    const id = useEditorStore.getState().document?.id
    expect(id).toBeTruthy()
    expect(useEditorStore.getState().document?.layers).toHaveLength(1)
    fireEvent.click(screen.getAllByRole('link', { name: 'Background Eraser' })[0]!)
    await waitFor(() => expect(useEditorStore.getState().activeTool).toBe('erase'))
    expect(useEditorStore.getState().document?.id).toBe(id)
    expect(useEditorStore.getState().document?.layers.filter((layer) => layer.kind === 'text')).toHaveLength(1)
  })

  it('offers create or reopen when a tool needs a document and stickers already exist', async () => {
    const repo = createMemoryRepository()
    await repo.saveProject(createProjectDocument({ id: 'keep-me', title: 'Saved Cat' }))
    renderAt('/create?tool=erase', repo)
    expect(await screen.findByTestId('tool-document-choice')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Background Eraser' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create new sticker' })).toBeInTheDocument()
    expect(await repo.listProjects()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Open Saved Cat' }))
    await waitFor(() => expect(useEditorStore.getState().document?.id).toBe('keep-me'))
    expect(useEditorStore.getState().activeTool).toBe('erase')
    expect(screen.queryByText(/success/i)).not.toBeInTheDocument()
  })

  it('does not duplicate text when reopening a saved sticker with the text tool', async () => {
    const repo = createMemoryRepository()
    renderAt('/create?tool=text', repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    expect(useEditorStore.getState().document?.layers.filter((layer) => layer.kind === 'text')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /save to my stickers/i }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved locally/i))
    const id = useEditorStore.getState().document?.id
    if (!id) throw new Error('missing project id')
    cleanup()
    resetEditorStore()
    renderAt(`/editor/${id}?tool=text`, repo)
    await waitFor(() => {
      const layers = useEditorStore.getState().document?.layers.filter((layer) => layer.kind === 'text') ?? []
      expect(layers).toHaveLength(1)
    })
    expect(useEditorStore.getState().activeTool).toBe('text')
  })

  it('filters the sticker palette from Text & Emoji without adding a layer', async () => {
    renderRoute('/create?tool=text')
    expect(await screen.findByRole('tab', { name: 'Stickers', selected: true })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search stickers and decorations' }), { target: { value: 'no-such-sticker-xyz' } })
    expect(screen.getByText(/no stickers match that search/i)).toBeInTheDocument()
    expect(useEditorStore.getState().document?.layers).toEqual([])
  })

  it('still mints a blank document for Create a Sticker when saved stickers exist', async () => {
    const repo = createMemoryRepository()
    await repo.saveProject(createProjectDocument({ id: 'keep-me', title: 'Saved Cat' }))
    renderAt('/create', repo)
    expect(await screen.findByRole('heading', { name: /untitled sticker/i })).toBeInTheDocument()
    expect(screen.queryByTestId('tool-document-choice')).not.toBeInTheDocument()
    expect(useEditorStore.getState().document?.id).not.toBe('keep-me')
  })
})
