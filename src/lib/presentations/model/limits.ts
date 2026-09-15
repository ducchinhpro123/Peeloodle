/**
 * Centralized presentation limits (P10).
 *
 * Enforced by the parser and by command factories so no UI path can create an
 * out-of-contract document. Values are starting engineering defaults, not
 * measured capacity claims; adjust after representative documents and record
 * the change in the implementation notes.
 */

export const PRESENTATION_LIMITS = {
	/** Slides per document. */
	maxSlides: 50,
	/** Elements per slide. */
	maxElementsPerSlide: 200,
	/** Elements across the whole document. */
	maxElements: 2000,
	/** Assets per document. */
	maxAssets: 200,
	/**
	 * Total bytes of one document's unique artwork. A byte budget cannot be
	 * enforced by the parser, because asset byte sizes are not part of the
	 * serialized document; insertion is the only place the bytes are known.
	 */
	maxMediaBytes: 200 * 1024 * 1024,
	/** Characters across one text element's runs. */
	maxTextLength: 20_000,
	/** Runs in one paragraph. */
	maxRunsPerParagraph: 200,
	/** Paragraphs in one text element. */
	maxParagraphsPerElement: 200,
	/** Named theme colors. */
	maxThemeColors: 32,
	/** Serialized document JSON characters accepted by the parser. */
	maxDocumentChars: 8 * 1024 * 1024,
	/** Undo entries retained (plus a soft memory ceiling, see history module). */
	historyEntries: 50,
	/** Approximate retained history bytes before trimming older entries. */
	historySoftBytes: 32 * 1024 * 1024,
	/** Title characters. */
	maxTitleLength: 300
} as const;
