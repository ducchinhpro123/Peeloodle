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
