import slides from './companyProfileContent.json' with { type: 'json' };

/**
 * Adapted from the user-supplied 15-slide PowerPoint. The freeform geometry,
 * photographs and charts are flattened into one locked artwork layer per page;
 * all 68 text boxes remain independent, editable text elements. Fonts are mapped
 * to the two installed presentation families rather than claiming Canva's fonts.
 * Artwork bytes are fetched and stored with each local copy, never linked to the
 * site at edit time. This is a curated deck, not a general PPTX importer.
 */
const ARTWORK_PATH = '/art/presentation-company-profile';

/** @returns {import('../model/types').PresentationDocument} */
export function buildCompanyProfileTemplate() {
	const stamp = new Date().toISOString();
	return {
		kind: 'presentation',
		schemaVersion: 1,
		id: crypto.randomUUID(),
		title: 'Red & white company profile',
		revision: 0,
		pageSize: { width: 1280, height: 720 },
		theme: {
			headingFontId: 'be-vietnam-pro',
			bodyFontId: 'be-vietnam-pro',
			colors: {
				text: '#000000',
				accent: '#8d0000',
				background: '#ffffff',
				muted: '#2e2e2e'
			}
		},
		slides: slides.map((slide, index) => {
			const assetId = `company-profile-artwork-${index + 1}`;
			/** @type {import('../model/types').Slide} */
			const result = {
				id: crypto.randomUUID(),
				name: slide.name,
				background: '#ffffff',
				elements: [
					{
						id: crypto.randomUUID(),
						kind: /** @type {'image'} */ ('image'),
						name: `${slide.name} artwork (unlock to replace)`,
						x: 0,
						y: 0,
						width: 1280,
						height: 720,
						rotation: 0,
						opacity: 1,
						visible: true,
						locked: true,
						assetId,
						crop: { x: 0, y: 0, width: 1, height: 1 },
						flipX: false,
						flipY: false,
						alt: `Original geometric layout and photographs for ${slide.name}`
					},
					...slide.boxes.map((box) => ({
						id: crypto.randomUUID(),
						kind: /** @type {'text'} */ ('text'),
						name: box.name,
						x: box.x,
						y: box.y,
						width: box.width,
						height: box.height,
						rotation: 0,
						opacity: 1,
						visible: true,
						locked: false,
						padding: 0,
						lineHeight: 1.05,
						verticalAlign: /** @type {'top'} */ ('top'),
						paragraphs: box.paragraphs.map((paragraph) => ({
							alignment: /** @type {'left' | 'center' | 'right' | 'justify'} */ (
								paragraph.alignment
							),
							bullet: /** @type {'none' | 'bullet'} */ (paragraph.bullet),
							bulletLevel: /** @type {0} */ (0),
							runs: paragraph.runs.map((run) => ({
								text: run.text,
								fontId: 'be-vietnam-pro',
								size: run.size,
								color: run.color,
								bold: run.bold,
								italic: run.italic
							}))
						}))
					}))
				]
			};
			return result;
		}),
		assets: slides.map((slide, index) => ({
			id: `company-profile-artwork-${index + 1}`,
			blobKey: `templates/company-profile/slide-${index + 1}`,
			mimeType: /** @type {'image/webp'} */ ('image/webp'),
			width: 1280,
			height: 720,
			sha256: '0'.repeat(64),
			byteLength: 0,
			provenance: { source: /** @type {'upload'} */ ('upload'), label: `${slide.name} artwork` }
		})),
		createdAt: stamp,
		updatedAt: stamp
	};
}

/**
 * Loads the shipped artwork for this new document, checks it is actually image
 * data and stamps its digest/size before an atomic repository save. Every copy
 * receives fresh asset IDs, so the repository cannot alias two copies' media.
 * @param {import('../model/types').PresentationDocument} document
 * @returns {Promise<import('../persistence/repository').PresentationMediaRecord[]>}
 */
export async function loadCompanyProfileArtwork(document) {
	return Promise.all(
		document.assets.map(async (asset, index) => {
			const path = `${ARTWORK_PATH}/slide-${String(index + 1).padStart(2, '0')}.webp`;
			const response = await fetch(path);
			if (!response.ok || !response.headers.get('content-type')?.includes('image/webp')) {
				throw new Error(`Missing template artwork: ${path}`);
			}
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) {
				throw new Error(`Invalid template artwork size: ${path}`);
			}
			if (
				bytes[0] !== 0x52 ||
				bytes[1] !== 0x49 ||
				bytes[2] !== 0x46 ||
				bytes[3] !== 0x46 ||
				String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP'
			)
				throw new Error(`Invalid template artwork format: ${path}`);
			const digest = await crypto.subtle.digest('SHA-256', bytes);
			const sha256 = [...new Uint8Array(digest)]
				.map((byte) => byte.toString(16).padStart(2, '0'))
				.join('');
			const assetId = crypto.randomUUID();
			const oldId = asset.id;
			asset.id = assetId;
			asset.blobKey = `templates/company-profile/${sha256}`;
			asset.sha256 = sha256;
			asset.byteLength = bytes.length;
			const image = document.slides[index].elements.find(
				(element) => element.kind === 'image' && element.assetId === oldId
			);
			if (!image || image.kind !== 'image') throw new Error(`Missing artwork layer: ${path}`);
			image.assetId = assetId;
			return { assetId, bytes, mimeType: /** @type {'image/webp'} */ ('image/webp') };
		})
	);
}
