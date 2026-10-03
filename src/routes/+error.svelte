<script>
	import { buttonPrimary } from '#lib/ui/styles.js';
	import { page } from '$app/state';
	import { shellHref } from '#lib/app/navigation.js';

	let status = $derived(page.status);
	let detail = $derived(page.error?.message ?? '');
</script>

<main style="max-width: 720px; margin: 0 auto; padding: 48px 20px;">
	<h1 style="font-size: 32px;">This screen is not part of the current milestone</h1>
	<p>
		StickerLab is being ported to SvelteKit one vertical slice at a time. The pages that work today
		are the dashboard, <code>/templates</code>, <code>/my-stickers</code>, <code>/create</code>,
		<code>/editor/&lt;projectId&gt;</code>, the <code>/presentations</code> library and the
		<code>/presentations/&lt;presentationId&gt;</code> editor: browse the sample templates (search, categories,
		previews and independent editable copies), organize saved stickers into packs (search, sort, membership
		order, duplicate/delete, ordered ZIP export), upload a photo, edit image and text layers, erase/restore
		an image-local mask with the brush, save locally, reopen, and export a transparent PNG, or create,
		organize and edit local presentations with autosave, conflict recovery and PDF, PPTX and backup exports.
	</p>
	<p>
		Optional Supabase account features are available when this site is configured with public cloud
		values; without them the app stays fully local. Sign-in, private workspace sync and guest import
		are optional and never upload work on their own.
	</p>
	<p class="muted [color:var(--muted)]">
		Requested path returned {status}{detail ? `: ${detail}` : ''}.
	</p>
	<p><a class={buttonPrimary} href={shellHref('/')}>Back to the dashboard</a></p>
</main>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
</style>
