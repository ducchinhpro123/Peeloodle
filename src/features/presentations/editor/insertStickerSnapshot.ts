/**
 * Saved sticker snapshots for presentations (P33).
 *
 * A chosen sticker project is composed once through the same `renderDocument`
 * pipeline that produces user PNG exports, and the resulting bytes become an
 * immutable presentation asset. The presentation never references the sticker
 * document, so editing or deleting the sticker later cannot change a placed
 * snapshot, and the sticker itself stays editable.
 */

import { preparePresentationImage, type PreparedPresentationImage } from './insertImageAsset'
import type { AssetRecord, StickerLabRepository } from '@/lib/persistence/repository'
import type { ProjectDocument } from '@/types/domain'

export type StickerSnapshotRenderer = (
  document: ProjectDocument,
  assets: Map<string, AssetRecord>,
  masks: Map<string, Blob>,
) => Promise<Blob>

const renderStickerArtwork: StickerSnapshotRenderer = async (document, assets, masks) => {
  // The compositor is only needed once a sticker is actually placed, so it loads
  // on demand instead of riding in the editor page's chunk.
  const { renderDocument } = await import('../../exports/renderDocument')
  return renderDocument(document, assets, { size: 1024, bounds: 'artwork', masks })
}

/** Loads one saved sticker's document, artwork and masks, then prepares a snapshot. */
export async function prepareStickerSnapshot(
  repository: StickerLabRepository,
  projectId: string,
  render: StickerSnapshotRenderer = renderStickerArtwork,
): Promise<PreparedPresentationImage> {
  const document = await repository.getProject(projectId)

  // Distinct assets and masks first, so each is fetched once, and all fetches run
  // concurrently: a sticker with several layers should wait for one round trip.
  const assetIds = new Set<string>()
  const maskKeys = new Set<string>()
  for (const layer of document.layers) {
    if (layer.kind !== 'image') continue
    assetIds.add(layer.assetId)
    if (layer.maskKey) maskKeys.add(layer.maskKey)
  }

  const [assetEntries, maskEntries] = await Promise.all([
    Promise.all([...assetIds].map(async (id) => [id, await repository.getAsset(id)] as const)),
    Promise.all([...maskKeys].map(async (key) => [key, await repository.getMask(key)] as const)),
  ])
  const assets = new Map(assetEntries)
  const masks = new Map(maskEntries)

  const blob = await render(document, assets, masks)
  const name = `${(document.title || 'Sticker').trim().slice(0, 60)}.png`
  return preparePresentationImage(new File([blob], name, { type: 'image/png' }))
}
