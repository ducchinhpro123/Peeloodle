export type PresentationViewport = {
	scale: number;
	x: number;
	y: number;
};

/** One shared zoom range for wheel, buttons, and any future gesture entry point. */
export const PRESENTATION_MIN_ZOOM = 0.25;
export const PRESENTATION_MAX_ZOOM = 4;

export function clampPresentationZoom(zoom: number): number {
	return Math.min(PRESENTATION_MAX_ZOOM, Math.max(PRESENTATION_MIN_ZOOM, zoom));
}

/**
 * Limits a pan so at least `keep` of the slide's width and height stays inside
 * the viewport: the slide can be moved aside but never lost.
 */
export function clampPresentationPan(
	viewport: { width: number; height: number },
	page: { width: number; height: number },
	zoom: number,
	pan: { x: number; y: number },
	keep = 0.25
): { x: number; y: number } {
	const { scale } = presentationViewport(viewport, page, zoom, { x: 0, y: 0 });
	const axis = (value: number, view: number, length: number) => {
		const size = length * scale;
		const centred = (view - size) / 2;
		const min = keep * size - size - centred;
		const max = view - keep * size - centred;
		return Math.min(max, Math.max(min, value));
	};
	return {
		x: axis(pan.x, viewport.width, page.width),
		y: axis(pan.y, viewport.height, page.height)
	};
}

/** Maps fixed document units into a viewport without changing the document. */
export function presentationViewport(
	viewport: { width: number; height: number },
	page: { width: number; height: number },
	zoom: number,
	pan: { x: number; y: number }
): PresentationViewport {
	const fit =
		viewport.width > 0 && viewport.height > 0
			? Math.min(viewport.width / page.width, viewport.height / page.height)
			: 1;
	const scale = fit * zoom;
	return {
		scale,
		x: (viewport.width - page.width * scale) / 2 + pan.x,
		y: (viewport.height - page.height * scale) / 2 + pan.y
	};
}
