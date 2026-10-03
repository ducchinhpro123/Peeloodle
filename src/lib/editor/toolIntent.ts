/**
 * Svelte port of the source query-driven tool intents
 * (`src/features/editor/toolIntent.ts`).
 *
 * An intent activates existing editor chrome; it never inserts layers. That is
 * what keeps `?tool=text` from duplicating a text layer on reload or back.
 */

import { resolve } from '$app/paths';
import type { Layer, ProjectDocument } from '#lib/domain/domain.js';
import type { EditorState } from './editorState.svelte';

export const TOOL_INTENTS = ['erase', 'text', 'effects', 'export'] as const;
export type ToolIntent = (typeof TOOL_INTENTS)[number];

export const TOOL_INTENT_PARAM = 'tool';

export const TOOL_INTENT_LABELS: Record<ToolIntent, string> = {
	erase: 'Background Eraser',
	text: 'Text & Emoji',
	effects: 'Filters & Effects',
	export: 'Export & Share'
};

export type ToolIntentUi = {
	setInspectorTab: (tab: string) => void;
	setAssetTab: (tab: string) => void;
	setExportOpen: (open: boolean) => void;
	setRailFocus: (
		focus:
			'erase' | 'rotate' | 'restore' | 'outline' | 'text' | 'stickers' | 'effects' | 'layers' | null
	) => void;
};

export function parseToolIntent(value: string | null | undefined): ToolIntent | null {
	if (value === 'erase' || value === 'text' || value === 'effects' || value === 'export')
		return value;
	return null;
}

type ToolIntentListener = (intent: ToolIntent) => void;
const toolIntentListeners = new Set<ToolIntentListener>();

/** Re-apply an already-selected tool (same URL) without inserting layers. */
export function requestToolIntent(intent: ToolIntent): void {
	for (const listener of toolIntentListeners) listener(intent);
}

export function subscribeToolIntent(listener: ToolIntentListener): () => void {
	toolIntentListeners.add(listener);
	return () => {
		toolIntentListeners.delete(listener);
	};
}

/**
 * Routes this shell recognizes as app-local. Used only to keep the base-stripping
 * boundary idempotent (see `appLocalPathname`).
 */
const APP_LOCAL_ROUTES =
	/^\/(?:$|create(?:\/|$)|editor(?:\/|$)|templates(?:\/|$)|my-stickers(?:\/|$))/;

/**
 * The route-recognition helpers below take an **app-local** pathname: `/`,
 * `/create` or `/editor/<id>`, with no configured base. Production forwards the raw
 * `page.url.pathname` — which under a configured `kit.paths.base` is
 * `/base/editor/<id>` — into `Sidebar`, and that component calls
 * `appLocalPathname()` once so every helper in this module keeps that one contract.
 */

/**
 * Converts a URL pathname into the app-local contract above.
 *
 * Only an exact base (`/base` → `/`) or a base followed by a path separator
 * (`/base/editor/1` → `/editor/1`) is stripped, never a substring or partial
 * segment match, so `/basecamp/editor/1` is not treated as `/base`. Already
 * app-local inputs are returned unchanged, and a base that itself looks like a
 * route (`/editor`, `/create`) cannot double-strip: the remainder must still be a
 * route this shell knows, otherwise the input is read as app-local. That makes the
 * function safe to apply more than once, with one documented ambiguity — a
 * pathname exactly equal to the base is always read as the raw base-root URL
 * (`/base` → `/`), so an already app-local `/create` is not distinguishable under
 * a base of `/create`.
 *
 * @param pathname raw `page.url.pathname`, or an already app-local pathname
 * @param configuredBase the configured base; callers keep the `$app/paths` default
 */
export function appLocalPathname(pathname: string, configuredBase: string = resolve): string {
	if (!configuredBase) return pathname;
	if (pathname === configuredBase) return '/';
	if (!pathname.startsWith(`${configuredBase}/`)) return pathname;
	const stripped = pathname.slice(configuredBase.length);
	return APP_LOCAL_ROUTES.test(stripped) ? stripped : pathname;
}

/** `pathname` must be app-local (`appLocalPathname()` output): `/editor/<id>`. */
export function shouldReuseCurrentToolRoute(
	pathname: string,
	search: string,
	intent: ToolIntent
): boolean {
	const query = search.startsWith('?') ? search.slice(1) : search;

	return (
		pathname.startsWith('/editor/') &&
		parseToolIntent(new URLSearchParams(query).get(TOOL_INTENT_PARAM)) === intent
	);
}

/** Same-tab tool re-entry only. Modifier and non-primary clicks keep native link behavior. */
export function isUnmodifiedPrimaryClick(
	event: Pick<MouseEvent, 'button' | 'metaKey' | 'altKey' | 'ctrlKey' | 'shiftKey'>
): boolean {
	return event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
}

/**
 * Keep an already-open editor document; otherwise mint via `/create?tool=`.
 * `pathname` must be app-local (`appLocalPathname()` output): `/editor/<id>`.
 */
export function toolIntentPath(pathname: string): '/create' | `/editor/${string}` {
	const match = pathname.match(/^\/editor\/([a-zA-Z0-9-]+)$/);
	return match ? `/editor/${match[1]}` : '/create';
}

/**
 * Href for a tool link: the resolved (base-aware) pathname plus the intent as its
 * search parameter. Keeping the query here — not only the resolved path — is what
 * makes a Sidebar tool link activate its chrome instead of reloading a plain
 * editor URL. `pathname` must be app-local (`appLocalPathname()` output);
 * `resolve()` adds the configured base back.
 */
export function toolIntentHref(intent: ToolIntent, pathname: string): string {
	return `${resolve(toolIntentPath(pathname))}?${TOOL_INTENT_PARAM}=${intent}`;
}

export function editorPathWithIntent(
	projectId: string,
	intent: ToolIntent | null
): `/editor/${string}` {
	return intent ? `/editor/${projectId}?${TOOL_INTENT_PARAM}=${intent}` : `/editor/${projectId}`;
}

export function isReusableOpenDocument(
	document: ProjectDocument | null,
	extras?: { dirty?: boolean; gestureActive?: boolean; maskStroke?: unknown }
): boolean {
	if (!document) return false;
	if (extras?.dirty || extras?.gestureActive || extras?.maskStroke) return true;
	return document.layers.length > 0 || document.revision > 0;
}

function compatibleImage(layers: Layer[], selectedId: string | null): Layer | undefined {
	const selected = layers.find((layer) => layer.id === selectedId);
	if (selected?.kind === 'image' && selected.visible && !selected.locked) return selected;
	return [...layers]
		.reverse()
		.find((layer) => layer.kind === 'image' && layer.visible && !layer.locked);
}

function compatibleText(layers: Layer[], selectedId: string | null): Layer | undefined {
	const selected = layers.find((layer) => layer.id === selectedId);
	if (selected?.kind === 'text') return selected;
	return [...layers].reverse().find((layer) => layer.kind === 'text' && layer.visible);
}

/** Activate existing chrome. Never inserts layers (reload/back must not duplicate text). */
export function applyToolIntent(
	intent: ToolIntent | null,
	ui: ToolIntentUi,
	state: EditorState
): void {
	const document = state.document;
	if (!intent || !document) return;

	if (intent === 'erase') {
		const image = compatibleImage(document.layers, state.selectedLayerId);
		if (image && image.id !== state.selectedLayerId) state.selectLayer(image.id);
		state.setTool('erase');
		ui.setInspectorTab('adjust');
		ui.setAssetTab('uploads');
		ui.setRailFocus('erase');
		ui.setExportOpen(false);
		return;
	}

	if (intent === 'text') {
		const text = compatibleText(document.layers, state.selectedLayerId);
		if (text && text.id !== state.selectedLayerId) state.selectLayer(text.id);
		state.setTool('text');
		ui.setInspectorTab('adjust');
		ui.setAssetTab('stickers');
		ui.setRailFocus('text');
		ui.setExportOpen(false);
		return;
	}

	if (intent === 'effects') {
		const image = compatibleImage(document.layers, state.selectedLayerId);
		if (image && image.id !== state.selectedLayerId) state.selectLayer(image.id);
		state.setTool('select');
		ui.setInspectorTab('effects');
		ui.setRailFocus('effects');
		ui.setExportOpen(false);
		return;
	}

	state.setTool('select');
	ui.setExportOpen(true);
	ui.setRailFocus(null);
}

export function toolEmptyCopy(
	intent: ToolIntent | null,
	hasImage: boolean,
	hasText: boolean
): { title: string; body: string } | null {
	if (intent === 'erase' && !hasImage) {
		return {
			title: 'Upload a photo to erase the background',
			body: 'Background Eraser needs an image layer. Automatic removal is not available — use Erase and Restore after you add a photo.'
		};
	}
	if (intent === 'effects' && !hasImage) {
		return {
			title: 'Filters need a photo or sticker',
			body: 'Select an image layer to adjust brightness, contrast, saturation, and grayscale. Upload a photo or pick a cutout first.'
		};
	}
	if (intent === 'text' && !hasText && !hasImage) {
		return {
			title: 'Add words or a sticker',
			body: 'Use Text in the tool rail or a style in the tray for editable type. Stickers & decorations are image layers, not emoji fonts.'
		};
	}
	return null;
}
