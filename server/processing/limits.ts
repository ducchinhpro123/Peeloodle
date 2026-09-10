/**
 * Centralized processing limits (P07).
 *
 * These are starting engineering defaults, not measured capacity claims. Adjust
 * after representative fixtures and record changes in the implementation notes.
 */

export const PROCESSING_LIMITS = {
  raster: {
    maxSourceBytes: 15 * 1024 * 1024,
    maxPixels: 25_000_000,
    maxSourceDimension: 20_000,
    /** Longest edge of the stored PNG derivative. */
    maxOutputEdge: 4096,
    thumbnailEdge: 512,
    allowedFormats: ['png', 'webp'] as const,
  },
  svg: {
    maxSourceBytes: 2 * 1024 * 1024,
    maxRenderedEdge: 4096,
    maxPixels: 25_000_000,
    maxNodes: 5000,
    maxDepth: 64,
    /** Longest edge of the stored PNG derivative. */
    outputEdge: 2048,
  },
  concurrency: { maxParallelJobs: 2 },
} as const
