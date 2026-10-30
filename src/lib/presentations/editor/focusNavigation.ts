/** F6 moves between visible editor regions, retaining each region's last control. */
export function attachFocusNavigation(root: HTMLElement, beforeMove: () => void): () => void {
	const selectors = [
		'.presentation-editor-bar',
		'.ribbon',
		'.presentation-slide-rail',
		'.presentation-canvas-panel',
		'.task-pane',
		'.editor-status-bar'
	];
	const remembered = new Map<string, HTMLElement>();
	const visible = (node: HTMLElement) =>
		node.isConnected &&
		node.getClientRects().length > 0 &&
		getComputedStyle(node).visibility !== 'hidden';
	const keydown = (event: KeyboardEvent) => {
		if (
			event.defaultPrevented ||
			event.key !== 'F6' ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey
		)
			return;
		if (
			!(event.target instanceof Node) ||
			(event.target !== document.body && !root.contains(event.target))
		)
			return;
		if (event.target instanceof HTMLElement && event.target.closest('dialog, [role="dialog"]'))
			return;
		const regions = selectors.flatMap((selector) => {
			const node = root.querySelector<HTMLElement>(selector);
			return node && visible(node) ? [{ selector, node }] : [];
		});
		if (!regions.length) return;
		event.preventDefault();
		const active = document.activeElement;
		const index = regions.findIndex(({ node }) => active && node.contains(active));
		if (index >= 0 && active instanceof HTMLElement && !active.isContentEditable)
			remembered.set(regions[index]!.selector, active);
		beforeMove();
		const next =
			index < 0
				? event.shiftKey
					? regions.length - 1
					: 0
				: (index + (event.shiftKey ? -1 : 1) + regions.length) % regions.length;
		const region = regions[next]!;
		const previous = remembered.get(region.selector);
		if (
			previous &&
			visible(previous) &&
			!previous.matches(':disabled') &&
			region.node.contains(previous)
		) {
			previous.focus();
			return;
		}
		const preferred = region.node.querySelector<HTMLElement>(
			'[role="tab"][aria-selected="true"], .presentation-slide-card[aria-current="true"], [data-testid="presentation-canvas"]'
		);
		const fallback = Array.from(
			region.node.querySelectorAll<HTMLElement>(
				'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]'
			)
		).find(visible);
		(preferred ?? fallback)?.focus();
	};
	document.addEventListener('keydown', keydown);
	return () => document.removeEventListener('keydown', keydown);
}
