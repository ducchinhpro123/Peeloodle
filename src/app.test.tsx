import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as assetLoader from './features/assets/assetLoader'
import { App } from './main'
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

function renderRoute(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App repository={createMemoryRepository()} />
    </MemoryRouter>,
  )
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
    expect(screen.getByRole('dialog', { name: 'Search is not implemented' })).toBeInTheDocument()
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
    expect(screen.getAllByText('Cat Expressions').length).toBeGreaterThan(0)
    expect(screen.queryByText('Good Vibes')).not.toBeInTheDocument()
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
    render(
      <MemoryRouter initialEntries={['/templates']}>
        <App repository={repo} />
      </MemoryRouter>,
    )
    const cardTitle = screen.getAllByRole('button', { name: 'Good Vibes' })[0]!
    fireEvent.click(cardTitle)
    const dialog = await screen.findByRole('dialog', { name: 'Good Vibes' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/Your photo, Heart \/ badge, Sparkles \/ accent, Caption backing, Your caption/i)).toBeInTheDocument()

    const useBtn = within(dialog).getByRole('button', { name: 'Use Template' })
    fireEvent.click(useBtn)

    await waitFor(() => {
      const doc = useEditorStore.getState().document
      expect(doc).not.toBeNull()
      expect(doc?.title).toBe('Good Vibes Copy')
      expect(doc?.layers.length).toBeGreaterThan(0)
    })
    const saved = await repo.listProjects()
    expect(saved).toHaveLength(1)
    expect(saved[0]?.title).toBe('Good Vibes Copy')
  })

  it('keeps a template preview open on save failure and restores focus on dismissal', async () => {
    const repo = createMemoryRepository()
    repo.injectWriteFailure()
    render(<MemoryRouter initialEntries={['/templates']}><App repository={repo} /></MemoryRouter>)
    const opener = screen.getAllByRole('button', { name: 'Good Vibes' })[0]!
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Good Vibes' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use Template' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not save')
    expect(await repo.listProjects()).toHaveLength(0)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('toggles template favorites and stores them', () => {
    renderRoute('/templates')
    const favBtn = screen.getAllByRole('button', { name: 'Add Good Vibes to favorites' })[0]!
    expect(favBtn).toHaveTextContent('♡')
    fireEvent.click(favBtn)
    expect(screen.getAllByRole('button', { name: 'Remove Good Vibes from favorites' })[0]).toHaveTextContent('❤️')
    expect(screen.queryAllByRole('button', { name: 'Add Good Vibes to favorites' })).toHaveLength(0)
  })

  it('shows pack write failures without closing the form or losing its title', async () => {
    const repo = createMemoryRepository()
    repo.injectWriteFailure()
    render(<MemoryRouter initialEntries={['/my-stickers']}><App repository={repo} /></MemoryRouter>)
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

  it('creates, inspects, adds stickers to, duplicates, and deletes a pack', async () => {
    const repo = createMemoryRepository()
    const p1 = createProjectDocument({ id: 'proj-1', title: 'Happy Cat' })
    await repo.saveProject(p1)

    render(
      <MemoryRouter initialEntries={['/my-stickers']}>
        <App repository={repo} />
      </MemoryRouter>,
    )

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
    render(<MemoryRouter initialEntries={['/']}><App repository={repo} /></MemoryRouter>)
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
