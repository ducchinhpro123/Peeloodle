import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	MemoryPresentationRepository,
	type PresentationMediaRecord,
	type SavePresentationOptions
} from '../persistence/repository';
import type { PresentationDocument } from '../model/types';
import { createPresentationDocument, createTextElement } from '../model/factories';
import { FIXTURE_IMAGE_SHA256, fixtureImagePng } from '../model/fixtures/fixture';
import type { PreparedPresentationImage } from './insertImageAsset';
import { createPresentationStore } from './store.svelte';
import { AUTOSAVE_DELAY_MS, createPresentationSaving } from './presentationSaving';

type Write = { revision: number; baseRevision: number | undefined; assetIds: string[] };

class RecordingRepository extends MemoryPresentationRepository {
	readonly writes: Write[] = [];

	override async savePresentation(
		document: PresentationDocument,
		media: PresentationMediaRecord[] = [],
		options: SavePresentationOptions = {}
	): Promise<void> {
		this.writes.push({
			revision: document.revision,
			baseRevision: options.baseRevision,
			assetIds: media.map((record) => record.assetId)
		});
		return super.savePresentation(document, media, options);
	}
}

const PRESENTATION_ID = 'saving-deck';
const presentationStore = createPresentationStore();

function preparedImage(id: string): PreparedPresentationImage {
	const bytes = fixtureImagePng();
	return {
		asset: {
			id,
			blobKey: `uploads/${id}`,
			mimeType: 'image/png',
			width: 256,
			height: 256,
			sha256: FIXTURE_IMAGE_SHA256,
			byteLength: bytes.length,
			provenance: { source: 'upload', label: `${id}.png` }
		},
		media: { assetId: id, bytes, mimeType: 'image/png' }
	};
}

async function open(repository: RecordingRepository) {
	const document = createPresentationDocument({ id: PRESENTATION_ID, title: 'Saving' });
	await repository.savePresentation(document);
	repository.writes.length = 0;
	presentationStore.getState().loadDocument(await repository.getPresentation(PRESENTATION_ID), {
		saved: true
	});
	return createPresentationSaving({
		repository,
		documentId: PRESENTATION_ID,
		flushText: () => {},
		store: presentationStore
	});
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
	presentationStore.getState().closeDocument();
	vi.useRealTimers();
});

describe('presentation saving coordinator', () => {
	it('autosaves a completed command with the last persisted revision as its base', async () => {
		const repository = new RecordingRepository();
		const saving = await open(repository);
		const lifecycle = saving.attachAutosave();
		presentationStore
			.getState()
			.renameSlide(presentationStore.getState().document!.slides[0]!.id, 'Renamed');

		await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

		expect(repository.writes).toEqual([{ revision: 1, baseRevision: 0, assetIds: [] }]);
		expect(saving.getStatus()).toEqual({ status: 'saved', message: null });
		expect(presentationStore.getState().dirty).toBe(false);
		lifecycle.detach();
	});

	it('holds autosave while a command history group is open', async () => {
		const repository = new RecordingRepository();
		const saving = await open(repository);
		const lifecycle = saving.attachAutosave();
		const slideId = presentationStore.getState().document!.slides[0]!.id;
		presentationStore.getState().setSlideBackground(slideId, '#abcdef', {
			historyGroup: 'background'
		});

		await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
		expect(repository.writes).toHaveLength(0);

		presentationStore.getState().endHistoryGroup();
		await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
		expect(repository.writes).toHaveLength(1);
		lifecycle.detach();
	});

	it('keeps failed work dirty and allows an explicit retry', async () => {
		const repository = new RecordingRepository();
		const saving = await open(repository);
		const slideId = presentationStore.getState().document!.slides[0]!.id;
		presentationStore.getState().renameSlide(slideId, 'Kept locally');
		repository.injectWriteFailure();

		expect(await saving.save()).toBe('failed');
		expect(saving.getStatus().message).toMatch(/still here and stay editable/i);
		expect(presentationStore.getState().dirty).toBe(true);

		expect(await saving.save()).toBe('saved');
		expect((await repository.getPresentation(PRESENTATION_ID)).slides[0]!.name).toBe(
			'Kept locally'
		);
	});

	it('reports a revision conflict without overwriting newer stored work', async () => {
		const repository = new RecordingRepository();
		const saving = await open(repository);
		const newer = await repository.getPresentation(PRESENTATION_ID);
		newer.revision = 7;
		newer.slides[0]!.name = 'Other tab';
		await repository.savePresentation(newer);
		repository.writes.length = 0;
		presentationStore
			.getState()
			.renameSlide(presentationStore.getState().document!.slides[0]!.id, 'Local work');

		expect(await saving.save()).toBe('conflict');
		expect(saving.getStatus().status).toBe('conflict');
		expect(presentationStore.getState().dirty).toBe(true);
		expect((await repository.getPresentation(PRESENTATION_ID)).slides[0]!.name).toBe('Other tab');
	});

	it('persists an image and its media atomically before adopting it', async () => {
		const repository = new RecordingRepository();
		const saving = await open(repository);
		const outcome = await saving.persistInsert(preparedImage('asset-insert'));

		expect(outcome.ok).toBe(true);
		expect(repository.writes[0]).toMatchObject({ baseRevision: 0, assetIds: ['asset-insert'] });
		expect(await repository.hasMedia('asset-insert')).toBe(true);
		expect(presentationStore.getState().dirty).toBe(false);
	});

	it('leaves no document or media mutation when an atomic insert fails', async () => {
		const repository = new RecordingRepository();
		const saving = await open(repository);
		const before = presentationStore.getState().document;
		repository.injectWriteFailure();

		const outcome = await saving.persistInsert(preparedImage('asset-failed'));

		expect(outcome).toMatchObject({ ok: false, reason: 'failed' });
		expect(presentationStore.getState().document).toBe(before);
		expect(await repository.hasMedia('asset-failed')).toBe(false);
	});

	it('writes pending work before allowing the route to leave', async () => {
		const repository = new RecordingRepository();
		const saving = await open(repository);
		presentationStore
			.getState()
			.renameSlide(presentationStore.getState().document!.slides[0]!.id, 'Before leaving');

		expect(await saving.saveBeforeLeave()).toBe(true);
		expect((await repository.getPresentation(PRESENTATION_ID)).slides[0]!.name).toBe(
			'Before leaving'
		);
	});

	it('keeps local work as an independent copy after a conflict', async () => {
		const repository = new RecordingRepository();
		const saving = await open(repository);
		const localSlideId = presentationStore.getState().document!.slides[0]!.id;
		presentationStore.getState().renameSlide(localSlideId, 'My local work');
		const newer = await repository.getPresentation(PRESENTATION_ID);
		newer.revision = 4;
		newer.slides[0]!.name = 'Newer work';
		await repository.savePresentation(newer);

		const outcome = await saving.keepMineAsCopy();

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		const copy = await repository.getPresentation(outcome.copyId);
		expect(copy.title).toContain('conflict copy');
		expect(copy.slides[0]!.name).toBe('My local work');
		expect(copy.slides[0]!.id).not.toBe(localSlideId);
		expect(presentationStore.getState().document!.slides[0]!.name).toBe('Newer work');
	});

	it('persists template slides and their media atomically before adopting them', async () => {
		const repository = new RecordingRepository();
		const saving = await open(repository);
		const source = presentationStore.getState().document!;
		const incoming = {
			...structuredClone(source.slides[0]!),
			id: 'template-slide',
			name: 'Agenda'
		};
		const asset = preparedImage('asset-template');
		const outcome = await saving.persistSlides({
			slides: [incoming],
			assets: [asset.asset],
			media: [asset.media]
		});
		expect(outcome.ok).toBe(true);
		expect(repository.writes).toEqual([
			{ revision: 1, baseRevision: 0, assetIds: ['asset-template'] }
		]);
		expect(presentationStore.getState().document!.slides).toHaveLength(2);
		expect(presentationStore.getState().view.activeSlideId).toBe('template-slide');
		expect(presentationStore.getState().dirty).toBe(false);

		// One undo entry removes both the slide and its asset reference.
		presentationStore.getState().undo();
		expect(presentationStore.getState().document!.slides).toHaveLength(1);
	});

	it('leaves the deck untouched when a slide insertion write fails', async () => {
		const repository = new RecordingRepository();
		const saving = await open(repository);
		repository.injectWriteFailure();
		const source = presentationStore.getState().document!;
		const before = JSON.stringify(source);
		const incoming = {
			...structuredClone(source.slides[0]!),
			id: 'template-slide',
			name: 'Agenda'
		};
		const outcome = await saving.persistSlides({
			slides: [incoming],
			assets: [],
			media: []
		});
		expect(outcome).toMatchObject({ ok: false, reason: 'failed' });
		expect(JSON.stringify(presentationStore.getState().document)).toBe(before);
	});

	it('persists an auto-grown height and reloads it cleanly', async () => {
		const repository = new RecordingRepository();
		const saving = await open(repository);
		const document = structuredClone(presentationStore.getState().document!);
		const text = createTextElement({
			id: 'grow',
			autoGrow: true,
			width: 200,
			height: 40,
			text: 'Hello'
		});
		document.slides[0]!.elements = [text];
		presentationStore.getState().loadDocument(document, { saved: true });
		const paragraphs = structuredClone(text.paragraphs);
		paragraphs[0]!.runs[0]!.text = 'Many words across multiple lines '.repeat(3);
		presentationStore.getState().updateText(text.id, paragraphs, { historyGroup: 'text:grow' });
		presentationStore.getState().endHistoryGroup();
		const grown = presentationStore.getState().document!.slides[0]!.elements[0]!;
		expect(grown.height).toBeGreaterThan(40);

		expect(await saving.save()).toBe('saved');
		const stored = await repository.getPresentation(PRESENTATION_ID);
		expect(stored.slides[0]!.elements[0]).toMatchObject({ height: grown.height, autoGrow: true });

		const fresh = createPresentationStore();
		fresh.getState().loadDocument(stored, { saved: true });
		expect(fresh.getState().dirty).toBe(false);
		expect(fresh.getState().document!.slides[0]!.elements[0]).toEqual(grown);
	});
});
