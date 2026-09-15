<script>
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
	<section class="tool-choice" data-testid="tool-document-choice">
		<header class="tool-choice-header">
			<div>
				<span class="tool-choice-eyebrow">YOUR NEXT LITTLE MASTERPIECE</span>
				<h1>{TOOL_INTENT_LABELS[intent]}</h1>
				<p>
					Pick a sticker to keep creating, or start with something new. Your saved work stays yours.
				</p>
			</div>
			<button
				type="button"
				class="button primary"
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
			<ul class="tool-choice-grid">
				{#each choice as project (project.id)}
					<li>
						<button
							type="button"
							class="tool-choice-card"
							aria-label={`Open ${project.title}`}
							onclick={() => onnavigate(editorPathWithIntent(project.id, intent))}
						>
							<ProjectThumb {project} {repository} />
							<span class="tool-choice-card-body">
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
	<p class="muted" style="padding: 24px"><ImagePlus size={16} /> Opening sticker…</p>
{/if}
