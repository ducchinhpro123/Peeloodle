/**
 * Real-byte processing tests (P56/P57).
 *
 * These run the native decoder over generated fixtures, so the evidence is the
 * actual output: PNG/WebP headers of the derivatives, the pixel dimensions after
 * the resize bound, and a rejection for every review error the policy promises.
 * The SVG cases use the same restricted-subset rules a deployed process would.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { sniffImageFormat } from '$lib/imageFormat';
import { processAssetBytes, sha256Hex } from './index';
import { ProcessingError } from './errors';
import { inspectRasterHeader, normalizeRaster } from './raster';
import { inspectSvg, rasterizeSvg } from './svg';
import { PROCESSING_LIMITS } from './limits';

async function png(width: number, height: number, alpha = 0.5): Promise<Uint8Array> {
	const buffer = await sharp({
		create: {
			width,
			height,
			channels: 4,
			background: { r: 12, g: 200, b: 90, alpha }
		}
	})
		.png()
		.toBuffer();
	return new Uint8Array(buffer);
}

async function webp(width: number, height: number): Promise<Uint8Array> {
	const buffer = await sharp({
		create: { width, height, channels: 4, background: { r: 5, g: 5, b: 250, alpha: 1 } }
	})
		.webp()
		.toBuffer();
	return new Uint8Array(buffer);
}

const SVG_RECT =
	'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#ff0000"/></svg>';

async function failure(code: string, bytes: Uint8Array): Promise<void> {
	await expect(processAssetBytes(bytes)).rejects.toMatchObject({ code });
}

describe('raster processing', () => {
	it('normalizes a PNG into a real PNG derivative and WebP thumbnail', async () => {
		const source = await png(1200, 600);
		const processed = await processAssetBytes(source);
		expect(processed.sourceFormat).toBe('png');
		expect(processed.sourceBytes).toBe(source.length);
		expect(processed.sourceSha256).toBe(await sha256Hex(source));
		expect({ width: processed.width, height: processed.height }).toEqual({
			width: 1200,
			height: 600
		});
		expect(sniffImageFormat(processed.png)).toBe('image/png');
		expect(sniffImageFormat(processed.thumbnail)).toBe('image/webp');
		const thumbnail = await sharp(processed.thumbnail).metadata();
		expect({ width: thumbnail.width, height: thumbnail.height }).toEqual({
			width: 512,
			height: 256
		});
	});

	it('bounds the stored derivative to the output edge without enlarging', async () => {
		const wide = await png(5000, 1000);
		const processed = await processAssetBytes(wide);
		expect(processed.width).toBe(PROCESSING_LIMITS.raster.maxOutputEdge);
		expect(processed.height).toBe(819);
		expect(sniffImageFormat(processed.png)).toBe('image/png');
		const small = await png(40, 30);
		const kept = await processAssetBytes(small);
		expect({ width: kept.width, height: kept.height }).toEqual({ width: 40, height: 30 });
	});

	it('accepts static WebP and re-encodes it as PNG', async () => {
		const source = await webp(64, 48);
		const processed = await processAssetBytes(source);
		expect(processed.sourceFormat).toBe('webp');
		expect(sniffImageFormat(processed.png)).toBe('image/png');
		expect({ width: processed.width, height: processed.height }).toEqual({ width: 64, height: 48 });
	});

	it('rejects a GIF, a JPEG and an empty file', async () => {
		const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
		const jpeg = await sharp({
			create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } }
		})
			.jpeg()
			.toBuffer();
		await failure('unsupported_type', gif);
		await failure('unsupported_type', new Uint8Array(jpeg));
		await failure('decode_failed', new Uint8Array());
	});

	it('rejects an animated PNG from its header alone', async () => {
		// Signature + IHDR + an acTL chunk, which is what makes a PNG animated.
		const animated = new Uint8Array([
			0x89,
			0x50,
			0x4e,
			0x47,
			0x0d,
			0x0a,
			0x1a,
			0x0a, // signature
			0,
			0,
			0,
			13,
			73,
			72,
			68,
			82,
			0,
			0,
			0,
			2,
			0,
			0,
			0,
			2,
			8,
			6,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			8,
			97,
			99,
			84,
			76,
			0,
			0,
			0,
			2,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0
		]);
		expect(() => inspectRasterHeader(animated)).toThrowError(ProcessingError);
		await failure('animated_image', animated);
	});

	it('refuses a source over the byte limit before decoding', async () => {
		const oversized = new Uint8Array(PROCESSING_LIMITS.raster.maxSourceBytes + 1);
		expect(() => inspectRasterHeader(oversized)).toThrowError(/15 MB/);
	});

	it('refuses a header that lies about the decoded dimensions', async () => {
		const source = await png(64, 64);
		// Corrupt the IHDR height so the header and the decoder disagree.
		const forged = source.slice();
		forged[23] = 99;
		expect(() => inspectRasterHeader(forged)).not.toThrow();
		await expect(normalizeRaster(forged)).rejects.toMatchObject({
			code: 'decode_failed'
		});
	});
});

describe('svg processing', () => {
	it('rasterizes an approved SVG into a bounded PNG derivative', async () => {
		const processed = await processAssetBytes(new TextEncoder().encode(SVG_RECT));
		expect(processed.sourceFormat).toBe('svg');
		expect({ width: processed.width, height: processed.height }).toEqual({
			width: 120,
			height: 80
		});
		expect(sniffImageFormat(processed.png)).toBe('image/png');
		expect(sniffImageFormat(processed.thumbnail)).toBe('image/webp');
	});

	it('reads the viewBox when width/height are absent and accepts units', () => {
		const viewBox = inspectSvg(
			new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"/>')
		);
		expect(viewBox).toMatchObject({ width: 40, height: 20 });
		const units = inspectSvg(
			new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="1in"/>')
		);
		expect(units).toMatchObject({ width: 192, height: 96 });
	});

	it('bounds the rendered edge, and refuses a canvas past the render limit', () => {
		const encode = (markup: string) => new TextEncoder().encode(markup);
		// 4000 px passes the render limit but is beyond the stored output edge, so
		// the derivative is capped at 2048.
		const bounded = rasterizeSvg(
			encode(
				'<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="1000"><rect width="4000" height="1000"/></svg>'
			)
		);
		expect(bounded.width).toBe(2048);
		expect(bounded.height).toBe(512);
		expect(() =>
			rasterizeSvg(
				encode(
					'<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="1000"><rect width="20000" height="1000"/></svg>'
				)
			)
		).toThrowError(/render limit/);
	});

	it('rejects scripts, external references, entities, DTDs and CSS imports', async () => {
		const cases: [string, string][] = [
			[
				'script element',
				'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script>alert(1)</script></svg>'
			],
			[
				'event handler',
				'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" onload="alert(1)"/>'
			],
			[
				'external href',
				'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="https://example.test/x.png"/></svg>'
			],
			[
				'javascript url',
				'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect fill="url(javascript:alert(1))" width="8" height="8"/></svg>'
			],
			['DOCTYPE', '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'],
			[
				'entity declaration',
				'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'
			],
			[
				'CSS import',
				'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><style>@import url("x.css");</style></svg>'
			],
			[
				'foreignObject',
				'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><foreignObject width="8" height="8"/></svg>'
			]
		];
		for (const [label, markup] of cases) {
			await expect(
				processAssetBytes(new TextEncoder().encode(markup)),
				label
			).rejects.toBeInstanceOf(ProcessingError);
		}
	});

	it('rejects text elements and explains why', async () => {
		await expect(
			processAssetBytes(
				new TextEncoder().encode(
					'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><text x="2" y="10">Hi</text></svg>'
				)
			)
		).rejects.toMatchObject({
			code: 'unsupported_feature',
			message: expect.stringContaining('convert text to paths')
		});
	});

	it('rejects an SVG without finite bounds, and one that is too large or too complex', async () => {
		await failure(
			'unsupported_feature',
			new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
		);
		await failure(
			'dimension_too_large',
			new TextEncoder().encode(
				'<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="9000"/>'
			)
		);
		const many = Array.from(
			{ length: PROCESSING_LIMITS.svg.maxNodes + 10 },
			(_, index) => `<rect x="${index}" y="0" width="1" height="1"/>`
		).join('');
		await failure(
			'svg_too_complex',
			new TextEncoder().encode(
				`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">${many}</svg>`
			)
		);
	});

	it('refuses a source over the SVG byte limit', async () => {
		const oversized = new Uint8Array(PROCESSING_LIMITS.svg.maxSourceBytes + 1);
		oversized.set(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'));
		await failure('file_too_large', oversized);
	});
});
