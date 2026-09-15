import { DEFAULT_BODY_FONT_SIZE, DEFAULT_THEME } from '../model/factories';
import type { Theme, TextElement } from '../model/types';
import type { BridgeDefaults } from './textBridge';
import type {
	ParagraphFormatState,
	ParagraphStylePatch,
	RunStylePatch,
	TextFormatState
} from './textFormat';

/**
 * Session helpers for DOM text editing (P17). Kept free of JSX so the overlay
 * module stays a component-only module and these stay unit-testable.
 *
 * A session is an explicit object owned by the editor that opens it: the overlay
 * registers its flush and formatting controller for the life of the session, and
 * save/export ask the session to flush instead of reaching into a module-level
 * registry. Nothing survives its editor.
 *
 * The active controller is one piece of reactive state: the toolbar reads it
 * through `format()`, so registering or releasing a controller updates the
 * toolbar without a notification list. The registration itself is a plain
 * assignment — a listener that read and wrote its own counter while the overlay
 * registered would make that effect depend on the counter and re-run forever.
 */

/** One text session is one undo entry; every keystroke commits inside this group. */
export function textHistoryGroup(elementId: string): string {
	return `text:${elementId}`;
}

/**
 * The formatting toolbar belongs to the editor page, but the DOM field and its
 * selection belong to `TextEditOverlay`, so the overlay registers a controller
 * for the life of the session.
 */
export type TextFormatController = {
	/** Applies a patch to the live selection and commits the session. */
	apply(patch: RunStylePatch): void;
	/** The effective style of the current selection, for active states. */
	read(): TextFormatState;
	/** Applies alignment/bullet attributes to the paragraphs in the selection. */
	applyParagraph(patch: ParagraphStylePatch): void;
	/** The uniform paragraph attributes of the selection. */
	readParagraph(): ParagraphFormatState;
	/** Applies or removes a link on the selection; invalid URLs are refused. */
	applyLink(href: string | null): { ok: true } | { ok: false; message: string };
	/** The element's line-height multiplier, changed as one history entry. */
	setLineHeight(value: number): void;
	/** The element's current line-height multiplier. */
	lineHeight(): number;
};

export type TextEditSession = {
	/** The overlay's commit function, or null when no field is open. */
	registerFlush(flush: (() => void) | null): void;
	/** Commits text that is only on screen; a rejected command keeps the last committed text. */
	flush(): void;
	registerFormat(controller: TextFormatController | null): void;
	/** Reactive: reading this inside an effect or template tracks the controller. */
	format(): TextFormatController | null;
};

export function createTextEditSession(): TextEditSession {
	let activeFlush: (() => void) | null = null;
	// `$state.raw`: the controller is only ever replaced, never mutated, and its
	// methods must stay ordinary closures rather than deep proxies.
	let activeFormat = $state.raw<TextFormatController | null>(null);

	return {
		registerFlush(flush) {
			activeFlush = flush;
		},
		flush() {
			if (activeFlush === null) return;
			try {
				activeFlush();
			} catch {
				// A rejected command (an over-long box) keeps the last committed text: the
				// overlay owns that error, and a save must not fail because of it.
			}
		},
		registerFormat(controller) {
			activeFormat = controller;
		},
		format() {
			return activeFormat;
		}
	};
}

/** Fallback style for text that carries no run of its own, preferring the document theme. */
export function bridgeDefaultsFor(
	element: TextElement,
	theme?: Pick<Theme, 'bodyFontId' | 'colors'>
): BridgeDefaults {
	const run = element.paragraphs.flatMap((paragraph) => paragraph.runs)[0];
	return {
		fontId: run?.fontId ?? theme?.bodyFontId ?? DEFAULT_THEME.bodyFontId,
		size: run?.size ?? DEFAULT_BODY_FONT_SIZE,
		color: run?.color ?? theme?.colors?.text ?? DEFAULT_THEME.colors.text ?? '#08152f'
	};
}
