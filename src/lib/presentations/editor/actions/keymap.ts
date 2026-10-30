/** Registry keyboard actions; native clipboard events provide copy, cut and paste data. */

import type { ActionRegistry } from './registry';

export function attachKeymap(
	registry: ActionRegistry,
	target: Window,
	options: { exempt: string }
): () => void {
	const onKeydown = (event: KeyboardEvent) => {
		if (event.defaultPrevented) return;
		// Typing in a field, a slider or a dialog keeps the browser's own keys.
		if (event.target instanceof HTMLElement && event.target.closest(options.exempt)) return;
		const action = registry.match(event);
		if (!action || !registry.isAvailable(action.id)) return;
		// Native clipboard events preserve system formats without read permission.
		if (action.id.startsWith('clipboard.')) return;
		if (!registry.isEnabled(action.id)) {
			if (action.claimsShortcut) event.preventDefault();
			return;
		}
		event.preventDefault();
		registry.run(action.id);
	};
	target.addEventListener('keydown', onKeydown);
	return () => target.removeEventListener('keydown', onKeydown);
}
