/**
 * The open deck's decoded artwork: the bitmaps the canvas and the slide panel
 * paint. Owned by one editor; replacing it disposes the previous decode.
 */

import type { PresentationRepository } from '../persistence/repository';
import type { PresentationDocument } from '../model/types';
import {
	createDecodedArtwork,
	type ArtworkBytes,
	type DecodedArtwork
} from '../rendering/decodedArtwork';
import type { PresentationImageSources } from '../rendering/renderSlide';

export type EditorArtwork = {
	/** A fresh map after every change, so readers re-render. */
	readonly images: PresentationImageSources;
	/** False until the deck's artwork is decoded (and after disposal). */
	readonly ready: boolean;
	/** Reads and decodes one document's media; the caller adopts or disposes it. */
	decode(document: PresentationDocument): Promise<DecodedArtwork>;
	adopt(decoded: DecodedArtwork): void;
	add(records: ArtworkBytes[]): Promise<void>;
	/** Decodes the stored revision's artwork again (after keeping a conflict copy). */
	reload(presentationId: string): Promise<void>;
	dispose(): void;
};

export function createEditorArtwork(repository: PresentationRepository): EditorArtwork {
	let decoded: DecodedArtwork | null = null;
	let images = $state.raw<PresentationImageSources>(new Map());
	let ready = $state(false);

	const adopt = (next: DecodedArtwork) => {
		decoded?.dispose();
		decoded = next;
		images = new Map(next.images);
		ready = true;
	};
	const decode = async (document: PresentationDocument) => {
		const media = await Promise.all(document.assets.map((asset) => repository.getMedia(asset.id)));
		const next = createDecodedArtwork();
		await next.add(media);
		return next;
	};

	return {
		get images() {
			return images;
		},
		get ready() {
			return ready;
		},
		decode,
		adopt,
		async add(records) {
			if (!decoded) throw new Error('No artwork is open.');
			await decoded.add(records);
			images = new Map(decoded.images);
		},
		async reload(presentationId) {
			adopt(await decode(await repository.getPresentation(presentationId)));
		},
		dispose() {
			decoded?.dispose();
			decoded = null;
			ready = false;
		}
	};
}
