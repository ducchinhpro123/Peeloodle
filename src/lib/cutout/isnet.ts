/**
 * ISNet (DIS) pre- and post-processing. Runs in the worker on OffscreenCanvas.
 *
 * Pre: stretch to 1024² (no letterbox, as DIS trains), RGB, x / 255 − 0.5 with
 * std 1.0, CHW float32. Post: min–max normalise the single-channel output to
 * 0..255, write it as alpha over white, and scale it to the source size.
 */
import { MODEL_INPUT_SIZE } from './modelInfo';
import { CutoutError } from './protocol';

const SIZE = MODEL_INPUT_SIZE;

function context2d(width: number, height: number): OffscreenCanvasRenderingContext2D {
	let ctx: OffscreenCanvasRenderingContext2D | null = null;
	try {
		ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
	} catch (error) {
		throw new CutoutError('too-large', error instanceof Error ? error.message : String(error));
	}
	if (!ctx) throw new CutoutError('too-large', `Could not allocate a ${width}×${height} canvas`);
	return ctx;
}

export function preprocess(bitmap: ImageBitmap): Float32Array {
	const ctx = context2d(SIZE, SIZE);
	ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
	const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
	const plane = SIZE * SIZE;
	const input = new Float32Array(3 * plane);
	for (let i = 0; i < plane; i += 1) {
		input[i] = data[i * 4] / 255 - 0.5;
		input[plane + i] = data[i * 4 + 1] / 255 - 0.5;
		input[2 * plane + i] = data[i * 4 + 2] / 255 - 0.5;
	}
	return input;
}

export async function postprocess(
	out: Float32Array,
	width: number,
	height: number
): Promise<{ mask: Blob; keptFraction: number }> {
	const plane = SIZE * SIZE;
	let min = Infinity;
	let max = -Infinity;
	for (let i = 0; i < plane; i += 1) {
		const value = out[i];
		if (value < min) min = value;
		if (value > max) max = value;
	}
	const range = max - min > 1e-8 ? max - min : 1;

	const square = context2d(SIZE, SIZE);
	const image = square.createImageData(SIZE, SIZE);
	for (let i = 0; i < plane; i += 1) {
		const p = i * 4;
		image.data[p] = 255;
		image.data[p + 1] = 255;
		image.data[p + 2] = 255;
		image.data[p + 3] = Math.round(((out[i] - min) / range) * 255);
	}
	square.putImageData(image, 0, 0);

	const target = context2d(width, height);
	target.imageSmoothingEnabled = true;
	target.imageSmoothingQuality = 'high';
	target.drawImage(square.canvas, 0, 0, width, height);

	let alpha: Uint8ClampedArray;
	try {
		alpha = target.getImageData(0, 0, width, height).data;
	} catch (error) {
		throw new CutoutError('too-large', error instanceof Error ? error.message : String(error));
	}
	let kept = 0;
	for (let i = 3; i < alpha.length; i += 4) if (alpha[i] >= 128) kept += 1;

	try {
		const mask = await target.canvas.convertToBlob({ type: 'image/png' });
		return { mask, keptFraction: kept / (width * height) };
	} catch (error) {
		throw new CutoutError('too-large', error instanceof Error ? error.message : String(error));
	}
}
