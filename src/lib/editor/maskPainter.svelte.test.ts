/**
 * Browser regression for the mask painter (port of
 * `../Peeloodle/src/features/editor/maskPainter.ts`, React main `54eae61c`).
 * The painter is canvas-only, so this file runs in the browser project:
 * a nonuniform brush stays the exact inverse-scaled ellipse, painting is clipped
 * to the layer crop, restore on a clean mask is a no-op, and an existing mask
 * blob seeds the working canvas.
 */

import { describe, expect, it } from 'vitest';
import { createDefaultMaskCanvas } from './maskUtils';
import { createMaskPainter, loadMaskCanvas } from './maskPainter';

function alphaAt(canvas: HTMLCanvasElement, x: number, y: number) {
	return canvas.getContext('2d')!.getImageData(x, y, 1, 1).data[3];
}

describe('mask painter', () => {
	it('paints an inverse-scaled ellipse for nonuniform radii', () => {
		const canvas = createDefaultMaskCanvas(200, 200);
		const painter = createMaskPainter(canvas);

		// Radii 10 in u and 40 in v: a round document brush is an ellipse here.
		painter.paint({ u: 100, v: 100 }, { u: 100, v: 100 }, { x: 10, y: 40 }, 'erase');
		expect(painter.hasChanges()).toBe(true);
		expect(alphaAt(canvas, 100, 100)).toBe(0);
		expect(alphaAt(canvas, 108, 100)).toBe(0);
		expect(alphaAt(canvas, 100, 138)).toBe(0);
		expect(alphaAt(canvas, 130, 100)).toBe(255);
		expect(alphaAt(canvas, 100, 160)).toBe(255);
	});

	it('keeps hidden source pixels outside the crop untouched', () => {
		const canvas = createDefaultMaskCanvas(200, 200);
		const painter = createMaskPainter(canvas, { x: 50, y: 50, width: 100, height: 100 });

		painter.paint({ u: 50, v: 60 }, { u: 60, v: 60 }, { x: 10, y: 10 }, 'erase');
		expect(alphaAt(canvas, 45, 60)).toBe(255);
		expect(alphaAt(canvas, 52, 60)).toBe(0);
	});

	it('reports no changes for a restore stroke on a clean mask', () => {
		const canvas = createDefaultMaskCanvas(120, 120);
		const painter = createMaskPainter(canvas);

		painter.paint({ u: 60, v: 60 }, { u: 60, v: 60 }, { x: 10, y: 10 }, 'restore');
		expect(painter.hasChanges()).toBe(false);
	});

	it('seeds the working canvas from an existing mask blob', async () => {
		const source = createDefaultMaskCanvas(64, 64);
		source.getContext('2d')!.clearRect(30, 30, 4, 4);
		const blob = await new Promise<Blob>((resolve) =>
			source.toBlob((value) => resolve(value!), 'image/png')
		);

		const loaded = await loadMaskCanvas(64, 64, blob);
		expect(alphaAt(loaded, 31, 31)).toBe(0);
		expect(alphaAt(loaded, 10, 10)).toBe(255);
	});
});
