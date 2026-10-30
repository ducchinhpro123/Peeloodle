<script>
	/**
	 * PowerPoint-style ribbon: a tab strip and the active tab's panel.
	 *
	 * Contextual tabs (Shape Format, Picture Format) are listed only while their
	 * selection exists; when one disappears the ribbon falls back to Home.
	 * Arrow keys move focus between tabs (roving tabindex), Enter or Space opens
	 * the focused tab, and a collapsed ribbon shows the tabs alone.
	 */

	/** @typedef {{ id: string, label: string, contextual?: boolean }} RibbonTabItem */

	/** @type {{
	 *   tabs: RibbonTabItem[],
	 *   active: string,
	 *   collapsed?: boolean,
	 *   onselect: (id: string) => void,
	 *   panel: import('svelte').Snippet<[string]>
	 * }}
	 */
	let { tabs, active, collapsed = false, onselect, panel } = $props();

	const current = $derived(tabs.some((tab) => tab.id === active) ? active : 'home');
	/** @type {Map<string, HTMLButtonElement>} */
	const buttons = new Map();

	/** @param {string} id */
	function register(id) {
		/** @param {HTMLButtonElement} node */
		return (node) => {
			buttons.set(id, node);
			return () => {
				if (buttons.get(id) === node) buttons.delete(id);
			};
		};
	}

	/** @param {KeyboardEvent} event */
	function keydown(event) {
		const index = tabs.findIndex((tab) => buttons.get(tab.id) === event.target);
		if (index === -1) return;
		const next =
			event.key === 'ArrowRight'
				? (index + 1) % tabs.length
				: event.key === 'ArrowLeft'
					? (index - 1 + tabs.length) % tabs.length
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? tabs.length - 1
							: -1;
		if (next === -1) return;
		event.preventDefault();
		buttons.get(tabs[next].id)?.focus();
	}
</script>

<div class="ribbon">
	<div class="ribbon-tabs" role="tablist" aria-label="Ribbon" tabindex="-1" onkeydown={keydown}>
		{#each tabs as tab (tab.id)}
			<button
				type="button"
				role="tab"
				id="ribbon-tab-{tab.id}"
				class={['ribbon-tab', { contextual: tab.contextual }]}
				aria-selected={tab.id === current}
				aria-controls={collapsed ? undefined : `ribbon-panel-${tab.id}`}
				tabindex={tab.id === current ? 0 : -1}
				onclick={() => onselect(tab.id)}
				ondblclick={() => onselect(`toggle:${tab.id}`)}
				{@attach register(tab.id)}>{tab.label}</button
			>
		{/each}
	</div>
	{#if !collapsed}
		<div
			class="ribbon-panel"
			role="tabpanel"
			id="ribbon-panel-{current}"
			aria-labelledby="ribbon-tab-{current}"
		>
			{@render panel(current)}
		</div>
	{/if}
</div>

<style>
	.ribbon {
		border-block-end: 1px solid oklch(0.9 0.006 264);
		background: var(--surface);
	}
	.ribbon-tabs {
		display: flex;
		gap: 2px;
		padding-inline: var(--space-2);
		background: oklch(0.968 0.003 264);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.ribbon-tab {
		min-block-size: 32px;
		padding-inline: 12px;
		border: 0;
		border-radius: 6px 6px 0 0;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 13px;
		white-space: nowrap;
		cursor: pointer;
	}
	.ribbon-tab:hover {
		background: oklch(0.94 0.004 264);
	}
	.ribbon-tab[aria-selected='true'] {
		background: var(--surface);
		box-shadow: inset 0 2px 0 var(--primary);
		color: var(--primary);
		font-weight: 700;
	}
	.ribbon-tab.contextual {
		color: oklch(0.5 0.17 300);
		font-weight: 700;
	}
	.ribbon-tab:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: -2px;
	}
	.ribbon-panel {
		container-type: inline-size;
		display: flex;
		min-block-size: 68px;
		align-items: stretch;
		padding: 6px var(--space-2) 4px;
		overflow-x: auto;
		scrollbar-width: thin;
	}
</style>
