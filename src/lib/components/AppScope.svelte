<script>
	/**
	 * Per-epoch app scope: the root layout renders one instance per workspace epoch
	 * and it publishes the app context for that epoch's repository, so an account
	 * switch can never leave a component holding another account's repository.
	 *
	 * Mirrors the source provider's `<div key={epoch}>{children}</div>` remount.
	 */
	import { untrack } from 'svelte';
	import { setAppContext } from '$lib/app/context';
	import { getCloudWorkspace } from '$lib/cloud/workspace.svelte';

	/** @type {{
	 *   editor: import('$lib/editor/editorState.svelte').EditorState,
	 *   saving: import('$lib/editor/draftSaving').DraftSaving,
	 *   presentationRepository: import('$lib/presentations/persistence/repository').PresentationRepository,
	 *   presentationStore: import('$lib/presentations/editor/store.svelte').PresentationStore,
	 *   children: import('svelte').Snippet,
	 * }} */
	let { editor, saving, presentationRepository, presentationStore, children } = $props();

	const workspace = getCloudWorkspace();
	// One instance per workspace epoch, so the props never change inside it; the
	// context is published synchronously, before any descendant reads the app scope.
	untrack(() =>
		setAppContext({
			repository: workspace.repository,
			editor,
			saving,
			presentationRepository,
			presentationStore
		})
	);
</script>

{@render children()}
