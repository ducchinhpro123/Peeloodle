import { describe, expect, it } from 'vitest'
import { createMemoryRepository, createProjectDocument } from '../../lib/persistence/repository'
import type { PackRecord } from '../../types/domain'
import { createZipArchive, exportPackZip } from './zipExport'
import { blobBytes } from '@/lib/blob'

describe('zipExport', () => {
  it('fails the whole export instead of silently dropping an unavailable sticker', async () => {
    const repo = createMemoryRepository()
    const pack: PackRecord = { id: 'pack', title: 'Pack', description: '', visibility: 'local', projectIds: ['missing'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    await expect(exportPackZip(pack, repo)).rejects.toThrow(/missing/)
    await repo.saveProject(createProjectDocument({ id: 'missing' }))
    await expect(exportPackZip(pack, repo, { renderSticker: async () => { throw new Error('decode failed') } })).rejects.toThrow(/decode failed/)
  })

  it('preserves membership order in ZIP entries and the manifest', async () => {
    const repo = createMemoryRepository()
    for (const id of ['first', 'second']) await repo.saveProject(createProjectDocument({ id, title: id }))
    const pack: PackRecord = { id: 'pack', title: 'Pack', description: '', visibility: 'local', projectIds: ['second', 'first'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    const bytes = await blobBytes(await exportPackZip(pack, repo, {
      renderSticker: async (project) => new Blob([project.id], { type: 'image/png' }),
    }))
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entries: Array<{ name: string; body: string }> = []
    let offset = 0
    while (view.getUint32(offset, true) === 0x04034b50) {
      expect(view.getUint16(offset + 6, true) & 0x0800).toBe(0x0800)
      const size = view.getUint32(offset + 18, true)
      const nameSize = view.getUint16(offset + 26, true)
      const bodyStart = offset + 30 + nameSize + view.getUint16(offset + 28, true)
      entries.push({ name: new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameSize)), body: new TextDecoder().decode(bytes.slice(bodyStart, bodyStart + size)) })
      offset = bodyStart + size
    }
    expect(entries.map((entry) => entry.name)).toEqual(['manifest.json', '01_second.png', '02_first.png'])
    expect(JSON.parse(entries[0]!.body).stickers).toEqual([
      { index: 1, filename: '01_second.png', title: 'second' },
      { index: 2, filename: '02_first.png', title: 'first' },
    ])
    expect(entries.slice(1).map((entry) => entry.body)).toEqual(['second', 'first'])
  })

  it('creates a valid ZIP binary with manifest and files', async () => {
    const encoder = new TextEncoder()
    const zipBlob = createZipArchive([
      { name: 'manifest.json', data: encoder.encode('{"title":"test"}') },
      { name: '01_sticker.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    ])
    expect(zipBlob.type).toBe('application/zip')
    const bytes = await blobBytes(zipBlob)
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
    const bytes = await blobBytes(zipBlob)
    expect(bytes.length).toBeGreaterThan(100)
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })
})
