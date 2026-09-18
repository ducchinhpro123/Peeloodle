/**
 * P75 journey: all three shipped templates are cloned through the real browser
 * screen into the local repository, edited (text replaced, long Vietnamese text
 * added), saved and reopened, and exported to PDF and editable PPTX with the
 * bytes inspected. The catalog source and the other clones stay unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '$lib/presentations/rendering/presentation-fonts.css';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import PresentationTemplatesPage from './PresentationTemplatesPage.svelte';
import { MemoryCatalog } from '$lib/catalog/memory';
import { createMemoryPresentationRepository } from '$lib/presentations/persistence/repository';
import { SHIPPED_TEMPLATES } from '$lib/presentations/templates/shippedTemplates.js';
import { prepareExportSnapshot } from '$lib/presentations/exports/snapshot';
import { buildPresentationPdf } from '$lib/presentations/exports/pdf';
import { buildPresentationPptx } from '$lib/presentations/exports/pptx';
import { presentationDocumentToJson } from '$lib/presentations/model/parse';
import type { CatalogTemplate, CatalogTemplateVersion } from '$lib/catalog/types';
import type { PresentationDocument } from '$lib/presentations/model/types';

const now = '2026-09-18T00:00:00.000Z';

function catalogWithShippedTemplates() {
	const publishedAt = now;
	const templates: CatalogTemplate[] = [];
	const versions: CatalogTemplateVersion[] = [];
	SHIPPED_TEMPLATES.forEach((template, index) => {
		const document = template.build();
		const versionId = `w0000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`;
		templates.push({
			id: `t0000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
			title: template.title,
			useCase: template.useCase,
			description: template.description,
			tags: template.tags,
			sortOrder: template.sortOrder,
			state: 'published',
			revision: 2,
			publishedVersionId: versionId,
			publishedAt,
			archivedAt: null,
			createdAt: publishedAt,
			updatedAt: publishedAt
		});
		versions.push({
			id: versionId,
			templateId: templates[index]!.id,
			versionNumber: 1,
			document: JSON.parse(presentationDocumentToJson(document)),
			documentSha256: 'e'.repeat(64),
			documentBytes: 1000,
			coverPath: null,
			coverSha256: null,
			slidePreviews: [],
			fontRequirements: [{ fontId: 'spectral' }, { fontId: 'be-vietnam-pro' }],
			validationState: 'validated',
			validation: {},
			createdAt: publishedAt
		});
	});
	return new MemoryCatalog({ templates, templateVersions: versions }, null);
}

async function waitFor<T>(
	check: () => T | Promise<T>,
	message: string,
	timeout = 15000
): Promise<NonNullable<T>> {
	const start = Date.now();
	for (;;) {
		const value = await check();
		if (value !== null && value !== undefined && value !== false) return value as NonNullable<T>;
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

function cardButton(container: HTMLElement, title: string, text: string): HTMLButtonElement {
	const card = [...container.querySelectorAll('li')].find((row) =>
		(row.textContent ?? '').includes(title)
	);
	if (!card) throw new Error(`No card for ${title}`);
	const button = [...card.querySelectorAll('button')].find((candidate) =>
		(candidate.textContent ?? '').includes(text)
	);
	if (!button) throw new Error(`No “${text}” button in ${title}`);
	return button;
}

/** Replaces the first text run of every slide's first text element. */
function replaceSampleText(document: PresentationDocument, value: string): PresentationDocument {
	for (const slide of document.slides)
		for (const element of slide.elements) {
			if (element.kind !== 'text') continue;
			const run = element.paragraphs[0]?.runs[0];
			if (run) run.text = value;
			break;
		}
	return document;
}

describe('template journey', () => {
	it('clones, edits, reopens and exports all three shipped templates', async () => {
		const catalog = catalogWithShippedTemplates();
		const repository = createMemoryPresentationRepository();
		const clones: string[] = [];
		const page = render(PresentationTemplatesPage, {
			catalogRepository: catalog,
			presentationRepository: repository,
			onused: (id) => clones.push(id)
		});

		for (const template of SHIPPED_TEMPLATES) {
			await waitFor(
				() => page.container.textContent?.includes(template.title),
				`the ${template.key} card`
			);
			cardButton(page.container, template.title, 'Use template').click();
			await waitFor(() => clones.length === SHIPPED_TEMPLATES.indexOf(template) + 1, 'the clone');
		}

		expect(clones).toHaveLength(3);
		const sourceHashes = catalog.templateVersions.map((version) =>
			JSON.stringify(version.document)
		);

		for (const [index, template] of SHIPPED_TEMPLATES.entries()) {
			const clone = await repository.getPresentation(clones[index]!);
			expect(clone.title).toBe(template.title);
			expect(clone.slides.length).toBeGreaterThanOrEqual(8);

			// Replace the sample text with a real (long, bilingual) title and body.
			replaceSampleText(
				clone,
				'Kết quả nghiên cứu và thảo luận — replace every sample line with your own content before presenting it to the class.'
			);
			await repository.savePresentation(clone);

			const reopened = await repository.getPresentation(clone.id);
			expect(reopened.slides[0]!.elements[0]).toMatchObject({ kind: 'text' });
			const firstElement = reopened.slides[0]!.elements[0]!;
			const reopenedText =
				firstElement.kind === 'text' ? (firstElement.paragraphs[0]?.runs[0]?.text ?? '') : '';
			expect(reopenedText).toContain('Kết quả nghiên cứu');

			// The catalog source is untouched by the clone and its edits.
			expect(JSON.stringify(catalog.templateVersions[index]!.document)).toBe(sourceHashes[index]);
			if (index > 0) {
				const other = await repository.getPresentation(clones[0]!);
				expect(other.slides[0]!.elements[0]).not.toEqual(reopened.slides[0]!.elements[0]);
			}
		}

		// Export every reopened clone and inspect the actual artifacts.
		for (const id of clones) {
			const document = await repository.getPresentation(id);
			const snapshot = await prepareExportSnapshot(repository, document);
			try {
				const pdfBytes = await buildPresentationPdf(snapshot);
				const pdf = await PDFDocument.load(pdfBytes);
				expect(pdf.getPageCount()).toBe(document.slides.length);
				expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe('%PDF-');

				const pptxBytes = await buildPresentationPptx(snapshot, { title: document.title });
				const files = unzipSync(pptxBytes);
				const slideParts = Object.keys(files).filter((name) =>
					/^ppt\/slides\/slide\d+\.xml$/.test(name)
				);
				expect(slideParts).toHaveLength(document.slides.length);
				expect(Object.keys(files).some((name) => name === 'ppt/presentation.xml')).toBe(true);
			} finally {
				snapshot.dispose();
			}
		}
	}, 120000);

	it('warns clearly when replaced content overflows its box', async () => {
		const catalog = catalogWithShippedTemplates();
		const repository = createMemoryPresentationRepository();
		const onused = vi.fn();
		const page = render(PresentationTemplatesPage, {
			catalogRepository: catalog,
			presentationRepository: repository,
			onused
		});
		await waitFor(
			() => page.container.textContent?.includes('Class presentation'),
			'the class card'
		);
		cardButton(page.container, 'Class presentation', 'Use template').click();
		await waitFor(() => onused.mock.calls.length === 1, 'the clone');
		const clone = await repository.getPresentation(onused.mock.calls[0]![0] as string);

		// A paragraph far longer than the heading box can hold must surface the
		// editor's existing overflow warning rather than silently clipping.
		const heading = clone.slides[1]!.elements[0];
		if (heading.kind === 'text') {
			heading.paragraphs[0]!.runs[0]!.text =
				'Rất dài: '.repeat(400) + 'This sample paragraph keeps going until it cannot fit.';
		}
		const snapshot = await prepareExportSnapshot(repository, clone);
		try {
			expect(snapshot.warnings.some((warning) => warning.code === 'text-overflow')).toBe(true);
		} finally {
			snapshot.dispose();
		}
	}, 60000);
});
