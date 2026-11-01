/**
 * Where an image layer's photo sits on screen, relative to the canvas host, so
 * DOM overlays (the cutout scan, the reveal and the floating canvas action) line
 * up with it through zoom, pan, rotation, flip and outline padding.
 *
 * An image node draws its raster at local (0, 0) and is offset by the outline
 * padding, so the photo itself spans local (offset, offset) → (width − offset,
 * height − offset). `matrix` maps that photo rect's local units to host pixels.
 */
import type Konva from 'konva';

export type Matrix = [number, number, number, number, number, number];

export type ScreenBox = {
	/** CSS `matrix()` for an element of `width` × `height` with `transform-origin: 0 0`. */
	matrix: Matrix;
	width: number;
	height: number;
	/** Axis-aligned bounds in host pixels, for things that must not rotate. */
	bounds: { x: number; y: number; width: number; height: number };
};

/** The photo rect (excluding outline padding) of an image node, or null if it has no size. */
export function photoScreenBox(node: Konva.Node): ScreenBox | null {
	const offsetX = node.offsetX();
	const offsetY = node.offsetY();
	const width = node.width() - offsetX * 2;
	const height = node.height() - offsetY * 2;
	if (!(width > 0 && height > 0)) return null;
	const transform = node.getAbsoluteTransform().copy().translate(offsetX, offsetY);
	return boxFrom(transform, width, height);
}

/** The whole raster rect (including outline padding), matching what the node draws. */
export function rasterScreenBox(node: Konva.Node): ScreenBox | null {
	const width = node.width();
	const height = node.height();
	if (!(width > 0 && height > 0)) return null;
	return boxFrom(node.getAbsoluteTransform().copy(), width, height);
}

function boxFrom(transform: Konva.Transform, width: number, height: number): ScreenBox {
	const corners = [
		transform.point({ x: 0, y: 0 }),
		transform.point({ x: width, y: 0 }),
		transform.point({ x: 0, y: height }),
		transform.point({ x: width, y: height })
	];
	const xs = corners.map((point) => point.x);
	const ys = corners.map((point) => point.y);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return {
		matrix: transform.getMatrix() as Matrix,
		width,
		height,
		bounds: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
	};
}

/** True when two boxes would render identically (avoids reactive churn every frame). */
export function sameBox(a: ScreenBox | null, b: ScreenBox | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	if (a.width !== b.width || a.height !== b.height) return false;
	return a.matrix.every((value, index) => Math.abs(value - b.matrix[index]) < 0.01);
}

export function cssMatrix(box: ScreenBox): string {
	return `matrix(${box.matrix.join(',')})`;
}
