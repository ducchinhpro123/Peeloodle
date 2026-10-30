/** Zoom and pan for one mounted slide editor; view state only, never saved. */

import type { DocumentState } from './document/documentState.svelte';

export type ViewportState = {
	readonly zoom: number;
	readonly pan: { x: number; y: number };
	/** Clamped to 0.1–8. */
	setZoom(zoom: number): void;
	setPan(pan: { x: number; y: number }): void;
};

export function createViewport(doc: DocumentState): ViewportState {
	return {
		get zoom() {
			return doc.view.zoom;
		},
		get pan() {
			return doc.view.pan;
		},
		setZoom: (zoom) => doc.setZoom(zoom),
		setPan: (pan) => doc.setPan(pan)
	};
}
