import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './main'
import { createMemoryRepository } from './lib/persistence/repository'
import { resetEditorStore, useEditorStore } from './features/editor/store'

class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserver

afterEach(() => {
  cleanup()
  resetEditorStore()
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
    ['/', 'Create Custom'],
    ['/create', 'Untitled Sticker'],
    ['/templates', 'Discover Amazing'],
    ['/my-stickers', 'My Sticker Packs'],
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
    expect(screen.queryByText('Good Vibes Pack')).not.toBeInTheDocument()
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
    const cardTitle = screen.getAllByRole('button', { name: 'Good Vibes Pack' })[0]!
    fireEvent.click(cardTitle)
    const dialog = await screen.findByRole('dialog', { name: 'Good Vibes Pack' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/Circle Accent, Text: GOOD VIBES/i)).toBeInTheDocument()

    const useBtn = within(dialog).getByRole('button', { name: 'Use Template' })
    fireEvent.click(useBtn)

    await waitFor(() => {
      const doc = useEditorStore.getState().document
      expect(doc).not.toBeNull()
      expect(doc?.title).toBe('Good Vibes Pack Copy')
      expect(doc?.layers.length).toBeGreaterThan(0)
    })
    const saved = await repo.listProjects()
    expect(saved).toHaveLength(1)
    expect(saved[0]?.title).toBe('Good Vibes Pack Copy')
  })

  it('toggles template favorites and stores them', () => {
    renderRoute('/templates')
    const favBtn = screen.getAllByRole('button', { name: 'Add Good Vibes Pack to favorites' })[0]!
    expect(favBtn).toHaveTextContent('♡')
    fireEvent.click(favBtn)
    expect(screen.getAllByRole('button', { name: 'Remove Good Vibes Pack from favorites' })[0]).toHaveTextContent('❤️')
  })

  it('opens export options without claiming messenger success', async () => {
    renderRoute('/create')
    fireEvent.click(await screen.findByRole('button', { name: /export and share/i }))
    expect(screen.getByRole('dialog', { name: 'Export sticker' })).toHaveTextContent('not a WhatsApp or Telegram sticker pack')
  })
})
