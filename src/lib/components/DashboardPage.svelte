<script>
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { button, buttonPrimary } from '#lib/ui/styles.js';
	import {
		ArrowRight,
		BookOpen,
		Clock,
		GraduationCap,
		ImagePlus,
		Lightbulb,
		Presentation
	} from 'lucide-svelte';
	import AppShell from './AppShell.svelte';
	import Hero from './Hero.svelte';
	import StickerCollage from './StickerCollage.svelte';
	import LocalProjectList from './LocalProjectList.svelte';
	import PresentationThumb from './PresentationThumb.svelte';
	import TemplateRail from './TemplateRail.svelte';
	import Modal from './Modal.svelte';
	import { shellHref } from '#lib/app/navigation.js';

	/** @type {{
	 * repository: import('#lib/persistence/repository.js').StickerLabRepository,
	 * presentationRepository: import('#lib/presentations/persistence/repository.js').PresentationRepository,
	 * onopen: (projectId: string) => void,
	 * pathname?: string, search?: string
	 * }} */
	let { repository, presentationRepository, onopen, pathname = '/', search = '' } = $props();
	let walkthroughOpen = $state(false);
	let loading = $state(true);
	let loadError = $state(false);
	let recent = $state.raw(
		/** @type {import('#lib/presentations/model/types.js').PresentationSummary[]} */ ([])
	);

	const tasks = [
		{
			title: 'Class presentation',
			detail: 'Explain an idea, share a project, teach something new.',
			icon: BookOpen,
			href: shellHref('/presentations?task=class'),
			label: '01 · FOR CLASS'
		},
		{
			title: 'Research defense',
			detail: 'Your question, method and findings. A clear place to start.',
			icon: GraduationCap,
			href: shellHref('/presentations?task=research-defense'),
			label: '02 · FOR YOUR RESEARCH'
		},
		{
			title: 'Club pitch',
			detail: 'Get your team excited about what comes next.',
			icon: Lightbulb,
			href: shellHref('/presentations?task=club-pitch'),
			label: '03 · FOR YOUR COMMUNITY'
		},
		{
			title: 'Create a Sticker',
			detail: 'Make a personal sticker, then bring it into your slides.',
			icon: ImagePlus,
			href: shellHref('/create'),
			label: '04 · A LITTLE PERSONALITY'
		}
	];

	async function loadRecent() {
		loading = true;
		loadError = false;
		try {
			recent = (await presentationRepository.listPresentations()).slice(0, 3);
		} catch {
			loadError = true;
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		void loadRecent();
	});
</script>

<AppShell {pathname} {search}>
	<Hero variant="dashboard">
		{#snippet kicker()}<p class="hero-kicker tape">YOUR STUDENT DESK</p>{/snippet}
		{#snippet title()}Your next big idea.<br /><em>Make it stick.</em>{/snippet}
		{#snippet action()}
			<div class="desk-actions">
				<a class={buttonPrimary} href={shellHref('/presentations')}>
					<Presentation size={17} />
					Make a presentation
					<ArrowRight size={17} />
				</a>

				<button type="button" class={button} onclick={() => (walkthroughOpen = true)}
					>Quick start</button
				>
			</div>
		{/snippet}
		{#snippet points()}<ul class="hero-points">
				<li>No account needed</li>
				<li>Saved in this browser</li>
				<li>Your words. Your style.</li>
			</ul>{/snippet}
		{#snippet art()}<StickerCollage />{/snippet}
		Class project, research defense, or your club’s next big plan. Start with useful slides, add your
		ideas and a little personality.
	</Hero>

	<section class="desk-tasks" aria-labelledby="task-heading">
		<div class="section-title">
			<h2 id="task-heading">What are you making?</h2>
			<span>A head start, not a blank stare.</span>
		</div>
		<div class="task-grid">
			{#each tasks as task (task.title)}
				<a class="task-card" aria-label={task.title} href={task.href}>
					<small>{task.label}</small><task.icon size={26} aria-hidden="true" />
					<strong>{task.title}</strong>
					<p>{task.detail}</p>
					<ArrowRight size={19} aria-hidden="true" />
				</a>
			{/each}
		</div>
	</section>

	<section class="recent-decks" aria-labelledby="recent-heading">
		<div class="section-title">
			<h2 id="recent-heading"><Clock size={17} aria-hidden="true" />Recent presentations</h2>
			<a href={shellHref('/presentations')}>All presentations <ArrowRight size={15} /></a>
		</div>
		<p class="storage-note">
			Saved in this browser — not automatically synced. Download a backup to keep a portable copy.
		</p>
		{#if loading}<p role="status">Finding your presentations…</p>
		{:else if loadError}<p role="alert">
				Could not read your saved presentations. <button class={button} onclick={loadRecent}
					>Try again</button
				>
			</p>
		{:else if recent.length}
			<ul class="recent-grid">
				{#each recent as item (item.id)}<li>
						<a
							class="recent-card"
							aria-label={`Open ${item.title}`}
							href={resolve(`presentations/${item.id}`)}
						>
							<span class="recent-preview"
								><PresentationThumb
									repository={presentationRepository}
									documentId={item.id}
									revision={item.revision}
								/></span
							>
							<strong>{item.title}</strong><small
								>{item.slideCount}
								{item.slideCount === 1 ? 'slide' : 'slides'} · Saved in this browser</small
							>
						</a>
					</li>{/each}
			</ul>
		{:else}<div class="desk-empty">
				<BookOpen size={26} aria-hidden="true" />
				<div>
					<strong>Your next assignment starts here.</strong>
					<p>
						Pick a starting point above. Your saved presentations will appear here when you return.
					</p>
				</div>
			</div>{/if}
	</section>

	<div class="sticker-shelf">
		<section aria-labelledby="sticker-heading">
			<div class="section-title">
				<h2 id="sticker-heading">Your personal stickers</h2>
				<a href={shellHref('/my-stickers#local-stickers')}>View all</a>
			</div>
			<LocalProjectList {repository} limit={6} />
		</section>

		<TemplateRail {repository} {onopen} title="Sticker inspiration" flushTop />
	</div>
</AppShell>

<Modal
	open={walkthroughOpen}
	title="Your first presentation"
	description="From an idea to something you can hand in."
	onclose={() => (walkthroughOpen = false)}
>
	<ol class="walkthrough">
		<li>
			<strong>Choose your assignment.</strong> Preview a class, research or club template, or start from
			scratch. You get your own editable copy.
		</li>
		<li>
			<strong>Make it yours.</strong> Replace the sample text, add photos, and use
			<strong>Add sticker</strong> for your personal stickers. A laptop or desktop works best for editing.
		</li>
		<li>
			<strong>Know where it lives.</strong> “Saved in this browser” means it stays here, not in an account.
			Clearing browser data can remove it.
		</li>
		<li>
			<strong>Take it with you.</strong> PDF for handing in, PPTX for editing elsewhere, and a .stickerlab.zip
			backup to reopen here. Restore that backup from Presentations on another device.
		</li>
	</ol>
	{#snippet footer()}<a class={buttonPrimary} href={shellHref('/presentations')}
			>Choose a starting point<ArrowRight size={16} /></a
		>{/snippet}
</Modal>

<style>
	.desk-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: var(--space-5);
	}
	.desk-tasks,
	.recent-decks {
		margin-top: var(--space-6);
	}
	.section-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 16px;
	}
	.section-title h2 {
		display: flex;
		align-items: center;
		gap: 9px;
		margin: 0;
		font-size: clamp(18px, 2vw, 25px);
		letter-spacing: -0.025em;
	}
	.section-title > span,
	.storage-note {
		color: var(--muted);
		font-size: 13px;
	}
	.section-title a {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--scrapbook-green);
		font-size: 13px;
		font-weight: 700;
	}
	.task-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 16px;
	}
	.task-card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		min-width: 0;
		padding: 22px;
		border: 1px solid #08152f0a;
		border-radius: 18px;
		background: var(--pale);
		color: var(--ink);
		text-decoration: none;
		transition: transform 160ms ease;
	}
	.task-card:nth-child(2) {
		background: var(--sky);
	}
	.task-card:nth-child(3) {
		background: var(--lav);
	}
	.task-card:nth-child(4) {
		background: var(--blush);
	}
	.task-card:hover {
		transform: translateY(-3px);
	}
	.task-card small {
		font-size: 9px;
		font-weight: 800;
		letter-spacing: 0.07em;
		margin-bottom: 20px;
	}
	.task-card strong {
		font-size: 18px;
		margin-top: 14px;
	}
	.task-card p {
		font-size: 13px;
		line-height: 1.5;
		color: #3c4b60;
		margin: 8px 0 20px;
	}
	.task-card :global(svg:last-child) {
		margin-top: auto;
		align-self: flex-end;
	}
	.recent-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 18px;
		list-style: none;
		padding: 0;
	}
	.recent-card {
		display: grid;
		gap: 9px;
		padding: 12px;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: var(--surface);
		color: var(--ink);
		text-decoration: none;
	}
	.recent-preview {
		position: relative;
		display: block;
		aspect-ratio: 16/9;
		overflow: hidden;
		border-radius: 9px;
		background: var(--cream);
	}
	.recent-card strong {
		overflow-wrap: anywhere;
	}
	.recent-card small {
		color: var(--muted);
		font-size: 12px;
	}
	.desk-empty {
		display: flex;
		align-items: center;
		gap: 18px;
		padding: 24px;
		border: 1px dashed var(--mint-line);
		border-radius: 16px;
		background: var(--surface);
	}
	.desk-empty p {
		color: var(--muted);
		font-size: 13px;
		margin-bottom: 0;
	}
	.sticker-shelf {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-5);
		margin-top: var(--space-7);
	}
	.sticker-shelf > section {
		min-width: 0;
	}
	.walkthrough {
		display: grid;
		gap: 18px;
		padding-left: 24px;
		font-size: 14px;
		line-height: 1.6;
	}
	@media (max-width: 1100px) {
		.task-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 720px) {
		.task-grid,
		.recent-grid,
		.sticker-shelf {
			grid-template-columns: minmax(0, 1fr);
		}
		.task-card {
			padding: 20px;
		}
		.task-card small {
			margin-bottom: 12px;
		}
		.task-card p {
			margin-bottom: 10px;
		}
		.desk-actions > a {
			width: 100%;
			justify-content: center;
		}
	}
</style>
