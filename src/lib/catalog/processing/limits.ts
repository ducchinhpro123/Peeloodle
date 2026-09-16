/**
 * Centralized processing limits (P56/P57).
 *
 * Starting engineering defaults, matching the app's existing upload limits
 * (15 MB, 25 MP) and the architecture document's raster/SVG bounds. They are not
 * measured capacity claims: adjust after representative fixtures and record the
 * change in the milestone checkpoint.
 */
export const PROCESSING_LIMITS = {
	raster: {
		maxSourceBytes: 15 * 1024 * 1024,
		maxPixels: 25_000_000,
		maxSourceDimension: 20_000,
		/** Longest edge of the stored PNG derivative. */
		maxOutputEdge: 4096,
		thumbnailEdge: 512,
		allowedFormats: ['image/png', 'image/webp'] as const
	},
	svg: {
		maxSourceBytes: 2 * 1024 * 1024,
		maxRenderedEdge: 4096,
		maxPixels: 25_000_000,
		maxNodes: 5000,
		maxDepth: 64,
		maxAttributes: 512,
		/** Longest edge of the stored PNG derivative. */
		outputEdge: 2048
	}
} as const;
