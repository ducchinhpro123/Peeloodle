/**
 * The lazily loaded export builders.
 *
 * The export controller loads one builder per export, and presentation offline
 * readiness awaits every loader here, so a format cannot exist in the dialog
 * without also being warmed for offline use. Both callers import the same
 * modules, so each builder has exactly one browser module entry to warm.
 */
export const loadExportSnapshot = () => import('./snapshot');
export const loadPdfBuilder = () => import('./pdf');
export const loadPptxBuilder = () => import('./pptx');
export const loadBackupBuilder = () => import('./backup');

/** Everything a PDF, PPTX or backup export needs from the network. Add formats here. */
export const EXPORT_BUILDER_LOADERS = [
	loadExportSnapshot,
	loadPdfBuilder,
	loadPptxBuilder,
	loadBackupBuilder
] as const;
