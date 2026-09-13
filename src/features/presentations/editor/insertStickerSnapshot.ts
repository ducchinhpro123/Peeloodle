/**
 * Saved sticker snapshots for presentations (P33).
 *
 * A chosen sticker project is composed once through the same `renderDocument`
 * pipeline that produces user PNG exports, and the resulting bytes become an
 * immutable presentation asset. The presentation never references the sticker
 * document, so editing or deleting the sticker later cannot change a placed
 * snapshot, and the sticker itself stays editable.
 */

import { renderDocument } from '../../exports/renderDocument'
import { preparePresentationImage, type PreparedPresentationImage } from './insertImageAsset'
import type { AssetRecord, StickerLabRepository } from '@/lib/persistence/repository'
import type { ProjectDocument } from '@/types/domain'

export type StickerSnapshotRenderer = (
  document: ProjectDocument,
  assets: Map<string, AssetRecord>,
  masks: Map<string, Blob>,
) => Promise<Blob>

const renderStickerArtwork: StickerSnapshotRenderer = (document, assets, masks) =>
  renderDocument(document, assets, { size: 1024, bounds: 'artwork', masks })

/** Loads one saved sticker's document, artwork and masks, then prepares a snapshot. */
export async function prepareStickerSnapshot(
  repository: StickerLabRepository,
  projectId: string,
  render: StickerSnapshotRenderer = renderStickerArtwork,
): Promise<PreparedPresentationImage> {
  const document = await repository.getProject(projectId)
  const assets = new Map<string, AssetRecord>()
  const masks = new Map<string, Blob>()

  for (const layer of document.layers) {
    if (layer.kind !== 'image') continue
    if (!assets.has(layer.assetId)) assets.set(layer.assetId, await repository.getAsset(layer.assetId))
    if (layer.maskKey && !masks.has(layer.maskKey)) masks.set(layer.maskKey, await repository.getMask(layer.maskKey))
  }

  const blob = await render(document, assets, masks)
  const name = `${(document.title || 'Sticker').trim().slice(0, 60)}.png`
  return preparePresentationImage(new File([blob], name, { type: 'image/png' }))
}
