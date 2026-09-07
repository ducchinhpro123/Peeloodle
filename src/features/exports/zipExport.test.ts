import { describe, expect, it } from 'vitest'
import { createMemoryRepository, createProjectDocument } from '../../lib/persistence/repository'
import type { PackRecord } from '../../types/domain'
import { createZipArchive, exportPackZip, readBlobBytes } from './zipExport'

describe('zipExport', () => {
  it('creates a valid ZIP binary with manifest and files', async () => {
    const encoder = new TextEncoder()
    const zipBlob = createZipArchive([
      { name: 'manifest.json', data: encoder.encode('{"title":"test"}') },
      { name: '01_sticker.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    ])
    expect(zipBlob.type).toBe('application/zip')
    const bytes = await readBlobBytes(zipBlob)
    // Starts with PK zip local header signature 0x04034b50
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    expect(bytes[2]).toBe(0x03)
    expect(bytes[3]).toBe(0x04)
  })

  it('exports a pack as a ZIP containing manifest and rendered sticker images', async () => {
    const repo = createMemoryRepository()
    const p1 = createProjectDocument({ id: 'p1', title: 'Sticker One' })
    await repo.saveProject(p1)

    const pack: PackRecord = {
      id: 'pack-1',
      title: 'Party Pack',
      description: 'Stickers for parties',
      visibility: 'local',
      projectIds: ['p1'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await repo.savePack(pack)

    const mockPng = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
    const zipBlob = await exportPackZip(pack, repo, {
      renderSticker: async () => mockPng,
    })
    expect(zipBlob.type).toBe('application/zip')
    const bytes = await readBlobBytes(zipBlob)
    expect(bytes.length).toBeGreaterThan(100)
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })
})
