import { describe, expect, it } from 'vitest';
import { createShapeElement, createSlide } from '../model/factories';
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
});
