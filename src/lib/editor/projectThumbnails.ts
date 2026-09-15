/**
 * Sticker thumbnails for project cards and pack covers.
 *
 * One 512px composite per saved revision, rendered through the shared
 * `renderDocument` pipeline and cached by `id:revision` in a small LRU. Two
 * cards showing the same saved sticker (a pack cover and its gallery tile, a
 * list re-render) share one render and one object URL. The cache owns the URLs:
 * a caller never revokes one, eviction revokes exactly once, and a failure is
 * not cached so the next visit can try again.
 */

import {
	loadProjectBundle,
	type AssetRecord,
	type StickerLabRepository
} from '../persistence/repository';
import type { ProjectDocument } from '../domain/domain';

/** Rendered thumbnails kept in memory before the least recently used one is dropped. */
export const PROJECT_THUMBNAIL_CACHE_SIZE = 16;

/** Composes one thumbnail blob; the seam tests replace. */
export type ProjectThumbnailRenderer = (
	project: ProjectDocument,
	assets: Record<string, AssetRecord>,
	masks: Record<string, Blob>
) => Promise<Blob>;

export type ProjectThumbnailRequest = {
	repository: StickerLabRepository;
	project: ProjectDocument;
};

type ThumbnailEntry = {
	pending: Promise<string | null>;
	/** Set when the render resolves, so eviction can revoke synchronously. */
	url: string | null;
};

const cache = new Map<string, ThumbnailEntry>();

/** A new revision is a different thumbnail to draw. */
export function projectThumbnailKey(project: ProjectDocument): string {
	return `${project.id}:${project.revision}`;
}

export function acquireProjectThumbnail(
	request: ProjectThumbnailRequest,
	render: ProjectThumbnailRenderer = renderProjectThumbnail
): Promise<string | null> {
	const key = projectThumbnailKey(request.project);
	const cached = cache.get(key);
	if (cached) {
		// Re-inserting moves the entry to the young end of the Map's insertion order.
		cache.delete(key);
		cache.set(key, cached);
		return cached.pending;
	}

	const entry: ThumbnailEntry = { pending: Promise.resolve(null), url: null };
	entry.pending = (async () => {
		const bundle = await loadProjectBundle(request.repository, request.project);
		const blob = await render(
			request.project,
			Object.fromEntries(bundle.assets),
			Object.fromEntries(bundle.masks)
		);
		entry.url = URL.createObjectURL(blob);
		return entry.url;
	})().catch(() => {
		// A failure costs nothing to retry, while a cached null would keep a card on
		// paper for the whole session.
		if (cache.get(key) === entry) cache.delete(key);
		return null;
	});
	cache.set(key, entry);
	trimCache();
	return entry.pending;
}

/**
 * Drops every cached thumbnail and revokes its URL. Tests call this between
 * cases; production keys are per saved revision, so nothing else needs it.
 */
export function resetProjectThumbnails(): void {
	const entries = [...cache.values()];
	cache.clear();
	for (const entry of entries) revoke(entry);
}

async function renderProjectThumbnail(
	project: ProjectDocument,
	assets: Record<string, AssetRecord>,
	masks: Record<string, Blob>
): Promise<Blob> {
	const { renderDocument } = await import('../exports/renderDocument');
	return renderDocument(project, assets, { size: 512, masks, bounds: 'artwork' });
}

function trimCache(): void {
	while (cache.size > PROJECT_THUMBNAIL_CACHE_SIZE) {
		const oldestKey = cache.keys().next().value;
		if (oldestKey === undefined) return;
		const evicted = cache.get(oldestKey);
		cache.delete(oldestKey);
		if (evicted) revoke(evicted);
	}
}

/** Revokes a URL now, or when its render resolves. */
function revoke(entry: ThumbnailEntry): void {
	if (entry.url) {
		URL.revokeObjectURL(entry.url);
		entry.url = null;
		return;
	}
	void entry.pending
		.then((url) => {
			if (url) URL.revokeObjectURL(url);
		})
		.catch(() => {});
}
