/**
 * P02 proof fixture: one tiny presentation exercising the risky contracts —
 * English/Vietnamese text, mixed bold/italic runs, bullets, a hyperlink, a
 * rounded-rectangle shape, a line, and a transparent PNG image.
 *
 * Used by geometry/parser tests (P02, P09–P10), the PptxGenJS proof (P03),
 * the text-bridge proof (P04), font comparison (P05) and PDF/backup proofs (P06).
 */

import {
	PRESENTATION_KIND,
	PRESENTATION_PAGE_HEIGHT,
	PRESENTATION_PAGE_WIDTH,
	PRESENTATION_SCHEMA_VERSION,
	type PresentationDocument,
	type Slide,
	type TextElement
} from '../types';
import { encodeRgbaPng } from './png';

export const FIXTURE_ID = 'fixture-presentation';
export const FIXTURE_IMAGE_ASSET_ID = 'fixture-asset-transparent';
export const FIXTURE_IMAGE_BLOB_KEY = 'fixture/assets/transparent.png';
export const FIXTURE_FONTS = { heading: 'spectral', body: 'be-vietnam-pro' } as const;

/** Deterministic 256×256 transparent PNG: mint circle with a soft alpha edge. */
export function fixtureImagePng(): Uint8Array {
	const size = 256;
	const cx = size / 2 - 0.5;
	const cy = size / 2 - 0.5;
	return encodeRgbaPng(size, size, (x, y) => {
		const distance = Math.hypot(x - cx, y - cy);
		const alpha =
			distance <= 86 ? 255 : distance <= 92 ? Math.round(255 * (1 - (distance - 86) / 6)) : 0;
		return [8, 184, 121, alpha];
	});
}

/** SHA-256 of `fixtureImagePng()`. */
export const FIXTURE_IMAGE_SHA256 =
	'c407a0727ad50b0530208e17052eafe2f7eb7a658bb1a9d6bbea5c1e1619c58e';

/** Size of `fixtureImagePng()`. Encoded once, not per document. */
export const FIXTURE_IMAGE_BYTE_LENGTH = fixtureImagePng().length;

const FIXTURE_CREATED_AT = '2026-09-10T08:00:00.000Z';

function fixtureTitleText(): TextElement {
	return {
		id: 'fixture-text-title',
		kind: 'text',
		name: 'Title',
		x: 80,
		y: 96,
		width: 1120,
		height: 240,
		rotation: 0,
		opacity: 1,
		visible: true,
		locked: false,
		padding: 8,
		lineHeight: 1.2,
		verticalAlign: 'top',
		paragraphs: [
			{
				alignment: 'center',
				bullet: 'none',
				bulletLevel: 0,
				runs: [
					{
						text: 'Nghiên cứu và trình bày',
						fontId: FIXTURE_FONTS.heading,
						size: 72,
						color: '#ffffff',
						bold: true
					}
				]
			},
			{
				alignment: 'center',
				bullet: 'none',
				bulletLevel: 0,
				runs: [
					{ text: 'Building a ', fontId: FIXTURE_FONTS.body, size: 36, color: '#d7f4e6' },
					{ text: 'sticker', fontId: FIXTURE_FONTS.body, size: 36, color: '#d7f4e6', italic: true },
					{
						text: ' presentation',
						fontId: FIXTURE_FONTS.body,
						size: 36,
						color: '#d7f4e6',
						bold: true
					}
				]
			}
		]
	};
}

function fixtureBulletText(): TextElement {
	return {
		id: 'fixture-text-bullets',
		kind: 'text',
		name: 'Bullets',
		x: 80,
		y: 224,
		width: 640,
		height: 400,
		rotation: 0,
		opacity: 1,
		visible: true,
		locked: false,
		padding: 12,
		lineHeight: 1.35,
		verticalAlign: 'top',
		paragraphs: [
			{
				alignment: 'left',
				bullet: 'bullet',
				bulletLevel: 0,
				runs: [
					{
						text: 'Tóm tắt kết quả: ',
						fontId: FIXTURE_FONTS.body,
						size: 28,
						color: '#08152f',
						bold: true
					},
					{
						text: 'ấn tượng, rõ ràng và dễ đọc.',
						fontId: FIXTURE_FONTS.body,
						size: 28,
						color: '#08152f'
					}
				]
			},
			{
				alignment: 'left',
				bullet: 'bullet',
				bulletLevel: 1,
				runs: [
					{
						text: 'Xem hướng dẫn',
						fontId: FIXTURE_FONTS.body,
						size: 24,
						color: '#08b879',
						link: 'https://example.edu/guide'
					},
					{ text: ' trước khi nộp bài.', fontId: FIXTURE_FONTS.body, size: 24, color: '#08152f' }
				]
			},
			{
				alignment: 'left',
				bullet: 'number',
				bulletLevel: 0,
				runs: [
					{ text: 'Kết luận và đề xuất.', fontId: FIXTURE_FONTS.body, size: 28, color: '#08152f' }
				]
			}
		]
	};
}

export function createFixtureSlides(): Slide[] {
	return [
		{
			id: 'fixture-slide-1',
			name: 'Title slide',
			background: '#0b1f3b',
			elements: [
				{
					id: 'fixture-shape-panel',
					kind: 'shape',
					name: 'Panel',
					x: 48,
					y: 48,
					width: 1184,
					height: 624,
					rotation: 0,
					opacity: 1,
					visible: true,
					locked: false,
					shape: 'rounded-rectangle',
					fill: '#12314f',
					stroke: '#1f4f7a',
					strokeWidth: 4
				},
				fixtureTitleText(),
				{
					id: 'fixture-image-sticker',
					kind: 'image',
					name: 'Sample sticker',
					x: 880,
					y: 400,
					width: 256,
					height: 256,
					rotation: 0,
					opacity: 1,
					visible: true,
					locked: false,
					assetId: FIXTURE_IMAGE_ASSET_ID,
					crop: { x: 0, y: 0, width: 1, height: 1 },
					flipX: false,
					flipY: false,
					alt: 'Mint circle sample sticker (transparent background)'
				},
				{
					id: 'fixture-shape-ellipse',
					kind: 'shape',
					name: 'Accent circle',
					x: 120,
					y: 420,
					width: 160,
					height: 160,
					rotation: 0,
					opacity: 0.9,
					visible: true,
					locked: false,
					shape: 'ellipse',
					fill: '#ffd166',
					stroke: null,
					strokeWidth: 0
				}
			]
		},
		{
			id: 'fixture-slide-2',
			name: 'Bullets slide',
			background: '#ffffff',
			elements: [
				fixtureBulletText(),
				{
					id: 'fixture-shape-line',
					kind: 'shape',
					name: 'Divider',
					x: 80,
					y: 660,
					width: 1120,
					height: 4,
					rotation: 0,
					opacity: 1,
					visible: true,
					locked: false,
					shape: 'line',
					fill: null,
					stroke: '#c9d6e4',
					strokeWidth: 4
				}
			]
		}
	];
}

export function createFixturePresentation(): PresentationDocument {
	return {
		kind: PRESENTATION_KIND,
		schemaVersion: PRESENTATION_SCHEMA_VERSION,
		id: FIXTURE_ID,
		title: 'Bài trình bày mẫu — Fixture',
		revision: 3,
		pageSize: { width: PRESENTATION_PAGE_WIDTH, height: PRESENTATION_PAGE_HEIGHT },
		theme: {
			headingFontId: FIXTURE_FONTS.heading,
			bodyFontId: FIXTURE_FONTS.body,
			colors: { text: '#08152f', accent: '#08b879', background: '#ffffff' }
		},
		slides: createFixtureSlides(),
		assets: [
			{
				id: FIXTURE_IMAGE_ASSET_ID,
				blobKey: FIXTURE_IMAGE_BLOB_KEY,
				mimeType: 'image/png',
				width: 256,
				height: 256,
				sha256: FIXTURE_IMAGE_SHA256,
				byteLength: FIXTURE_IMAGE_BYTE_LENGTH,
				provenance: { source: 'upload', label: 'Generated fixture artwork (test only)' }
			}
		],
		createdAt: FIXTURE_CREATED_AT,
		updatedAt: FIXTURE_CREATED_AT
	};
}
