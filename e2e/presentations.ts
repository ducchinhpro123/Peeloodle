/**
 * Shared helpers for the presentation browser specs.
 *
 * These specs run against the production build (`npm run build && npm run
 * preview`), so, unlike the React source's specs, they cannot reach into the app
 * by importing `src/...` in the page. They read the app's own surfaces instead:
 * the DOM, the canvas host's view attributes, and the IndexedDB rows the app
 * writes. The stored row is the claim under test, so it is read directly rather
 * than through the app.
 */
import { expect, type Page } from '@playwright/test';

const DB_NAME = 'stickerlab-local';
const PRESENTATIONS = 'presentations';
const PRESENTATION_MEDIA = 'presentationMedia';

/** Both creation buttons, in either the empty or the populated library. */
const CREATE =
	/Create your first presentation|Create a blank presentation|Start a blank presentation/;

/** The stored presentation row: the document as it really reached disk. */
export async function readStoredPresentation(page: Page, id: string) {
	return page.evaluate(
		async ({ dbName, storeName, presentationId }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(dbName);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const row = await new Promise<any>((resolve, reject) => {
				const tx = db.transaction(storeName, 'readonly');
				const request = tx.objectStore(storeName).get(presentationId);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			if (!row) return null;
			const flatten = (document: any) =>
				(document.slides ?? [])
					.flatMap((slide: any) => slide.elements)
					.filter((element: any) => element.kind === 'text')
					.flatMap((element: any) => element.paragraphs)
					.flatMap((paragraph: any) => paragraph.runs)
					.map((run: any) => run.text)
					.join('');
			return {
				id: row.id,
				title: row.title,
				revision: row.revision,
				text: flatten(row),
				slideCount: row.slides?.length ?? 0,
				elements: (row.slides ?? []).flatMap((slide: any) =>
					slide.elements.map((element: any) => ({
						slideId: slide.id,
						id: element.id,
						kind: element.kind,
						assetId: element.assetId,
						x: element.x,
						y: element.y,
						width: element.width,
						height: element.height,
						rotation: element.rotation
					}))
				),
				assetIds: (row.assets ?? []).map((asset: any) => asset.id),
				assets: (row.assets ?? []).map((asset: any) => ({
					id: asset.id,
					byteLength: asset.byteLength,
					sha256: asset.sha256,
					width: asset.width,
					height: asset.height,
					mimeType: asset.mimeType
				})),
				slideIds: (row.slides ?? []).map((slide: any) => slide.id)
			};
		},
		{ dbName: DB_NAME, storeName: PRESENTATIONS, presentationId: id }
	);
}

/**
 * The stored row exactly as it sits in IndexedDB, stringified. View-only journeys
 * compare the whole row string before and after: a zoom, pan or slide switch must
 * not rewrite a single byte.
 */
export async function readStoredPresentationJson(page: Page, id: string): Promise<string> {
	return page.evaluate(
		async ({ dbName, storeName, presentationId }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(dbName);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const row = await new Promise<any>((resolve, reject) => {
				const tx = db.transaction(storeName, 'readonly');
				const request = tx.objectStore(storeName).get(presentationId);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			return row ? JSON.stringify(row) : '';
		},
		{ dbName: DB_NAME, storeName: PRESENTATIONS, presentationId: id }
	);
}

/** Every stored title, for the conflict copy the recovery writes beside it. */
export async function listStoredPresentations(page: Page) {
	return page.evaluate(
		async ({ dbName, storeName }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(dbName);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const rows = await new Promise<any[]>((resolve, reject) => {
				const tx = db.transaction(storeName, 'readonly');
				const request = tx.objectStore(storeName).getAll();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			return rows.map((row) => ({ id: row.id, title: row.title, revision: row.revision }));
		},
		{ dbName: DB_NAME, storeName: PRESENTATIONS }
	);
}

/** The stored artwork bytes: what an insert claim has to survive as. */
export async function readStoredMedia(page: Page) {
	return page.evaluate(
		async ({ dbName, storeName }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(dbName);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const rows = await new Promise<any[]>((resolve, reject) => {
				const tx = db.transaction(storeName, 'readonly');
				const request = tx.objectStore(storeName).getAll();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			return Promise.all(
				rows.map(async (row) => {
					const bytes = row.bytes ?? new ArrayBuffer(0);
					const digest = await crypto.subtle.digest('SHA-256', bytes);
					return {
						assetId: row.assetId,
						mimeType: row.mimeType,
						byteLength: row.bytes?.byteLength ?? row.bytes?.length ?? 0,
						sha256: [...new Uint8Array(digest)]
							.map((byte) => byte.toString(16).padStart(2, '0'))
							.join('')
					};
				})
			);
		},
		{ dbName: DB_NAME, storeName: PRESENTATION_MEDIA }
	);
}

/**
 * Plays the part of a second tab: writes the same presentation with a newer
 * revision, which is exactly the state the editor's Save has to refuse to
 * overwrite.
 */
export async function writeNewerRevision(page: Page, id: string, title: string) {
	return page.evaluate(
		async ({ dbName, storeName, presentationId, nextTitle }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(dbName);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const row = await new Promise<any>((resolve, reject) => {
				const tx = db.transaction(storeName, 'readonly');
				const request = tx.objectStore(storeName).get(presentationId);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			if (!row) throw new Error(`no stored presentation ${presentationId}`);
			const newer = { ...row, title: nextTitle, revision: row.revision + 1 };
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(storeName, 'readwrite');
				tx.objectStore(storeName).put(newer);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			return newer.revision;
		},
		{ dbName: DB_NAME, storeName: PRESENTATIONS, presentationId: id, nextTitle: title }
	);
}

/**
 * Writes a clone of an existing stored presentation straight into IndexedDB with
 * a new id, title, slide background and text. The library has no UI for a
 * specific slide background, so the thumbnail journeys seed their decks the same
 * way the source's specs did: by putting a real, parseable document behind the
 * library and then letting the app render it.
 */
export async function seedStoredPresentation(
	page: Page,
	sourceId: string,
	seed: { id: string; title: string; background: string; text: string }
): Promise<void> {
	await page.evaluate(
		async ({ dbName, storeName, sourceId, seed }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(dbName);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const read = () =>
				new Promise<any>((resolve, reject) => {
					const tx = db.transaction(storeName, 'readonly');
					const request = tx.objectStore(storeName).get(sourceId);
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
			const write = (row: any) =>
				new Promise<void>((resolve, reject) => {
					const tx = db.transaction(storeName, 'readwrite');
					tx.objectStore(storeName).put(row);
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
				});
			const source = await read();
			if (!source) throw new Error(`no stored presentation ${sourceId}`);
			const clone = structuredClone(source);
			clone.id = seed.id;
			clone.title = seed.title;
			clone.revision = 1;
			const now = new Date().toISOString();
			clone.createdAt = now;
			clone.updatedAt = now;
			clone.slides[0].background = seed.background;
			for (const slide of clone.slides) {
				for (const element of slide.elements) {
					if (element.kind !== 'text') continue;
					for (const paragraph of element.paragraphs) {
						for (const run of paragraph.runs) {
							run.text = seed.text;
							run.size = 150;
							run.color = '#101010';
						}
					}
				}
			}
			await write(clone);
		},
		{ dbName: DB_NAME, storeName: PRESENTATIONS, sourceId, seed }
	);
}

/** Creates a blank presentation from the library and returns its id. */
export async function openBlankEditor(page: Page): Promise<string> {
	await page.goto('/presentations');
	// The hero button is always there and the empty state's card is a second one,
	// so the hero (first in the DOM) is the stable choice while the library loads.
	await page.getByRole('button', { name: CREATE }).first().click();
	await expect(page).toHaveURL(/\/presentations\/[^/]+$/);
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	return decodeURIComponent(page.url().split('/').pop()!);
}

/**
 * The geometry inspector. The same fields are also rendered inside the (closed)
 * properties dialog, so every read is scoped to the pane the user sees.
 */
const inspector = (page: Page) => page.locator('.presentation-inspector');

/** Picks one shape from the Add shape menu; the new element ends up selected. */
export async function addShape(page: Page, shape: string): Promise<void> {
	await page.getByLabel('Add shape', { exact: true }).selectOption(shape);
	await expect(inspector(page).getByLabel('X position', { exact: true })).toBeVisible();
}

type CanvasView = { origin: { x: number; y: number }; scale: number };

/**
 * Where document units land on screen: the same fit/zoom/pan mapping the canvas
 * uses, read from the canvas host's own attributes.
 */
export async function canvasView(page: Page): Promise<CanvasView> {
	const host = page.getByTestId('presentation-canvas');
	const box = await host.boundingBox();
	if (!box) throw new Error('canvas host has no box');
	const zoom = Number(await host.getAttribute('data-view-zoom'));
	const pageWidth = Number(await host.getAttribute('data-document-width'));
	const pageHeight = Number(await host.getAttribute('data-document-height'));
	const scale = Math.min(box.width / pageWidth, box.height / pageHeight) * zoom;
	return {
		origin: {
			x:
				box.x +
				(box.width - pageWidth * scale) / 2 +
				Number(await host.getAttribute('data-view-pan-x')),
			y:
				box.y +
				(box.height - pageHeight * scale) / 2 +
				Number(await host.getAttribute('data-view-pan-y'))
		},
		scale
	};
}

/** Client point of one document-space point. */
export function at(view: CanvasView, x: number, y: number): { x: number; y: number } {
	return { x: view.origin.x + x * view.scale, y: view.origin.y + y * view.scale };
}

export async function drag(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
	steps = 8
): Promise<void> {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	for (let step = 1; step <= steps; step += 1) {
		await page.mouse.move(
			from.x + ((to.x - from.x) * step) / steps,
			from.y + ((to.y - from.y) * step) / steps
		);
	}
	await page.mouse.up();
}

export async function clickAt(page: Page, point: { x: number; y: number }): Promise<void> {
	await page.mouse.move(point.x, point.y);
	await page.mouse.down();
	await page.mouse.up();
}

type Geometry = { x: number; y: number; width: number; height: number; rotation: number };

/** The selected element's numbers, as the inspector pane shows them. */
export async function readGeometry(page: Page): Promise<Geometry> {
	const field = async (label: string) =>
		Number(await inspector(page).getByLabel(label, { exact: true }).inputValue());
	return {
		x: await field('X position'),
		y: await field('Y position'),
		width: await field('Width'),
		height: await field('Height'),
		rotation: await field('Rotation')
	};
}

/**
 * Waits until the app's own hit test finds the element, so a gesture cannot be
 * sent before the layer has drawn. Without this a click can land on a stage whose
 * hit graph is still empty and be treated as a click on the background.
 */
export async function waitForHittable(page: Page, geometry: Geometry): Promise<void> {
	await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
	const rect = await elementRectOnCanvas(page, geometry);
	await expect
		.poll(() =>
			page.evaluate(
				({ x, y }) => {
					const konva = (window as unknown as { Konva?: any }).Konva;
					const stage = konva?.stages?.[0];
					const hit = stage?.getIntersection?.({ x, y });
					return hit?.findAncestor?.('.presentation-element', true)?.id?.() ?? null;
				},
				{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
			)
		)
		.not.toBeNull();
}

/** Selects one element through the element list, the keyboard-reachable path. */
export async function selectFromElementList(page: Page, name: string): Promise<void> {
	await page
		.locator('.presentation-layer-item')
		.filter({ hasText: name })
		.first()
		.locator('.presentation-layer-select')
		.click();
}

/**
 * Pixels that are really artwork inside a CSS-pixel region of the slide canvas:
 * opaque pixels differing from the region's dominant colour. A blank slide is one
 * flat colour, so a blank region reads 0 and any real value means something was
 * painted there.
 *
 * The scene canvas is reached through the Konva stage the app built, because a
 * layer's hit canvas sits beside it and would answer with hit-test colours.
 */
/**
 * The opaque pixels in one canvas region, grouped by their `r,g,b` colour. Both
 * pixel helpers below read the same numbers; the caller decides what to make of
 * them, so "artwork is painted" and "this slide's background is that colour"
 * cannot disagree about what the canvas shows.
 */
async function canvasRegion(
	page: Page,
	area: { x: number; y: number; width: number; height: number }
): Promise<{ opaque: number; colours: Array<{ colour: string; count: number }> }> {
	return page.evaluate(
		({ rect }) => {
			const konva = (window as unknown as { Konva?: any }).Konva;
			const canvas = konva?.stages?.[0]?.getLayers?.()[0]?.getCanvas?.()._canvas;
			if (!canvas) throw new Error('the slide canvas is not on screen');
			const context = canvas.getContext('2d');
			if (!context) throw new Error('the slide canvas has no 2d context');
			const scaleX = canvas.width / canvas.clientWidth;
			const scaleY = canvas.height / canvas.clientHeight;
			const left = Math.max(0, Math.floor(rect.x * scaleX));
			const top = Math.max(0, Math.floor(rect.y * scaleY));
			const width = Math.max(1, Math.min(canvas.width - left, Math.floor(rect.width * scaleX)));
			const height = Math.max(1, Math.min(canvas.height - top, Math.floor(rect.height * scaleY)));
			const pixels = context.getImageData(left, top, width, height).data;
			const counts = new Map<string, number>();
			let opaque = 0;
			for (let index = 0; index < pixels.length; index += 4) {
				if (pixels[index + 3] <= 150) continue;
				opaque += 1;
				const key = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`;
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
			return {
				opaque,
				colours: [...counts].map(([colour, count]) => ({ colour, count }))
			};
		},
		{ rect: area }
	);
}

export async function paintedPixelsInRect(
	page: Page,
	area: { x: number; y: number; width: number; height: number }
): Promise<number> {
	const { opaque, colours } = await canvasRegion(page, area);
	const modal = colours.reduce((largest, entry) => Math.max(largest, entry.count), 0);
	return opaque - modal;
}

/** The colour the region paints most: its background, once artwork is painted on it. */
export async function dominantCanvasColor(
	page: Page,
	area: { x: number; y: number; width: number; height: number }
): Promise<string> {
	const { colours } = await canvasRegion(page, area);
	return colours.reduce((largest, entry) => (entry.count > largest.count ? entry : largest), {
		colour: '',
		count: 0
	}).colour;
}

/** One element's document rect, in CSS pixels relative to the slide canvas. */
export async function elementRectOnCanvas(
	page: Page,
	element: { x: number; y: number; width: number; height: number }
) {
	const host = page.getByTestId('presentation-canvas');
	const content = host.locator('.konvajs-content');
	const box = await content.boundingBox();
	if (!box) throw new Error('the slide canvas has no box');
	const view = await canvasView(page);
	return {
		x: view.origin.x - box.x + element.x * view.scale,
		y: view.origin.y - box.y + element.y * view.scale,
		width: element.width * view.scale,
		height: element.height * view.scale
	};
}
