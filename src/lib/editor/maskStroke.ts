/**
 * One mask stroke, as the editor store sees it. The canvas work — pointer
 * capture, preview frames, PNG encoding — stays in `useMaskBrush`; this object
 * is the single awaitable continuation. The hook registers it with the store
 * (`beginMaskStroke`), and saving, exporting, reloading and switching tools all
 * await the same commit through `commitMaskStroke` before they read the
 * document, instead of each carrying a private protocol.
 */
export type MaskStroke = {
	/** The image layer being painted. */
	layerId: string;
	/**
	 * Encodes the canvas and applies it as one history entry. Rejects when the
	 * stroke cannot be encoded; the stroke stays registered for a later retry.
	 */
	commit(): Promise<void>;
};
