import { describe, expect, it } from 'vitest';
import {
	documentPointFromView,
	elementWorldCenter,
	MIN_ELEMENT_SIZE,
	moveTransform,
	nextRotationStep,
	normalizeTransform,
	resizeTransform,
	rotateTransform,
	rotationDelta,
	rotationFromPoint,
	transformFrameInView,
	withRotation,
	type ResizeHandle,
	type TransformGeometry,
	type ViewPoint
} from './transformGeometry';

/**
 * Local (0…width, 0…height) point of a rotated element in document units. The
 * tests state their expectations through the frame definition itself instead of
 * repeating the resize math.
 */
function localPoint(geometry: TransformGeometry, local: ViewPoint): ViewPoint {
	const theta = (geometry.rotation * Math.PI) / 180;
	const cos = Math.cos(theta);
	const sin = Math.sin(theta);
	return {
		x: geometry.x + local.x * cos - local.y * sin,
		y: geometry.y + local.x * sin + local.y * cos
	};
}

/** The four resize handles with the corner each one pins and the way it drags. */
const RESIZE_CASES: Array<{ handle: ResizeHandle; fixed: ViewPoint; direction: ViewPoint }> = [
	{ handle: 'se', fixed: { x: 0, y: 0 }, direction: { x: 1, y: 1 } },
	{ handle: 'nw', fixed: { x: 200, y: 100 }, direction: { x: -1, y: -1 } },
	{ handle: 'ne', fixed: { x: 0, y: 100 }, direction: { x: 1, y: -1 } },
	{ handle: 'sw', fixed: { x: 200, y: 0 }, direction: { x: -1, y: 1 } }
];

describe('transformGeometry', () => {
	it('maps element frames into view pixels with the shared viewport scale', () => {
		const element = { x: 100, y: 200, width: 400, height: 200, rotation: 0 };
		expect(transformFrameInView(element, { scale: 0.75, x: 40, y: -10 })).toEqual({
			x: 115,
			y: 140,
			width: 300,
			height: 150,
			rotation: 0
		});
	});

	it('reads a pointer back in document units, so the same drag fits every zoom', () => {
		const element = { x: 100, y: 200, width: 400, height: 200, rotation: 0 };
		const frame = transformFrameInView(element, { scale: 0.75, x: 40, y: -10 });
		expect(
			documentPointFromView({ x: frame.x, y: frame.y }, { scale: 0.75, x: 40, y: -10 })
		).toEqual({ x: 100, y: 200 });
		// A 25% larger viewport scale maps the same document point to a different pixel.
		const zoomedIn = { scale: 1.5, x: -100, y: 20 };
		expect(documentPointFromView({ x: -100 + 150, y: 20 + 300 }, zoomedIn)).toEqual({
			x: 100,
			y: 200
		});
	});

	it('moves an element by the document-space pointer delta', () => {
		const start = { x: 100, y: 200, width: 400, height: 200, rotation: 0 };
		expect(moveTransform(start, { x: 40.2, y: -12.6 })).toEqual({
			x: 140,
			y: 187,
			width: 400,
			height: 200,
			rotation: 0
		});
		expect(moveTransform(start, { x: 0, y: 0 })).toEqual(start);
	});

	it('resizes from a corner handle and keeps the opposite corner fixed', () => {
		const start = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
		// The south-east corner follows the pointer; the north-west origin stays put.
		expect(resizeTransform(start, 'se', { x: 340, y: 230 })).toEqual({
			x: 100,
			y: 100,
			width: 240,
			height: 130,
			rotation: 0
		});
		// Dragging the north-west corner keeps the south-east corner fixed instead.
		expect(resizeTransform(start, 'nw', { x: 80, y: 70 })).toEqual({
			x: 80,
			y: 70,
			width: 220,
			height: 130,
			rotation: 0
		});
	});

	it('resizes a rotated element along its own axes, still pinning the opposite corner', () => {
		const start = { x: 100, y: 100, width: 200, height: 100, rotation: 90 };
		expect(resizeTransform(start, 'se', { x: -30, y: 340 })).toEqual({
			x: 100,
			y: 100,
			width: 240,
			height: 130,
			rotation: 90
		});
	});

	it('never lets a resize collapse the element below a usable size', () => {
		const start = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
		expect(resizeTransform(start, 'se', { x: 100, y: 100 })).toEqual({
			x: 100,
			y: 100,
			width: MIN_ELEMENT_SIZE,
			height: MIN_ELEMENT_SIZE,
			rotation: 0
		});
	});

	it('clamps a resize that crosses the opposite corner instead of flipping the element', () => {
		const start = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
		// Dragging the south-east corner past the pinned north-west corner must not
		// turn the element inside out: it stops at the smallest usable box there.
		expect(resizeTransform(start, 'se', { x: 60, y: 60 })).toEqual({
			x: 100,
			y: 100,
			width: MIN_ELEMENT_SIZE,
			height: MIN_ELEMENT_SIZE,
			rotation: 0
		});
		// Crossing only one corner leaves the other axis following the pointer.
		expect(resizeTransform(start, 'se', { x: 60, y: 240 })).toEqual({
			x: 100,
			y: 100,
			width: MIN_ELEMENT_SIZE,
			height: 140,
			rotation: 0
		});
		// Whichever corner is dragged, the opposite one stays pinned.
		expect(resizeTransform(start, 'nw', { x: 340, y: 240 })).toEqual({
			x: 292,
			y: 192,
			width: MIN_ELEMENT_SIZE,
			height: MIN_ELEMENT_SIZE,
			rotation: 0
		});
		expect(resizeTransform(start, 'ne', { x: 60, y: 240 })).toEqual({
			x: 100,
			y: 192,
			width: MIN_ELEMENT_SIZE,
			height: MIN_ELEMENT_SIZE,
			rotation: 0
		});
		expect(resizeTransform(start, 'sw', { x: 340, y: 60 })).toEqual({
			x: 292,
			y: 100,
			width: MIN_ELEMENT_SIZE,
			height: MIN_ELEMENT_SIZE,
			rotation: 0
		});
	});

	it('resizes from every corner at an arbitrary rotation, pinned and never flipped', () => {
		const start = { x: 120, y: 90, width: 200, height: 100, rotation: 37 };
		const theta = (start.rotation * Math.PI) / 180;
		const u = { x: Math.cos(theta), y: Math.sin(theta) };
		const v = { x: -Math.sin(theta), y: Math.cos(theta) };
		const fixedLocal = (width: number, height: number, fixed: ViewPoint) => {
			return { x: fixed.x === 0 ? 0 : width, y: fixed.y === 0 ? 0 : height };
		};

		for (const { handle, fixed, direction } of RESIZE_CASES) {
			const pinned = localPoint(start, fixed);
			// The pointer lands on the corner a grown element would have: 240 × 120.
			const pointer = {
				x: pinned.x + direction.x * 240 * u.x + direction.y * 120 * v.x,
				y: pinned.y + direction.x * 240 * u.y + direction.y * 120 * v.y
			};
			const grown = resizeTransform(start, handle, pointer);
			expect({ width: grown.width, height: grown.height, rotation: grown.rotation }).toEqual({
				width: 240,
				height: 120,
				rotation: 37
			});
			const grownPinned = localPoint(grown, fixedLocal(240, 120, fixed));
			expect(Math.abs(grownPinned.x - pinned.x)).toBeLessThanOrEqual(0.75);
			expect(Math.abs(grownPinned.y - pinned.y)).toBeLessThanOrEqual(0.75);
			const dragged = localPoint(grown, {
				x: direction.x > 0 ? 240 : 0,
				y: direction.y > 0 ? 120 : 0
			});
			expect(Math.abs(dragged.x - pointer.x)).toBeLessThanOrEqual(0.75);
			expect(Math.abs(dragged.y - pointer.y)).toBeLessThanOrEqual(0.75);

			// Dragged past the pinned corner, the same handle stops at the minimum
			// size with the pinned corner still in place — on both axes.
			const crossedPointer = {
				x: pinned.x - direction.x * 80 * u.x - direction.y * 60 * v.x,
				y: pinned.y - direction.x * 80 * u.y - direction.y * 60 * v.y
			};
			const crossed = resizeTransform(start, handle, crossedPointer);
			expect({ width: crossed.width, height: crossed.height, rotation: crossed.rotation }).toEqual({
				width: MIN_ELEMENT_SIZE,
				height: MIN_ELEMENT_SIZE,
				rotation: 37
			});
			const crossedPinned = localPoint(
				crossed,
				fixedLocal(MIN_ELEMENT_SIZE, MIN_ELEMENT_SIZE, fixed)
			);
			expect(Math.abs(crossedPinned.x - pinned.x)).toBeLessThanOrEqual(0.75);
			expect(Math.abs(crossedPinned.y - pinned.y)).toBeLessThanOrEqual(0.75);
		}
	});

	it('rotates an element around its centre and leaves that centre where it was', () => {
		const start = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
		// Centre (200, 150): a quarter turn moves the origin to (250, 50).
		expect(rotateTransform(start, 90)).toEqual({
			x: 250,
			y: 50,
			width: 200,
			height: 100,
			rotation: 90
		});
		expect(rotationFromPoint({ x: 200, y: 150 }, { x: 200, y: 50 })).toBe(-90);
	});

	it('keeps the visual centre when an element that is already rotated turns again', () => {
		// After the quarter turn above, the stored origin is (250, 50) and the
		// element's visual centre is still (200, 150) — not (350, 100).
		const start = { x: 250, y: 50, width: 200, height: 100, rotation: 90 };
		expect(elementWorldCenter(start)).toEqual({ x: 200, y: 150 });
		const turned = rotateTransform(start, 90);
		expect(turned).toEqual({ x: 300, y: 200, width: 200, height: 100, rotation: 180 });
		expect(elementWorldCenter(turned)).toEqual({ x: 200, y: 150 });
	});

	it('keeps the visual centre when the numeric field replaces the angle', () => {
		const start = { x: 200, y: 200, width: 320, height: 160, rotation: 0 };
		expect(elementWorldCenter(start)).toEqual({ x: 360, y: 280 });
		// A quarter turn moves the stored origin to (440, 120) around centre (360, 280).
		expect(withRotation(start, 90)).toEqual({
			x: 440,
			y: 120,
			width: 320,
			height: 160,
			rotation: 90
		});
		expect(elementWorldCenter(withRotation(start, 90))).toEqual({ x: 360, y: 280 });
		expect(rotateTransform(start, 90)).toEqual(withRotation(start, 90));
		expect(withRotation(start, -30).rotation).toBe(330);
	});

	it('preserves the visual centre from an arbitrary starting angle', () => {
		const start = { x: 120, y: 60, width: 240, height: 120, rotation: 37 };
		const centre = elementWorldCenter(start);
		const turned = rotateTransform(start, 106);
		expect(turned.rotation).toBe(143);
		// Only the stored origin is rounded, so the centre holds within half a unit.
		expect(Math.abs(elementWorldCenter(turned).x - centre.x)).toBeLessThanOrEqual(0.5);
		expect(Math.abs(elementWorldCenter(turned).y - centre.y)).toBeLessThanOrEqual(0.5);
	});

	it('takes the shortest way round when a rotation crosses the half turn', () => {
		expect(rotationDelta(-170, 170)).toBe(-20);
		expect(rotationDelta(170, -170)).toBe(20);
		expect(rotationDelta(-90, 0)).toBe(90);
	});

	it('accumulates successive shortest turns so a continuous rotation keeps turning', () => {
		// Each pointer move adds the shortest turn from the previous angle: crossing
		// ±180° keeps the same direction instead of snapping back to the gesture's
		// first angle, and the total may pass a half turn.
		let step = nextRotationStep(170, -170, 0);
		expect(step).toEqual({ angle: -170, accumulated: 20 });
		step = nextRotationStep(step.angle, -90, step.accumulated);
		expect(step.accumulated).toBe(100);
		step = nextRotationStep(step.angle, -10, step.accumulated);
		expect(step.accumulated).toBe(180);
		step = nextRotationStep(step.angle, 80, step.accumulated);
		expect(step.accumulated).toBe(270);
	});

	it('refuses unusable geometry and clamps what it accepts', () => {
		expect(normalizeTransform({ x: 10, y: 10, width: 0, height: 4, rotation: -30 })).toEqual({
			x: 10,
			y: 10,
			width: MIN_ELEMENT_SIZE,
			height: MIN_ELEMENT_SIZE,
			rotation: 330
		});
		expect(
			normalizeTransform({ x: 0.4, y: 0.6, width: 10.4, height: 10, rotation: 45.26 })
		).toEqual({ x: 0, y: 1, width: 10, height: 10, rotation: 45.3 });
		expect(
			normalizeTransform({ x: Number.NaN, y: 0, width: 10, height: 10, rotation: 0 })
		).toBeNull();
		expect(
			normalizeTransform({ x: 0, y: 0, width: 10, height: 10, rotation: Number.POSITIVE_INFINITY })
		).toBeNull();
	});
});
