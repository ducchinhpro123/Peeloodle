<script>
	import { button } from '#lib/ui/styles.js';
	/**
	 * The signed-in cloud status line (ported from the source `CloudBanner`).
	 * Rendered inside the shell's main area; hidden entirely for guests, so a
	 * local-only session never sees cloud chrome.
	 */
	import { shellHref } from '#lib/app/navigation.js';
	import { getCloudWorkspace } from '#lib/cloud/workspace.svelte.js';

	const workspace = getCloudWorkspace();
	const cloud = $derived(workspace.cloud);
	const status = $derived(workspace.cloudStatus);
	const label = $derived(
		status.error ??
			(status.state === 'syncing'
				? 'Syncing saved work…'
				: status.state === 'pending'
					? 'Saved locally · cloud pending'
					: 'Saved work is backed up to your private account.')
	);
	const latestNotice = $derived(status.notices.at(-1));
</script>

{#if cloud}
	<section class="cloud-banner" aria-label="Cloud synchronization">
		<span role="status">{label}</span>
		{#if latestNotice}
			<a href={shellHref('/my-stickers')}>{latestNotice} Review copies</a>
		{/if}
		<button type="button" class={button} onclick={() => void workspace.refresh()}
			>Refresh / retry cloud</button
		>
	</section>
{/if}

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.cloud-banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-4);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--pale);
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.cloud-banner > span {
		flex: 1 1 240px;
	}
</style>
