<script>
	import { buttonPrimary } from '$lib/ui/styles.js';
	/**
	 * `/create` is a redirect surface, as in the source: flush pending work first,
	 * keep an already-open reusable draft, otherwise mint one draft id and hand off
	 * to the editor. A tool intent offered while local stickers exist asks which
	 * sticker to continue rather than silently starting a new one.
	 */
	import { ChevronLeft, ImagePlus, Upload } from 'lucide-svelte';
	import ProjectThumb from './ProjectThumb.svelte';
	import { getAppContext } from '$lib/app/context';
	import {
		editorPathWithIntent,
		isReusableOpenDocument,
		TOOL_INTENT_LABELS
	} from '$lib/editor/toolIntent';
	/** @typedef {import('$lib/domain/domain').ProjectDocument} ProjectDocument */
	/** @typedef {import('$lib/editor/toolIntent').ToolIntent} ToolIntent */

	/** @type {{ intent: ToolIntent | null, onnavigate: (href: `/editor/${string}`) => void }} */
	let { intent, onnavigate } = $props();

	const { repository, editor, saving } = getAppContext();

	/** @type {ProjectDocument[] | null} */
	let choice = $state(null);
	let choiceError = $state(/** @type {string | null} */ (null));

	/** Reuses an untouched revision-0 draft so a re-entry cannot mint a second id. */
	function takeCreateDraftId() {
		const current = editor.document;
		if (current && current.revision === 0 && current.layers.length === 0) return current.id;
		return editor.createDraft();
	}

	$effect(() => {
		const requested = intent;
		const repo = repository;
		let cancelled = false;
		void (async () => {
			const outcome = await saving.flush(repo);
			if (cancelled || outcome.kind === 'superseded') return;
			if (outcome.kind === 'blocked') {
				onnavigate(editorPathWithIntent(outcome.projectId, requested));
				return;
			}
			if (requested && isReusableOpenDocument(editor.document, editor) && editor.document) {
				onnavigate(editorPathWithIntent(editor.document.id, requested));
				return;
			}
			if (requested) {
				try {
					const projects = await repo.listProjects();
					if (cancelled) return;
					if (projects.length > 0) {
						choice = projects;
						choiceError = null;
						return;
					}
				} catch {
					if (cancelled) return;
					choice = [];
					choiceError = 'Could not load saved stickers. You can still create a new one.';
					return;
				}
			}
			if (cancelled) return;
			onnavigate(editorPathWithIntent(takeCreateDraftId(), requested));
		})();
		return () => {
			cancelled = true;
		};
	});
</script>

{#if choice && intent}
	<section
		class="tool-choice [margin:0_auto] [max-width:1440px] [padding:var(--space-5)]"
		data-testid="tool-document-choice"
	>
		<header class="tool-choice-header">
			<div>
				<span
					class="tool-choice-eyebrow [font-size:11px] [font-weight:800] [letter-spacing:0.12em] [color:var(--scrapbook-green)]"
					>YOUR NEXT LITTLE MASTERPIECE</span
				>
				<h1>{TOOL_INTENT_LABELS[intent]}</h1>
				<p>
					Pick a sticker to keep creating, or start with something new. Your saved work stays yours.
				</p>
			</div>
			<button
				type="button"
				class={buttonPrimary}
				onclick={() => onnavigate(editorPathWithIntent(takeCreateDraftId(), intent))}
				><Upload size={18} />Create new sticker</button
			>
		</header>
		{#if choiceError}
			<p role="alert">{choiceError}</p>
		{/if}
		{#if choice.length > 0}
			<div class="tool-choice-heading">
				<h2>Pick up where you left off</h2>
				<span>{choice.length} saved {choice.length === 1 ? 'sticker' : 'stickers'}</span>
			</div>
			<ul
				class="tool-choice-grid [margin:0] [display:grid] [grid-template-columns:repeat(auto-fill,_minmax(min(100%,_240px),_1fr))] [gap:var(--space-5)] [padding:0] [list-style:none]"
			>
				{#each choice as project (project.id)}
					<li>
						<button
							type="button"
							class="tool-choice-card"
							aria-label={`Open ${project.title}`}
							onclick={() => onnavigate(editorPathWithIntent(project.id, intent))}
						>
							<ProjectThumb {project} {repository} />
							<span
								class="tool-choice-card-body [display:block] [padding:var(--space-4)_var(--space-2)_var(--space-2)]"
							>
								<strong>{project.title}</strong>
								<span
									>{project.layers.length}
									{project.layers.length === 1 ? 'layer' : 'layers'}<span class="tool-choice-open"
										>Open sticker <ChevronLeft size={16} /></span
									></span
								>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{:else}
	<p class="muted [color:var(--muted)]" style="padding: 24px">
		<ImagePlus size={16} /> Opening sticker…
	</p>
{/if}

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.tool-choice-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-5);
		padding: clamp(24px, 4vw, 48px);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: linear-gradient(120deg, var(--pale), var(--paper));
	}
	.tool-choice-header > div {
		flex: 1 1 320px;
	}
	.tool-choice-header h1 {
		margin: var(--space-3) 0;
		font-size: clamp(28px, 3vw, 42px);
		line-height: 1.15;
	}
	.tool-choice-header p {
		max-width: 55ch;
		color: var(--muted);
		margin: 0;
	}
	.tool-choice-heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin: var(--space-6) 0 var(--space-4);
	}
	.tool-choice-heading h2 {
		margin: 0;
		font-size: 20px;
	}
	.tool-choice-heading > span {
		color: var(--muted);
		font-size: 13px;
	}
	.tool-choice-grid li {
		min-width: 0;
	}
	.tool-choice-card {
		display: block;
		width: 100%;
		height: 100%;
		text-align: left;
		padding: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: var(--shadow);
		color: var(--ink);
	}
	.tool-choice-card:hover {
		border-color: var(--mint);
		box-shadow: var(--shadow-hover);
	}
	:global(.tool-choice-card .project-thumb) {
		height: auto;
		aspect-ratio: 4 / 3;
		border-radius: var(--radius-sm);
		padding: var(--space-5);
	}
	:global(.tool-choice-card .project-thumb img) {
		width: 100%;
		height: 100%;
		min-height: 0;
		object-fit: contain;
	}
	.tool-choice-card-body strong {
		display: block;
		overflow-wrap: anywhere;
	}
	.tool-choice-card-body > span {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin-top: var(--space-3);
		color: var(--muted);
		font-size: 12px;
	}
	.tool-choice-open {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--scrapbook-green);
		font-weight: 800;
	}
	:global(.tool-choice-open svg) {
		transform: rotate(180deg);
	}
</style>
