import { describe, expect, it } from 'vitest';
import '$lib/presentations/rendering/presentation-fonts.css';
import {
	createShapeElement,
	createSlide,
	createTextElement,
	DEFAULT_THEME
} from '../model/factories';
import { BUILTIN_LAYOUTS, createBuiltinLayout } from '../templates/builtinLayouts';
import { growTextToFit } from '../editor/textFit';
import { ensurePresentationFonts } from './fonts';
import { rasterizeSlidePage } from './rasterizeSlide';

async function pixelAt(bytes: Uint8Array, x: number, y: number): Promise<number[]> {
	const copy = new Uint8Array(bytes);
	const bitmap = await createImageBitmap(new Blob([copy.buffer], { type: 'image/png' }));
	try {
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Canvas 2D is unavailable');
		context.drawImage(bitmap, 0, 0);
		return [...context.getImageData(x, y, 1, 1).data];
	} finally {
		bitmap.close();
	}
}

/** Non-background pixels in one region, decoded once and sampled every few pixels. */
async function paintedPixels(
	bytes: Uint8Array,
	region: { x: number; y: number; width: number; height: number },
	step = 4
): Promise<number> {
	const copy = new Uint8Array(bytes);
	const bitmap = await createImageBitmap(new Blob([copy.buffer], { type: 'image/png' }));
	try {
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Canvas 2D is unavailable');
		context.drawImage(bitmap, 0, 0);
		const background = [...context.getImageData(2, 2, 1, 1).data].join();
		const data = context.getImageData(region.x, region.y, region.width, region.height).data;
		let painted = 0;
		for (let index = 0; index < data.length; index += 4 * step) {
			if ([data[index], data[index + 1], data[index + 2], data[index + 3]].join() !== background)
				painted += 1;
		}
		return painted;
	} finally {
		bitmap.close();
	}
}

describe('fixed-page slide rasterizer in Chromium', () => {
	it('renders the page background and transformed shapes at the requested size', async () => {
		const slide = createSlide({ background: '#ffffff' });
		slide.elements.push(
			createShapeElement({
				x: 100,
				y: 100,
				width: 200,
				height: 100,
				fill: '#08b879',
				stroke: null
			})
		);

		const raster = await rasterizeSlidePage({
			slide,
			pageSize: { width: 1280, height: 720 },
			images: new Map(),
			width: 640,
			height: 360
		});

		expect(raster.width).toBe(640);
		expect(raster.height).toBe(360);
		expect(Array.from(raster.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
		expect(await pixelAt(raster.bytes, 10, 10)).toEqual([255, 255, 255, 255]);
		expect(await pixelAt(raster.bytes, 75, 75)).toEqual([8, 184, 121, 255]);
	});

	it('rasterizes every built-in layout and fitted text inside the page', async () => {
		await ensurePresentationFonts();
		for (const layout of BUILTIN_LAYOUTS) {
			const slide = createBuiltinLayout(layout.id, DEFAULT_THEME);
			const raster = await rasterizeSlidePage({
				slide,
				pageSize: { width: 1280, height: 720 },
				images: new Map(),
				width: 640,
				height: 360
			});
			expect(raster.width).toBe(640);
			expect(raster.height).toBe(360);
			expect(Array.from(raster.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
			// The page background is painted, so a layout raster is never blank.
			expect((await pixelAt(raster.bytes, 5, 5)).slice(0, 3)).toEqual([255, 255, 255]);
		}

		// A fitted, auto-grown element draws real text pixels inside its stored box.
		const measure = (text: string, font: { size: number }) => (text.length * font.size) / 2;
		const grown = growTextToFit(
			createTextElement({
				name: 'Grown',
				x: 80,
				y: 80,
				width: 600,
				height: 60,
				text: 'Fitted text that wraps across lines '.repeat(4),
				autoGrow: true
			}),
			{ width: 1280, height: 720 },
			measure
		);
		const slide = createSlide({ background: '#ffffff' });
		slide.elements.push(grown);
		const raster = await rasterizeSlidePage({
			slide,
			pageSize: { width: 1280, height: 720 },
			images: new Map(),
			width: 640,
			height: 360
		});
		expect(raster.width).toBe(640);
		expect(raster.height).toBe(360);
		expect(
			await paintedPixels(raster.bytes, { x: 40, y: 40, width: 300, height: 170 })
		).toBeGreaterThan(20);
	});
});
