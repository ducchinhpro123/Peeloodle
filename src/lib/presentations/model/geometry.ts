/**
 * Geometry conversions between presentation document units and physical units.
 *
 * Document units are 1/96 inch (CSS px at 100% zoom), matching the architecture
 * contract: a 1280×720 document is 13⅓×7½ inches (standard 16:9 PowerPoint) and
 * 960×540 points. Font sizes are stored in document units and convert to points
 * with the same ratio. Conversions are centralized here.
 */

import { PRESENTATION_PAGE_HEIGHT, PRESENTATION_PAGE_WIDTH } from './types';

export const UNITS_PER_INCH = 96;
export const POINTS_PER_INCH = 72;

export function unitsToInches(units: number): number {
	return units / UNITS_PER_INCH;
}

export function inchesToUnits(inches: number): number {
	return inches * UNITS_PER_INCH;
}

export function unitsToPoints(units: number): number {
	return (units * POINTS_PER_INCH) / UNITS_PER_INCH;
}

export function pointsToUnits(points: number): number {
	return (points * UNITS_PER_INCH) / POINTS_PER_INCH;
}

/** PPTX/PDF page size in inches: 40/3 × 15/2 (13.333…×7.5). */
export function pageSizeInInches(): { width: number; height: number } {
	return {
		width: unitsToInches(PRESENTATION_PAGE_WIDTH),
		height: unitsToInches(PRESENTATION_PAGE_HEIGHT)
	};
}

/** PDF page size in points: 960×540. */
export function pageSizeInPoints(): { width: number; height: number } {
	return {
		width: unitsToPoints(PRESENTATION_PAGE_WIDTH),
		height: unitsToPoints(PRESENTATION_PAGE_HEIGHT)
	};
}
