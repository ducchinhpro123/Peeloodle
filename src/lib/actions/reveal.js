/**
 * Svelte action: fade/rise an element in the first time it scrolls into view.
 *
 * Content is visible by default (server render, no JS, reduced motion). On the client
 * the action marks the node `pending` (hidden) and flips it to `shown` when it
 * intersects the viewport; `src/lib/styles/motion.css` owns the actual animation and
 * only applies it when motion is allowed. `index` staggers siblings.
 *
 * @param {HTMLElement} node
 * @param {{ index?: number, step?: number, max?: number } | undefined} [options]
 */
export function reveal(node, options) {
	const { index = 0, step = 60, max = 8 } = options ?? {};
	if (typeof IntersectionObserver === 'undefined') return;

	node.style.setProperty('--reveal-delay', `${Math.min(index, max) * step}ms`);
	node.dataset.reveal = 'pending';

	const observer = new IntersectionObserver(
		(entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			node.dataset.reveal = 'shown';
			observer.disconnect();
		},
		{ rootMargin: '0px 0px -8% 0px' }
	);
	observer.observe(node);

	return {
		destroy() {
			observer.disconnect();
		}
	};
}
