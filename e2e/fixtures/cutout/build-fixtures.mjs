/**
 * Builds the background-removal E2E fixtures (run: `node e2e/fixtures/cutout/build-fixtures.mjs`).
 *
 * Each subject (a template photo with its own alpha) is composited at 1024×1024
 * onto two deterministic backgrounds (seed 42):
 * - `<name>.png` (gating): a realistic background, seeded colour noise blurred
 *   into soft blobs.
 * - `<name>.clutter.png` (non-gating benchmark): the same background plus 40
 *   random flat filled circles and rectangles.
 * `<name>.truth.png` is the subject's alpha as grayscale, shared by both
 * variants; `no-subject.png` is the realistic background alone.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SIZE = 1024;
const SEED = 42;
const SHAPES = 40;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const SUBJECTS = ['peace-selfie', 'sunny-corgi', 'boba-tea'];

/** mulberry32: a tiny deterministic PRNG. */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Returns the realistic background and the cluttered one built on top of it. */
async function buildBackgrounds() {
	const random = rng(SEED);
	// Coarse colour noise (64×64 cells) upscaled and blurred into soft blobs.
	const cells = 64;
	const noise = Buffer.alloc(cells * cells * 3);
	for (let i = 0; i < noise.length; i += 1) noise[i] = Math.floor(random() * 256);
	const base = await sharp(noise, { raw: { width: cells, height: cells, channels: 3 } })
		.resize(SIZE, SIZE, { kernel: 'cubic' })
		.blur(6)
		.raw()
		.toBuffer();

	const pixels = Buffer.from(base);
	for (let s = 0; s < SHAPES; s += 1) {
		const colour = [0, 1, 2].map(() => Math.floor(random() * 256));
		const circle = random() < 0.5;
		const cx = random() * SIZE;
		const cy = random() * SIZE;
		const a = 20 + random() * 140;
		const b = 20 + random() * 140;
		const x0 = Math.max(0, Math.floor(cx - a));
		const x1 = Math.min(SIZE - 1, Math.ceil(cx + a));
		const y0 = Math.max(0, Math.floor(cy - (circle ? a : b)));
		const y1 = Math.min(SIZE - 1, Math.ceil(cy + (circle ? a : b)));
		for (let y = y0; y <= y1; y += 1) {
			for (let x = x0; x <= x1; x += 1) {
				if (circle && (x - cx) ** 2 + (y - cy) ** 2 > a * a) continue;
				const i = (y * SIZE + x) * 3;
				pixels[i] = colour[0];
				pixels[i + 1] = colour[1];
				pixels[i + 2] = colour[2];
			}
		}
	}
	return { realistic: base, clutter: pixels };
}

const { realistic, clutter } = await buildBackgrounds();
const raw = { raw: { width: SIZE, height: SIZE, channels: 3 } };
const png = { compressionLevel: 9, effort: 10 };

writeFileSync(path.join(here, 'no-subject.png'), await sharp(realistic, raw).png(png).toBuffer());

for (const name of SUBJECTS) {
	const source = path.join(root, 'static/art/template-photos', `${name}.webp`);
	const subject = await sharp(source)
		.resize(SIZE, SIZE, { fit: 'fill' })
		.ensureAlpha()
		.png()
		.toBuffer();
	for (const [suffix, background] of [
		['', realistic],
		['.clutter', clutter]
	]) {
		const composite = await sharp(background, raw)
			.composite([{ input: subject }])
			.removeAlpha()
			.png(png)
			.toBuffer();
		writeFileSync(path.join(here, `${name}${suffix}.png`), composite);
	}
	const truth = await sharp(subject).extractChannel('alpha').png(png).toBuffer();
	writeFileSync(path.join(here, `${name}.truth.png`), truth);
}
console.log(`Wrote ${SUBJECTS.length * 3 + 1} fixtures to ${path.relative(root, here)}`);
