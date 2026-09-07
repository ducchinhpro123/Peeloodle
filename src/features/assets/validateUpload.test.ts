import { describe, expect, it, vi } from 'vitest'
import { createMemoryRepository, createProjectDocument } from '../../lib/persistence/repository'
import { AssetObjectUrlCache, fitImageToArtboard, ingestImageFile } from './assetLoader'
import { MAX_UPLOAD_BYTES, UploadValidationError, validateUpload } from './validateUpload'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xd9]
const decode16 = async () => ({ width: 16, height: 16 })

function fileFrom(bytes: ArrayLike<number>, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

function webpFile(flags: number, name = 'sticker.webp'): File {
  const bytes = new Uint8Array(30)
  const view = new DataView(bytes.buffer)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
  view.setUint32(4, bytes.length - 8, true)
  bytes.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x58], 12) // VP8X
  view.setUint32(16, 10, true)
  bytes[20] = flags
  return fileFrom(bytes, name, 'image/webp')
}

async function expectUploadCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(UploadValidationError)
  await promise.catch((error: UploadValidationError) => expect(error.code).toBe(code))
}

describe('validateUpload', () => {
  it('rejects SVG, GIF, oversized files, huge dimensions, decode failures, and animated WebP', async () => {
    await expectUploadCode(validateUpload(fileFrom([0x3c, 0x73, 0x76, 0x67], 'icon.svg', 'image/svg+xml'), { decodeImageSize: decode16 }), 'svg_not_allowed')
    await expectUploadCode(
      validateUpload(fileFrom([0x3c, 0x73, 0x76, 0x67, 0x20, 0x2f, 0x3e], 'icon.png', 'image/png'), { decodeImageSize: decode16 }),
      'svg_not_allowed',
    )
    await expectUploadCode(validateUpload(fileFrom([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 'x.gif', 'image/gif'), { decodeImageSize: decode16 }), 'unsupported_type')

    const huge = fileFrom(PNG_MAGIC, 'huge.png', 'image/png')
    Object.defineProperty(huge, 'size', { value: MAX_UPLOAD_BYTES + 1 })
    await expectUploadCode(validateUpload(huge, { decodeImageSize: decode16 }), 'file_too_large')

    await expectUploadCode(
      validateUpload(fileFrom(PNG_MAGIC, 'big.png', 'image/png'), { decodeImageSize: async () => ({ width: 5000, height: 5001 }) }),
      'too_many_pixels',
    )
    await expectUploadCode(
      validateUpload(fileFrom(PNG_MAGIC, 'broken.png', 'image/png'), {
        decodeImageSize: async () => {
          throw new Error('decode exploded')
        },
      }),
      'decode_failed',
    )

    const decode = vi.fn(decode16)
    await expectUploadCode(validateUpload(webpFile(0x02), { decodeImageSize: decode }), 'animated_image')
    expect(decode).not.toHaveBeenCalled()
  })

  it('accepts PNG, JPEG, and static WebP', async () => {
    await expect(validateUpload(fileFrom(PNG_MAGIC, 'a.png', 'image/png'), { decodeImageSize: decode16 })).resolves.toMatchObject({
      mimeType: 'image/png',
      width: 16,
      height: 16,
    })
    await expect(validateUpload(fileFrom(JPEG_MAGIC, 'a.jpg', 'image/jpeg'), { decodeImageSize: decode16 })).resolves.toMatchObject({
      mimeType: 'image/jpeg',
    })
    await expect(validateUpload(webpFile(0x00), { decodeImageSize: decode16 })).resolves.toMatchObject({ mimeType: 'image/webp' })
  })
})

describe('ingestImageFile', () => {
  it('keeps the original blob and does not persist assets or layers on failure', async () => {
    const repo = createMemoryRepository()
    const document = createProjectDocument({ id: 'project-1' })
    await repo.saveProject(document)

    const png = fileFrom(PNG_MAGIC, 'pet.png', 'image/png')
    const record = await ingestImageFile(png, { decodeImageSize: decode16 })
    expect(record.blob).toBe(png)
    expect(record.asset.mimeType).toBe('image/png')
    expect(record.asset.blobKey).toBe(record.asset.id)
    expect(record.asset.provenance).toBe('user-upload:pet.png')

    await expectUploadCode(ingestImageFile(fileFrom([0x00], 'nope.txt', 'text/plain'), { decodeImageSize: decode16 }), 'unsupported_type')
    expect(await repo.listAssets()).toEqual([])
    expect((await repo.getProject('project-1')).layers).toEqual([])
  })
})

describe('asset helpers', () => {
  it('fits images into the 1024 artboard without upscaling', () => {
    expect(fitImageToArtboard(2048, 1024)).toEqual({ x: 0, y: 256, rotation: 0, scaleX: 0.5, scaleY: 0.5 })
    expect(fitImageToArtboard(100, 100)).toEqual({ x: 462, y: 462, rotation: 0, scaleX: 1, scaleY: 1 })
  })

  it('revokes object URLs from the runtime cache', () => {
    const created: string[] = []
    const revoked: string[] = []
    const urlApi = URL as unknown as { createObjectURL: (blob: Blob) => string; revokeObjectURL: (url: string) => void }
    const previousCreate = urlApi.createObjectURL
    const previousRevoke = urlApi.revokeObjectURL
    urlApi.createObjectURL = () => {
      const url = `blob:test-${created.length}`
      created.push(url)
      return url
    }
    urlApi.revokeObjectURL = (url) => {
      revoked.push(String(url))
    }
    try {
      const cache = new AssetObjectUrlCache()
      const blob = new Blob([new Uint8Array([1])])
      expect(cache.urlFor('a', blob)).toBe('blob:test-0')
      expect(cache.urlFor('a', blob)).toBe('blob:test-0')
      cache.revoke('a')
      cache.revokeAll()
      expect(revoked).toEqual(['blob:test-0'])
    } finally {
      urlApi.createObjectURL = previousCreate
      urlApi.revokeObjectURL = previousRevoke
    }
  })
})
