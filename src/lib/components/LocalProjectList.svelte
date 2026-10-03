<script>
	import { button, buttonDanger, buttonIcon } from '#lib/ui/styles.js';
	import { resolve } from '$app/paths';
	import { ImagePlus, Trash2 } from 'lucide-svelte';
	import ProjectThumb from './ProjectThumb.svelte';
	import Modal from './Modal.svelte';
	import { shellHref } from '#lib/app/navigation.js';
	import { getCloudWorkspace } from '#lib/cloud/workspace.svelte.js';
	import { removeProject } from '#lib/editor/removeProject.js';

	/**
	 * @type {{
	 *   repository: import('#lib/persistence/repository.js').StickerLabRepository,
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

	/** @type {import('#lib/domain/domain.js').ProjectDocument[] | null} */
	let projects = $state(null);
	/** @type {import('#lib/domain/domain.js').ProjectDocument | null} */
	let pending = $state(null);
	let busy = $state(false);
	let error = $state(/** @type {string | null} */ (null));
	let opener = $state(/** @type {HTMLButtonElement | undefined} */ (undefined));

	/** @type {import('#lib/domain/domain.js').ProjectDocument[]} */
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
	<p class="muted [color:var(--muted)]">Loading projects…</p>
{:else if visible.length === 0}
	<div class="project-empty">
		<ImagePlus size={28} />
		<b>{emptyTitle}</b>
		<span>{emptyDetail}</span>
		<a href={shellHref('/create')}>Create your first sticker</a>
	</div>
{:else}
	<div
		class="project-grid [display:grid] [grid-template-columns:repeat(auto-fill,_minmax(152px,_1fr))] [gap:var(--space-4)]"
	>
		{#each visible as project (project.id)}
			<article class="project-card">
				<a
					class="project-card-link [display:grid] [min-width:0] [gap:6px] [color:inherit] [text-decoration:none]"
					href={resolve(`editor/${project.id}`)}
				>
					<ProjectThumb {project} {repository} />
					<b>{project.title}</b>
					<small>{cloud ? 'Private workspace' : 'Saved locally'}</small>
				</a>
				<button
					type="button"
					class={[buttonIcon, 'project-delete']}
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
			class={button}
			onclick={() => {
				pending = null;
				opener?.focus();
			}}>Keep sticker</button
		>
		<button
			type="button"
			class={buttonDanger}
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

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.project-empty {
		display: flex;
		min-height: 208px;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-5);
		border: 1px dashed #abd3c3;
		border-radius: var(--radius);
		background: radial-gradient(ellipse at bottom, #eaf8ef, #fff 75%);
		color: #55708c;
		text-align: center;
	}
	:global(.project-empty h3) {
		color: var(--ink);
	}
	:global(.project-empty p) {
		max-width: 480px;
		font-size: 14px;
	}
	:global(.project-empty > svg) {
		padding: 12px;
		width: 56px;
		height: 56px;
		border-radius: 18px;
		background: var(--pale);
		color: #00875e;
		transform: rotate(-8deg);
	}
	.project-empty a {
		color: #008d62;
		font-weight: 700;
	}
	.project-card {
		display: grid;
		position: relative;
		gap: 6px;
		padding: 10px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
		color: inherit;
		text-decoration: none;
	}
	.project-delete {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 1;
		background: #fffffff0;
	}
	.project-new .project-thumb {
		background: #fff;
		border: 1px dashed #9ddaca;
		color: #008d62;
	}
</style>
