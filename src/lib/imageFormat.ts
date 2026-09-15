/**
 * Byte-level image format sniffing shared by browser upload validation and the
 * Node processing endpoint. Pure functions over bytes: no Blob, DOM or Node
 * APIs, so both runtimes can use the same rules.
 */

export type SniffedImageFormat = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export function sniffImageFormat(bytes: Uint8Array): SniffedImageFormat | undefined {
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	)
		return 'image/png';
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
		return 'image/jpeg';
	if (isWebp(bytes)) return 'image/webp';
	if (isGif(bytes)) return 'image/gif';
	return undefined;
}

export function isGif(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 6 &&
		ascii(bytes, 0, 3) === 'GIF' &&
		(ascii(bytes, 3, 3) === '87a' || ascii(bytes, 3, 3) === '89a')
	);
}

export function isWebp(bytes: Uint8Array): boolean {
	return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
}

/** APNG animation-control chunk before the first IDAT. */
export function isAnimatedPng(bytes: Uint8Array): boolean {
	if (sniffImageFormat(bytes) !== 'image/png' || bytes.length < 24) return false;
	let offset = 8;
	while (offset + 8 <= bytes.length) {
		const length = readU32be(bytes, offset);
		const type = ascii(bytes, offset + 4, 4);
		if (type === 'acTL') return true;
		if (type === 'IDAT' || type === 'IEND') return false;
		const next = offset + 12 + length;
		if (next <= offset) break;
		offset = next;
	}
	return false;
}

/** WebP ANIM chunk or the VP8X animation flag. */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
	if (!isWebp(bytes)) return false;
	let offset = 12;
	while (offset + 8 <= bytes.length) {
		const fourcc = ascii(bytes, offset, 4);
		const size = readU32le(bytes, offset + 4);
		if (fourcc === 'ANIM') return true;
		if (fourcc === 'VP8X' && offset + 9 <= bytes.length && (bytes[offset + 8]! & 0x02) !== 0)
			return true;
		const padded = size + (size & 1);
		offset += 8 + padded;
		if (padded < 0) break;
	}
	return false;
}

/** True when the bytes look like XML/SVG markup. */
export function looksLikeSvgMarkup(bytes: Uint8Array): boolean {
	if (sniffImageFormat(bytes)) return false;
	const header = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
	if (header.startsWith('<svg')) return true;
	const prolog = header.startsWith('<?xml') || header.startsWith('<!doctype');
	return prolog && header.includes('<svg');
}

/** PNG dimensions from IHDR without decoding pixels. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
	if (sniffImageFormat(bytes) !== 'image/png' || bytes.length < 24) return undefined;
	const width = readU32be(bytes, 16);
	const height = readU32be(bytes, 20);
	return width > 0 && height > 0 ? { width, height } : undefined;
}

/** WebP dimensions from VP8X/VP8/VP8L without decoding pixels. */
export function webpDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
	if (!isWebp(bytes)) return undefined;
	let offset = 12;
	while (offset + 8 <= bytes.length) {
		const fourcc = ascii(bytes, offset, 4);
		const size = readU32le(bytes, offset + 4);
		const data = offset + 8;
		if (fourcc === 'VP8X' && data + 10 <= bytes.length) {
			const width = 1 + (bytes[data + 4]! | (bytes[data + 5]! << 8) | (bytes[data + 6]! << 16));
			const height = 1 + (bytes[data + 7]! | (bytes[data + 8]! << 8) | (bytes[data + 9]! << 16));
			return { width, height };
		}
		if (fourcc === 'VP8 ' && data + 10 <= bytes.length) {
			if (bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
				const width = (bytes[data + 6]! | (bytes[data + 7]! << 8)) & 0x3fff;
				const height = (bytes[data + 8]! | (bytes[data + 9]! << 8)) & 0x3fff;
				if (width > 0 && height > 0) return { width, height };
			}
		}
		if (fourcc === 'VP8L' && data + 5 <= bytes.length && bytes[data] === 0x2f) {
			const bits =
				bytes[data + 1]! |
				(bytes[data + 2]! << 8) |
				(bytes[data + 3]! << 16) |
				(bytes[data + 4]! << 24);
			const width = 1 + (bits & 0x3fff);
			const height = 1 + ((bits >>> 14) & 0x3fff);
			return { width, height };
		}
		const padded = size + (size & 1);
		if (padded < 0) break;
		offset = data + padded;
	}
	return undefined;
}

export function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export function readU32le(bytes: Uint8Array, offset: number): number {
	return (
		bytes[offset]! +
		(bytes[offset + 1]! << 8) +
		(bytes[offset + 2]! << 16) +
		(bytes[offset + 3]! << 24)
	);
}

export function readU32be(bytes: Uint8Array, offset: number): number {
	return (
		((bytes[offset]! << 24) |
			(bytes[offset + 1]! << 16) |
			(bytes[offset + 2]! << 8) |
			bytes[offset + 3]!) >>>
		0
	);
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

/** Standard CRC-32 (PNG chunk / ZIP). */
export function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

export type ImageInspection = {
	width: number;
	height: number;
	format: 'image/png' | 'image/webp' | 'image/jpeg';
};

/**
 * Structural validation and dimensions for static images, without a full
 * pixel decode: PNG chunks are walked and CRC-checked, WebP container sizes and
 * animation flags are verified, JPEG SOF markers and the EOI trailer are
 * required. Returns undefined for anything that is not a decodable static
 * image, so callers can reject truncated or spoofed media.
 */
export function inspectImageBytes(bytes: Uint8Array): ImageInspection | undefined {
	const format = sniffImageFormat(bytes);
	if (format === 'image/png') {
		const dimensions = inspectPngStructure(bytes);
		return dimensions ? { ...dimensions, format } : undefined;
	}
	if (format === 'image/webp') {
		if (bytes.length < 20 || readU32le(bytes, 4) + 8 !== bytes.length || isAnimatedWebp(bytes))
			return undefined;
		const dimensions = webpDimensions(bytes);
		return dimensions ? { ...dimensions, format } : undefined;
	}
	if (format === 'image/jpeg') {
		const dimensions = jpegDimensions(bytes);
		if (!dimensions) return undefined;
		if (bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)
			return undefined;
		return { ...dimensions, format };
	}
	return undefined;
}

function inspectPngStructure(bytes: Uint8Array): { width: number; height: number } | undefined {
	if (bytes.length < 33) return undefined;
	let offset = 8;
	let width = 0;
	let height = 0;
	let hasIHDR = false;
	let hasIDAT = false;
	let chunkIndex = 0;
	while (offset + 12 <= bytes.length) {
		const length = readU32be(bytes, offset);
		const type = ascii(bytes, offset + 4, 4);
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		if (dataEnd + 4 > bytes.length) return undefined;
		if (readU32be(bytes, dataEnd) !== crc32(bytes.subarray(offset + 4, dataEnd))) return undefined;
		if (chunkIndex === 0 && type !== 'IHDR') return undefined;
		if (type === 'IHDR') {
			if (length !== 13 || hasIHDR) return undefined;
			hasIHDR = true;
			width = readU32be(bytes, dataStart);
			height = readU32be(bytes, dataStart + 4);
		} else if (type === 'IDAT' && length > 0) {
			hasIDAT = true;
		} else if (type === 'IEND') {
			if (length !== 0) return undefined;
			offset = dataEnd + 4;
			if (!hasIHDR || !hasIDAT) return undefined;
			if (offset !== bytes.length) return undefined;
			return width > 0 && height > 0 ? { width, height } : undefined;
		}
		offset = dataEnd + 4;
		chunkIndex += 1;
	}
	return undefined;
}

/** JPEG dimensions from the first SOF marker; supports baseline and progressive. */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
	let offset = 2;
	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) {
			offset += 1;
			continue;
		}
		let marker = bytes[offset + 1]!;
		while (marker === 0xff && offset + 2 < bytes.length) {
			offset += 1;
			marker = bytes[offset + 1]!;
		}
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			offset += 2;
			continue;
		}
		const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
		if (length < 2) return undefined;
		const isSof =
			marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isSof) {
			const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
			const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
			return width > 0 && height > 0 ? { width, height } : undefined;
		}
		if (marker === 0xda) return undefined;
		offset += 2 + length;
	}
	return undefined;
}
