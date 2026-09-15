/**
 * Saved sticker snapshots for presentations (P33).
 *
 * A chosen sticker project is composed once through the same `renderDocument`
 * pipeline that produces user PNG exports, and the resulting bytes become an
 * immutable presentation asset. The presentation never references the sticker
 * document, so editing or deleting the sticker later cannot change a placed
 * snapshot, and the sticker itself stays editable.
 */

import { preparePresentationImage, type PreparedPresentationImage } from './insertImageAsset';
import {
	loadProjectBundle,
	type AssetRecord,
	type StickerLabRepository
} from '$lib/persistence/repository';
import type { ProjectDocument } from '$lib/domain/domain';

export type StickerSnapshotRenderer = (
	document: ProjectDocument,
	assets: Map<string, AssetRecord>,
	masks: Map<string, Blob>
) => Promise<Blob>;

const renderStickerArtwork: StickerSnapshotRenderer = async (document, assets, masks) => {
	// The compositor is only needed once a sticker is actually placed, so it loads
	// on demand instead of riding in the editor page's chunk.
	const { renderDocument } = await import('$lib/exports/renderDocument');
	return renderDocument(document, assets, { size: 1024, bounds: 'artwork', masks });
};

/** Loads one saved sticker's document, artwork and masks, then prepares a snapshot. */
export async function prepareStickerSnapshot(
	repository: StickerLabRepository,
	projectId: string,
	render: StickerSnapshotRenderer = renderStickerArtwork
): Promise<PreparedPresentationImage> {
	const document = await repository.getProject(projectId);
	const { assets, masks } = await loadProjectBundle(repository, document);
	const blob = await render(document, assets, masks);
	const name = `${(document.title || 'Sticker').trim().slice(0, 60)}.png`;
	return preparePresentationImage(new File([blob], name, { type: 'image/png' }));
}
