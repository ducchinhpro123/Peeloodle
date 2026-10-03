/**
 * Pure document helpers for the editor state.
 *
 * These live in a plain module (not a `.svelte.ts` one) because they are ordinary
 * data transformations over a serializable document: no runes, no reactive
 * collections, and they are unit-testable on their own.
 */

import { serializeProjectDocument } from '#lib/persistence/repository.js';
import type { AssetRecord } from '#lib/persistence/repository.js';
import type { Layer, ProjectDocument } from '#lib/domain/domain.js';

export function cloneDocument(document: ProjectDocument): ProjectDocument {
	return serializeProjectDocument(document);
}

export function touch(document: ProjectDocument): ProjectDocument {
	return { ...document, updatedAt: new Date().toISOString(), revision: document.revision + 1 };
}

export function sameContent(a: ProjectDocument, b: ProjectDocument): boolean {
	const left = serializeProjectDocument(a);
	const right = serializeProjectDocument(b);
	return (
		left.title === right.title &&
		JSON.stringify(left.layers) === JSON.stringify(right.layers) &&
		JSON.stringify(left.assetIds) === JSON.stringify(right.assetIds)
	);
}

export function replaceLayer(
	document: ProjectDocument,
	id: string,
	update: (layer: Layer) => Layer
): ProjectDocument {
	return {
		...document,
		layers: document.layers.map((layer) => (layer.id === id ? update(layer) : layer))
	};
}

export function uniqueAssetIds(layers: Layer[]): string[] {
	const ids: string[] = [];
	for (const layer of layers) {
		if (layer.kind === 'image' && !ids.includes(layer.assetId)) ids.push(layer.assetId);
	}
	return ids;
}

export function assetsFor(
	assets: Record<string, AssetRecord>,
	docs: Array<ProjectDocument | null | undefined>
): Record<string, AssetRecord> {
	const ids = new Set<string>();
	for (const doc of docs) {
		if (!doc) continue;
		for (const id of doc.assetIds) ids.add(id);
		for (const layer of doc.layers) {
			if (layer.kind === 'image') ids.add(layer.assetId);
		}
	}
	let dropped = false;
	const next: Record<string, AssetRecord> = {};
	for (const [id, record] of Object.entries(assets)) {
		if (ids.has(id)) next[id] = record;
		else dropped = true;
	}
	return dropped ? next : assets;
}

export function masksFor(
	masks: Record<string, Blob>,
	docs: Array<ProjectDocument | null | undefined>
): Record<string, Blob> {
	const keys = new Set<string>();
	for (const doc of docs) {
		if (!doc) continue;
		for (const layer of doc.layers) {
			if (layer.kind === 'image' && layer.maskKey) keys.add(layer.maskKey);
		}
	}
	let dropped = false;
	const next: Record<string, Blob> = {};
	for (const [key, blob] of Object.entries(masks)) {
		if (keys.has(key)) next[key] = blob;
		else dropped = true;
	}
	return dropped ? next : masks;
}
