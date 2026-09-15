/**
 * Canvas-side mask painting, ported from `../Peeloodle/src/features/editor/maskPainter.ts`
 * (React main `54eae61c`). One stroke keeps only the alpha of touched 128 px
 * tiles, so `hasChanges()` compares once at pointer-up instead of every frame,
 * and the brush clips to the layer crop.
 */

import type { CropRect } from '../domain/domain';
import { decodeMaskImage } from '../exports/renderDocument';
import { createDefaultMaskCanvas } from './maskUtils';

type LocalPoint = { u: number; v: number };

export async function loadMaskCanvas(
	width: number,
	height: number,
	blob?: Blob
): Promise<HTMLCanvasElement> {
	const canvas = createDefaultMaskCanvas(width, height);
	if (!blob) return canvas;
	const image = await decodeMaskImage(blob, width, height);
	try {
		const ctx = canvas.getContext('2d')!;
		ctx.clearRect(0, 0, width, height);
		ctx.drawImage(image, 0, 0);
	} finally {
		if ('close' in image && typeof image.close === 'function') image.close();
	}
	return canvas;
}

/** One stroke: retain only touched alpha tiles, compare once at completion. */
export function createMaskPainter(canvas: HTMLCanvasElement, crop?: CropRect) {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('A 2D canvas is required for mask editing');
	const ctx = context;
	const tileSize = 128;
	const before = new Map<
		string,
		{ x: number; y: number; width: number; height: number; alpha: Uint8Array }
	>();
	const clip = crop ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };

	function paint(
		from: LocalPoint,
		to: LocalPoint,
		radii: { x: number; y: number },
		mode: 'erase' | 'restore'
	) {
		if (
			![from.u, from.v, to.u, to.v, radii.x, radii.y].every(Number.isFinite) ||
			radii.x <= 0 ||
			radii.y <= 0
		)
			return;
		const left = Math.max(0, clip.x, Math.floor(Math.min(from.u, to.u) - radii.x - 1));
		const top = Math.max(0, clip.y, Math.floor(Math.min(from.v, to.v) - radii.y - 1));
		const right = Math.min(
			canvas.width,
			clip.x + clip.width,
			Math.ceil(Math.max(from.u, to.u) + radii.x + 1)
		);
		const bottom = Math.min(
			canvas.height,
			clip.y + clip.height,
			Math.ceil(Math.max(from.v, to.v) + radii.y + 1)
		);
		if (left >= right || top >= bottom) return;
		for (let y = Math.floor(top / tileSize) * tileSize; y < bottom; y += tileSize) {
			for (let x = Math.floor(left / tileSize) * tileSize; x < right; x += tileSize) {
				const key = `${x},${y}`;
				if (before.has(key)) continue;
				const width = Math.min(tileSize, canvas.width - x);
				const height = Math.min(tileSize, canvas.height - y);
				const pixels = ctx.getImageData(x, y, width, height).data;
				const alpha = new Uint8Array(width * height);
				for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3]!;
				before.set(key, { x, y, width, height, alpha });
			}
		}
		ctx.save();
		ctx.beginPath();
		ctx.rect(clip.x, clip.y, clip.width, clip.height);
		ctx.clip();
		ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
		ctx.fillStyle = ctx.strokeStyle = '#ffffff';
		// A round stroke in normalized space becomes the exact inverse-scaled ellipse.
		ctx.scale(radii.x, radii.y);
		ctx.lineWidth = 2;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		if (from.u === to.u && from.v === to.v) {
			ctx.arc(to.u / radii.x, to.v / radii.y, 1, 0, Math.PI * 2);
			ctx.fill();
		} else {
			ctx.moveTo(from.u / radii.x, from.v / radii.y);
			ctx.lineTo(to.u / radii.x, to.v / radii.y);
			ctx.stroke();
		}
		ctx.restore();
	}

	function hasChanges() {
		for (const tile of before.values()) {
			const pixels = ctx.getImageData(tile.x, tile.y, tile.width, tile.height).data;
			for (let i = 0; i < tile.alpha.length; i++) {
				if (pixels[i * 4 + 3] !== tile.alpha[i]) return true;
			}
		}
		return false;
	}

	return { paint, hasChanges };
}
