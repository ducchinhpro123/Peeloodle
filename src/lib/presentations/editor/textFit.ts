/**
 * Pure text-fitting geometry for presentation text elements.
 *
 * Automatic growth and explicit shrink-to-fit both resolve into stored
 * geometry/font sizes so history, save, canvas, raster/PDF and PPTX all consume
 * one result. These helpers consume parser-validated elements (finite geometry,
 * at least one run, positive sizes); do not call them on raw imported JSON.
 *
 * They never mutate their input: callers receive either the same element
 * reference (nothing to do) or a new element to commit.
 */

import type { PresentationDocument, TextElement } from '../model/types';
import { layoutTextElement, type MeasureText } from '../rendering/textLayout';

type Page = PresentationDocument['pageSize'];

/**
 * True when every corner of the (possibly rotated) box stays on the page within
 * a hundredth of a document unit. The document coordinate system is 1280 × 720,
 * independent of viewport zoom.
 */
export function textBoxInsidePage(element: TextElement, page: Page): boolean {
	const radians = (element.rotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const corners: Array<[number, number]> = [
		[0, 0],
		[element.width, 0],
		[0, element.height],
		[element.width, element.height]
	];
	return corners.every(([x, y]) => {
		const px = element.x + x * cos - y * sin;
		const py = element.y + x * sin + y * cos;
		return px >= -0.01 && py >= -0.01 && px <= page.width + 0.01 && py <= page.height + 0.01;
	});
}

/**
 * Grows an auto-growing box's height to fit its measured content, keeping x/y,
 * width, rotation, padding and every authored font size untouched. Growth is
 * capped at the largest height whose rotated corners stay on the slide; if the
 * box already starts outside the page, it is returned unchanged. Deleting text
 * never shrinks the box: the stored height is a floor.
 */
export function growTextToFit(element: TextElement, page: Page, measure: MeasureText): TextElement {
	const required = Math.ceil(
		layoutTextElement(element, measure).contentHeight + element.padding * 2
	);
	if (required <= element.height || !textBoxInsidePage(element, page)) return element;
	const full = { ...element, height: required };
	if (textBoxInsidePage(full, page)) return full;
	let low = element.height;
	let high = required;
	for (let i = 0; i < 24; i++) {
		const height = (low + high) / 2;
		if (textBoxInsidePage({ ...element, height }, page)) low = height;
		else high = height;
	}
	const height = Math.max(element.height, Math.floor(low));
	return height === element.height ? element : { ...element, height };
}

/**
 * Finds the largest uniform factor that makes the text fit its box without
 * overflowing, switching the element to fixed mode. Every run keeps its
 * relative size and all non-size attributes. No run is reduced below
 * `min(12, its current size)`; when no fit exists at that floor the function
 * returns null and the caller must leave the document unchanged.
 */
export function shrinkTextToFit(element: TextElement, measure: MeasureText): TextElement | null {
	const scale = (factor: number): TextElement => ({
		...element,
		autoGrow: false,
		paragraphs: element.paragraphs.map((paragraph) => ({
			...paragraph,
			runs: paragraph.runs.map((run) => ({ ...run, size: run.size * factor }))
		}))
	});
	const fits = (candidate: TextElement) => {
		const result = layoutTextElement(candidate, measure);
		return (
			!result.overflow && result.lines.every((line) => line.width <= line.availableWidth + 0.01)
		);
	};
	if (fits(element)) return scale(1);
	const runs = element.paragraphs.flatMap((paragraph) => paragraph.runs);
	if (!runs.length) return null;
	const floor = Math.max(...runs.map((run) => Math.min(12, run.size) / run.size));
	let low = floor;
	let high = 1;
	if (!fits(scale(low))) return null;
	for (let i = 0; i < 24; i++) {
		const middle = (low + high) / 2;
		if (fits(scale(middle))) low = middle;
		else high = middle;
	}
	return scale(low);
}
