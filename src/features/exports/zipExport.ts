import type { PackRecord, ProjectDocument } from '../../types/domain'
import type { AssetRecord, StickerLabRepository } from '../../lib/persistence/repository'
import { renderDocument } from './renderDocument'

export type ZipFileEntry = {
  name: string
  data: Uint8Array
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    c ^= bytes[i]!
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (-(c & 1) & 0xedb88320)
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

/** Pure-JS ZIP writer without external dependencies (STORE / uncompressed, ideal for PNGs). */
export function createZipArchive(files: ZipFileEntry[]): Blob {
  const encoder = new TextEncoder()
  const localHeaders: Uint8Array[] = []
  const cdEntries: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const dataBytes = file.data
    const crc = crc32(dataBytes)

    // Local file header (30 bytes + name)
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer, local.byteOffset, local.byteLength)
    lv.setUint32(0, 0x04034b50, true) // Local header signature
    lv.setUint16(4, 20, true)         // Version needed: 2.0
    lv.setUint16(6, 0x0800, true)          // General purpose bit flag
    lv.setUint16(8, 0, true)          // Compression method: STORE
    lv.setUint16(10, 0, true)         // File mod time
    lv.setUint16(12, 0, true)         // File mod date
    lv.setUint32(14, crc, true)       // CRC-32
    lv.setUint32(18, dataBytes.length, true) // Compressed size
    lv.setUint32(22, dataBytes.length, true) // Uncompressed size
    lv.setUint16(26, nameBytes.length, true) // File name length
    lv.setUint16(28, 0, true)         // Extra field length
    local.set(nameBytes, 30)

    localHeaders.push(local, dataBytes)

    // Central directory header (46 bytes + name)
    const cd = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength)
    cv.setUint32(0, 0x02014b50, true) // Central directory signature
    cv.setUint16(4, 20, true)         // Version made by: 2.0
    cv.setUint16(6, 20, true)         // Version needed: 2.0
    cv.setUint16(8, 0x0800, true)          // Flags
    cv.setUint16(10, 0, true)         // Method: STORE
    cv.setUint16(12, 0, true)         // Time
    cv.setUint16(14, 0, true)         // Date
    cv.setUint32(16, crc, true)       // CRC-32
    cv.setUint32(20, dataBytes.length, true) // Compressed size
    cv.setUint32(24, dataBytes.length, true) // Uncompressed size
    cv.setUint16(28, nameBytes.length, true) // Name length
    cv.setUint16(30, 0, true)         // Extra length
    cv.setUint16(32, 0, true)         // Comment length
    cv.setUint16(34, 0, true)         // Disk number
    cv.setUint16(36, 0, true)         // Internal file attrs
    cv.setUint32(38, 0, true)         // External file attrs
    cv.setUint32(42, offset, true)    // Relative offset of local header
    cd.set(nameBytes, 46)

    cdEntries.push(cd)
    offset += local.length + dataBytes.length
  }

  const cdOffset = offset
  let cdSize = 0
  for (const entry of cdEntries) cdSize += entry.length

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength)
  ev.setUint32(0, 0x06054b50, true) // EOCD signature
  ev.setUint16(4, 0, true)          // Disk number
  ev.setUint16(6, 0, true)          // Disk with CD start
  ev.setUint16(8, files.length, true)  // Total entries on disk
  ev.setUint16(10, files.length, true) // Total entries
  ev.setUint32(12, cdSize, true)    // Size of central directory
  ev.setUint32(16, cdOffset, true)  // Offset of CD
  ev.setUint16(20, 0, true)         // Comment length

  const allParts: BlobPart[] = [...localHeaders, ...cdEntries, eocd]
  return new Blob(allParts, { type: 'application/zip' })
}

export function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then((buf) => new Uint8Array(buf))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'))
    reader.readAsArrayBuffer(blob)
  })
}

export type ExportPackZipOptions = {
  renderSticker?: (project: ProjectDocument, records: Record<string, AssetRecord>) => Promise<Blob>
}

export async function exportPackZip(
  pack: PackRecord,
  repo: StickerLabRepository,
  options: ExportPackZipOptions = {},
): Promise<Blob> {
  const encoder = new TextEncoder()
  const files: ZipFileEntry[] = []
  const manifestItems: Array<{ index: number; filename: string; title: string }> = []
  const render = options.renderSticker ?? ((project, records) => renderDocument(project, records, { size: 512 }))

  let index = 1
  for (const projectId of pack.projectIds) {
    try {
      const project = await repo.getProject(projectId)
      const records = await Promise.all(project.assetIds.map((id) => repo.getAsset(id)))
      const assetMap: Record<string, AssetRecord> = {}
      for (const r of records) assetMap[r.asset.id] = r
      const pngBlob = await render(project, assetMap)
      const bytes = await readBlobBytes(pngBlob)
      const safeTitle = project.title.replace(/[^\w.-]+/g, '_').toLowerCase() || 'sticker'
      const filename = `${String(index).padStart(2, '0')}_${safeTitle}.png`
      files.push({ name: filename, data: bytes })
      manifestItems.push({ index, filename, title: project.title })
      index += 1
    } catch (error) {
      throw new Error(`Could not export sticker ${projectId}: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  const manifest = {
    title: pack.title,
    description: pack.description,
    version: 1,
    count: manifestItems.length,
    stickers: manifestItems,
  }
  files.unshift({
    name: 'manifest.json',
    data: encoder.encode(JSON.stringify(manifest, null, 2)),
  })

  return createZipArchive(files)
}
