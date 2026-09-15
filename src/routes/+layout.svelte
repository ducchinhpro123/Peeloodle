<script>
	/**
	 * Root layout: global stylesheet plus the app-scoped workspace, editor state
	 * and save coordinator. Creating them here (not in a module) keeps mutable
	 * editor state out of a server-global module and lets a draft survive
	 * navigation between `/create` and `/editor/:projectId`.
	 *
	 * The workspace owns which repository the app uses: local (guest) or a private
	 * account cache. `{#key workspace.epoch}` remounts the routed tree through
	 * `AppScope` on every switch, so no component can hold the outgoing account's
	 * repository. While a configured session is being restored, a gate replaces the
	 * tree instead of showing one account's data under another.
	 *
	 * Unload protection lives here for the same reason: the editor route's own
	 * `pagehide`/`beforeunload` wiring disappears with the route, so a draft whose
	 * departure flush failed would otherwise be dropped silently on the next reload
	 * or close. The recovery status names that draft and reopens it as it is.
	 */
	import './layout.css';
	import { resolve } from '$app/paths';
	import AppScope from '$lib/components/AppScope.svelte';
	import { CloudWorkspace, setCloudWorkspaceContext } from '$lib/cloud/workspace.svelte';
	import { createDraftSaving } from '$lib/editor/draftSaving';
	import { createEditorState } from '$lib/editor/editorState.svelte';
	import { createIdbPresentationRepository } from '$lib/presentations/persistence/idb';
	import { createPresentationStore } from '$lib/presentations/editor/store.svelte';

	const workspace = new CloudWorkspace();
	setCloudWorkspaceContext(workspace);
	const editor = createEditorState();
	const saving = createDraftSaving(editor);
	const presentationRepository = createIdbPresentationRepository();
	const presentationStore = createPresentationStore();

	/** Retry re-runs the whole restore after a failed local flush. */
	let retry = $state(0);
	$effect(() => {
		retry;
		return workspace.init({
			resetEditor: () => editor.reset(),
			flush: async (repository) => {
				const outcome = await saving.flush(repository);
				if (outcome.kind !== 'ready')
					throw new Error(
						'Could not save the current draft locally. Retry before changing workspace.'
					);
			}
		});
	});

	/** Only set once a write has failed for a draft no mounted editor is showing. */
	let recovery = $derived(saving.recoveryDraft());

	/** @type {{ children: import('svelte').Snippet }} */
	const { children } = $props();
</script>

<svelte:window
	onpagehide={() => saving.pageHideApp(workspace.repository)}
	onbeforeunload={(event) => {
		if (!saving.hasUnprotectedWork()) return;
		event.preventDefault();
		event.returnValue = '';
	}}
/>

{#if !workspace.ready}
	<section class="empty">
		<h1>Opening private workspace</h1>
		<p role={workspace.error ? 'alert' : 'status'}>
			{workspace.error ?? 'Preserving local work and restoring your session…'}
		</p>
		{#if workspace.error}
			<button type="button" class="button primary" onclick={() => (retry += 1)}
				>Retry local save and session</button
			>
		{/if}
	</section>
{:else}
	{#if recovery}
		<section class="draft-recovery" role="alert" data-testid="unsaved-draft-recovery">
			<p>
				<strong>“{recovery.title}” could not be saved.</strong>
				<span>Your edits are still open in this browser — closing or reloading loses them.</span>
			</p>
			<a
				class="button draft-recovery-action"
				href={resolve('/editor/[projectId]', { projectId: recovery.projectId })}
				>Reopen the unsaved draft</a
			>
		</section>
	{/if}

	{#key workspace.epoch}
		<AppScope {editor} {saving} {presentationRepository} {presentationStore}>
			{@render children()}
		</AppScope>
	{/key}
{/if}

<style>
	.draft-recovery {
		position: fixed;
		inset: auto var(--space-4) var(--space-4) var(--space-4);
		z-index: 60;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		justify-content: space-between;
		max-width: 720px;
		margin-inline: auto;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--danger-line);
		border-radius: var(--radius-sm);
		background: var(--danger-tint);
		box-shadow: var(--shadow-hover);
	}

	.draft-recovery p {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
	}

	.draft-recovery strong {
		color: var(--danger);
	}

	.draft-recovery span {
		color: var(--muted);
	}

	.draft-recovery-action {
		flex: 0 0 auto;
	}
</style>
