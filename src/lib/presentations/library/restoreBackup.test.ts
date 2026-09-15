// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createMemoryPresentationRepository } from '../persistence/repository';
import { createBackupArchive } from '../exports/backup';
import { restoreBackupArchive } from './restoreBackup';
import { createImageElement, createPresentationDocument } from '../model/factories';
import { fixtureImagePng } from '../model/fixtures/fixture';
import type { PresentationDocument } from '../model/types';

async function backupWithImage(): Promise<{ bytes: Uint8Array; source: PresentationDocument }> {
	const source = createPresentationDocument({ id: 'source', title: 'Original deck' });
	source.assets = [
		{
			id: 'asset-1',
			blobKey: 'uploads/asset-1',
			mimeType: 'image/png',
			width: 256,
			height: 256,
			sha256: 'a'.repeat(64),
			byteLength: fixtureImagePng().length,
			provenance: { source: 'upload', label: 'photo.png' }
		}
	];
	source.slides[0]!.elements.push(createImageElement({ assetId: 'asset-1' }));
	source.slides.push({ ...source.slides[0]!, id: 'slide-2', name: 'Second', elements: [] });
	const bytes = await createBackupArchive(source, new Map([['asset-1', fixtureImagePng()]]));
	return { bytes, source };
}

describe('backup restore', () => {
	it('restores a backup as an independent presentation with fresh ids', async () => {
		const { bytes, source } = await backupWithImage();
		const repository = createMemoryPresentationRepository();

		const outcome = await restoreBackupArchive(repository, bytes);

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.document.id).not.toBe(source.id);
		expect(outcome.document.title).toBe('Original deck (restored)');
		expect(outcome.document.slides).toHaveLength(2);
		const asset = outcome.document.assets[0]!;
		expect(asset.id).not.toBe('asset-1');
		expect(asset.sha256).toBe('a'.repeat(64));

		const stored = await repository.getPresentation(outcome.document.id);
		expect(stored.slides).toHaveLength(2);
		expect(Array.from((await repository.getMedia(asset.id)).bytes)).toEqual(
			Array.from(fixtureImagePng())
		);
		expect(await repository.listPresentations()).toHaveLength(1);
	});

	it('rejects a corrupt archive without touching stored work', async () => {
		const repository = createMemoryPresentationRepository();
		await repository.savePresentation(
			createPresentationDocument({ id: 'existing', title: 'Existing' })
		);

		const outcome = await restoreBackupArchive(repository, new Uint8Array([1, 2, 3, 4]));

		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.message.length).toBeGreaterThan(0);
		expect(await repository.listPresentations()).toHaveLength(1);
		expect((await repository.listPresentations())[0]!.id).toBe('existing');
	});
});
