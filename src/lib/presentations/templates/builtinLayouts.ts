/**
 * Five built-in slide layouts, assembled from ordinary editable elements.
 *
 * No media, no master-slide engine and no catalog connection: each factory call
 * returns a fresh asset-free slide whose text boxes use the theme presets (theme
 * fonts/colors, automatic height growth) and whose image area is an ordinary
 * rectangle, so offline insertion works and the content stays editable.
 */

import { createSlide, createShapeElement, DEFAULT_THEME } from '../model/factories';
import { createPresetText, type TextPreset } from '../editor/textPresets';
import type { Element, Slide, Theme } from '../model/types';

export const BUILTIN_LAYOUTS = [
	{ id: 'title', name: 'Title slide' },
	{ id: 'title-body', name: 'Title + body' },
	{ id: 'two-columns', name: 'Two columns' },
	{ id: 'section', name: 'Section header' },
	{ id: 'image-caption', name: 'Image + caption' }
] as const;

export type BuiltinLayoutId = (typeof BUILTIN_LAYOUTS)[number]['id'];

export function createBuiltinLayout(id: BuiltinLayoutId, theme: Theme): Slide {
	const text = (
		preset: TextPreset,
		content: string,
		x: number,
		y: number,
		width: number,
		height: number
	) => ({ ...createPresetText(preset, theme, content), x, y, width, height });
	let elements: Element[];
	switch (id) {
		case 'title':
			elements = [
				text('heading', 'Presentation title', 80, 224, 1120, 104),
				text('subheading', 'Add a subtitle', 80, 344, 1120, 80)
			];
			break;
		case 'title-body':
			elements = [
				text('heading', 'Slide heading', 80, 56, 1120, 104),
				text('body', 'Add your main points', 80, 200, 1120, 400)
			];
			break;
		case 'two-columns':
			elements = [
				text('heading', 'Slide heading', 80, 56, 1120, 104),
				text('body', 'Left column', 80, 200, 536, 400),
				text('body', 'Right column', 664, 200, 536, 400)
			];
			break;
		case 'section':
			elements = [
				text('heading', 'Section heading', 80, 264, 1120, 112),
				text('subheading', 'Introduce this section', 80, 400, 1120, 80)
			];
			break;
		case 'image-caption':
			elements = [
				createShapeElement({
					name: 'Image area',
					x: 160,
					y: 64,
					width: 960,
					height: 480,
					fill: theme.colors.surface ?? '#eef2f0',
					stroke: theme.colors.accent ?? DEFAULT_THEME.colors.accent!,
					strokeWidth: 2
				}),
				text('body', 'Add a caption', 160, 568, 960, 88)
			];
			break;
	}
	return {
		...createSlide({
			name: BUILTIN_LAYOUTS.find((layout) => layout.id === id)!.name,
			background: theme.colors.background ?? DEFAULT_THEME.colors.background!
		}),
		elements
	};
}
