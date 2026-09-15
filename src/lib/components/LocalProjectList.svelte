<script>
	import { resolve } from '$app/paths';
	import { ImagePlus, Trash2 } from 'lucide-svelte';
	import ProjectThumb from './ProjectThumb.svelte';
	import Modal from './Modal.svelte';
	import { shellHref } from '$lib/app/navigation';
	import { getCloudWorkspace } from '$lib/cloud/workspace.svelte';
	import { removeProject } from '$lib/editor/removeProject';

	/**
	 * @type {{
	 *   repository: import('$lib/persistence/repository').StickerLabRepository,
	 *   emptyTitle?: string,
	 *   emptyDetail?: string,
	 *   limit?: number,
	 *   refreshToken?: number,
	 * }}
	 */
	let {
		repository,
		emptyTitle = 'No projects yet',
		emptyDetail = 'Your local projects will appear here.',
		limit = undefined,
		refreshToken = 0
	} = $props();

	/** @type {import('$lib/domain/domain').ProjectDocument[] | null} */
	let projects = $state(null);
	/** @type {import('$lib/domain/domain').ProjectDocument | null} */
	let pending = $state(null);
	let busy = $state(false);
	let error = $state(/** @type {string | null} */ (null));
	let opener = $state(/** @type {HTMLButtonElement | undefined} */ (undefined));

	/** @type {import('$lib/domain/domain').ProjectDocument[]} */
	let visible = $derived(limit ? (projects ?? []).slice(0, limit) : (projects ?? []));

	const workspace = getCloudWorkspace();
	const cloud = $derived(workspace.cloud !== null);

	function reload() {
		return repository
			.listProjects()
			.then((list) => (projects = list))
			.catch(() => (projects = []));
	}

	$effect(() => {
		// Re-read whenever the repository, an explicit refresh token or a cloud
		// status update (another device, a retry, a conflict copy) changes.
		void repository;
		void refreshToken;
		void workspace.cloudStatus.version;
		let live = true;
		repository
			.listProjects()
			.then((list) => {
				if (live) projects = list;
			})
			.catch(() => {
				if (live) projects = [];
			});
		return () => {
			live = false;
		};
	});
</script>

{#if projects === null}
	<p class="muted">Loading projects…</p>
{:else if visible.length === 0}
	<div class="project-empty">
		<ImagePlus size={28} />
		<b>{emptyTitle}</b>
		<span>{emptyDetail}</span>
		<a href={shellHref('/create')}>Create your first sticker</a>
	</div>
{:else}
	<div class="project-grid">
		{#each visible as project (project.id)}
			<article class="project-card">
				<a class="project-card-link" href={resolve(`/editor/${project.id}`)}>
					<ProjectThumb {project} {repository} />
					<b>{project.title}</b>
					<small>{cloud ? 'Private workspace' : 'Saved locally'}</small>
				</a>
				<button
					type="button"
					class="button icon project-delete"
					aria-label={`Delete ${project.title}`}
					onclick={(event) => {
						opener = event.currentTarget;
						error = null;
						pending = project;
					}}
				>
					<Trash2 size={16} />
				</button>
			</article>
		{/each}
		<a class="project-card project-new" href={shellHref('/create')}>
			<div class="project-thumb">+</div>
			<b>New project</b>
			<small>Start creating</small>
		</a>
	</div>
{/if}

<Modal
	open={pending !== null}
	title="Delete this sticker?"
	description={`“${pending?.title ?? ''}” will be removed from this browser. Any pack memberships for this sticker will be removed; the other stickers in those packs will be kept.`}
	onclose={() => {
		pending = null;
		opener?.focus();
	}}
	focusOnOpen={() => document.querySelector('#cancel-delete-project')}
>
	{#if error}
		<p role="alert">{error}</p>
	{/if}
	{#snippet footer()}
		<button
			type="button"
			id="cancel-delete-project"
			class="button"
			onclick={() => {
				pending = null;
				opener?.focus();
			}}>Keep sticker</button
		>
		<button
			type="button"
			class="button danger"
			disabled={busy}
			onclick={async () => {
				if (!pending) return;
				busy = true;
				error = null;
				try {
					await removeProject(repository, pending);
					pending = null;
					await reload();
				} catch (cause) {
					error =
						cause instanceof Error ? cause.message : 'Could not delete this sticker. Please retry.';
				} finally {
					busy = false;
				}
			}}>Delete sticker</button
		>
	{/snippet}
</Modal>
