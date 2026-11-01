<script>
	import {
		DEFENSE_LENGTHS,
		DEFENSE_SECTIONS,
		formatSectionTime
	} from '#lib/presentations/templates/researchDefense.js';

	/** @type {{ length: import('#lib/presentations/templates/researchDefense.js').DefenseLength }} */
	let { length } = $props();
	const plan = $derived(DEFENSE_LENGTHS[length]);
	const rows = $derived(
		plan.sections.map((entry) => ({
			key: entry.section,
			label: DEFENSE_SECTIONS[entry.section].label,
			time: formatSectionTime(entry.seconds),
			hint: DEFENSE_SECTIONS[entry.section].hint
		}))
	);
</script>

<aside class="story-arc" aria-labelledby="defense-arc-heading">
	<h3 id="defense-arc-heading">Your story, minute by minute</h3>
	<ol aria-label="Defense story arc">
		{#each rows as row (row.key)}
			<li>
				<span class="arc-label">{row.label}</span>
				<span class="arc-time">{row.time}</span>
				<span class="arc-hint">{row.hint}</span>
			</li>
		{/each}
	</ol>
	<p class="arc-total">Talk time: {plan.minutes} minutes</p>
</aside>

<style>
	.story-arc {
		min-inline-size: 0;
		padding: 24px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--pale);
	}
	h3 {
		margin: 0 0 16px;
		font-size: 17px;
		letter-spacing: -0.02em;
	}
	ol {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 4px 12px;
		padding: 10px 0;
		border-block-start: 1px solid var(--control-line);
		min-inline-size: 0;
	}
	li:first-child {
		border-block-start: 0;
	}
	.arc-label {
		min-inline-size: 0;
		font-size: 14px;
		font-weight: 700;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.arc-time {
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		line-height: 1.4;
		color: var(--primary);
		white-space: nowrap;
	}
	.arc-hint {
		grid-column: 1 / -1;
		min-inline-size: 0;
		font-size: 13px;
		line-height: 1.5;
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.arc-total {
		margin: 16px 0 0;
		padding-block-start: 14px;
		border-block-start: 1px solid var(--control-line);
		font-size: 14px;
		font-weight: 700;
	}
</style>
