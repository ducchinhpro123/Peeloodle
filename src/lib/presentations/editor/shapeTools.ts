/**
 * Shape insertion presets for the presentation editor.
 *
 * A toolbar click must produce a visible, centred element without a pointer
 * drag, so this module owns only the per-kind size, label and line styling.
 * Everything else (accent fill, rotation, opacity, visibility, id) stays in
 * `createShapeElement` so there is a single spelling of "a new shape".
 */

import { DEFAULT_THEME, createShapeElement } from '../model/factories';
import type { ShapeElement, ShapeKind } from '../model/types';

/** The kinds the shape toolbar can insert; the union itself belongs to the document model. */
export type ShapeInsertKind = ShapeKind;

/** Document units. Blocks match the 16:9 page; lines span a shallower diagonal. */
const INSERT_SIZE: Record<ShapeInsertKind, { width: number; height: number }> = {
	rectangle: { width: 480, height: 270 },
	'rounded-rectangle': { width: 480, height: 270 },
	ellipse: { width: 480, height: 270 },
	line: { width: 480, height: 160 },
	arrow: { width: 480, height: 160 }
};

const INSERT_LABEL: Record<ShapeInsertKind, string> = {
	rectangle: 'Rectangle',
	'rounded-rectangle': 'Rounded rectangle',
	ellipse: 'Ellipse',
	line: 'Line',
	arrow: 'Arrow'
};

export function createSlideShape(
	kind: ShapeInsertKind,
	pageSize: { width: number; height: number },
	options: { name?: string } = {}
): ShapeElement {
	const { width, height } = INSERT_SIZE[kind];
	const common = {
		shape: kind,
		name: options.name ?? INSERT_LABEL[kind],
		x: Math.round((pageSize.width - width) / 2),
		y: Math.round((pageSize.height - height) / 2),
		width,
		height
	};

	// `renderShape` draws a line/arrow as the diagonal (0,0)->(width,height), so a
	// fill would paint the whole triangle between the points; linear kinds get a
	// stroke, while blocks rely on the factory's accent fill and no outline.
	return createShapeElement(
		kind === 'line' || kind === 'arrow'
			? { ...common, fill: null, stroke: DEFAULT_THEME.colors.text ?? '#08152f', strokeWidth: 4 }
			: { ...common, stroke: null, strokeWidth: 0 }
	);
}
