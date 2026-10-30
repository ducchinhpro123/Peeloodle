/** The editor's single keydown handler: a pressed shortcut runs its registry action. */

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
