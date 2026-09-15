<script>
	/**
	 * The signed-in cloud status line (ported from the source `CloudBanner`).
	 * Rendered inside the shell's main area; hidden entirely for guests, so a
	 * local-only session never sees cloud chrome.
	 */
	import { shellHref } from '$lib/app/navigation';
	import { getCloudWorkspace } from '$lib/cloud/workspace.svelte';

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
		<button type="button" class="button" onclick={() => void workspace.refresh()}
			>Refresh / retry cloud</button
		>
	</section>
{/if}
