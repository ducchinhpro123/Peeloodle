import { describe, expect, it } from 'vitest';
import { dataUrlBytes, rasterizeSlidePage } from './rasterizeSlide';
import { createSlide } from '../model/factories';

describe('fixed-page slide rasterizer', () => {
	it('decodes the base64 payload of a PNG data URL', () => {
		// 0x89 0x50 0x4e 0x47 -> "iVBORw=="
		expect(Array.from(dataUrlBytes('data:image/png;base64,iVBORw=='))).toEqual([
			0x89, 0x50, 0x4e, 0x47
		]);
	});

	it('rejects a string that is not a data URL', () => {
		expect(() => dataUrlBytes('not-a-data-url')).toThrow('Not a data URL');
	});

	it('rejects non-positive raster dimensions before touching a canvas', async () => {
		await expect(
			rasterizeSlidePage({
				slide: createSlide(),
				pageSize: { width: 1280, height: 720 },
				images: new Map(),
				width: 0,
				height: 270
			})
		).rejects.toThrow('positive dimensions');
	});
});
