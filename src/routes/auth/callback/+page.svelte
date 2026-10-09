<script>
	import { button, buttonPrimary } from '#lib/ui/styles.js';
	/**
	 * `/auth/callback` — finishes a PKCE email sign-in (ported from the source
	 * `AuthCallback`). The route shows its own state instead of the milestone error
	 * page: a missing/invalid link explains how to recover, and a real code is only
	 * exchanged when the user chooses to continue in this browser.
	 *
	 * `replaceState` strips the code from the address bar immediately; the code the
	 * button uses is read from SvelteKit's URL state, so stripping it cannot lose it.
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import AccountDialog from '#lib/components/AccountDialog.svelte';
	import { getAuthClient, safeReturnPath } from '#lib/cloud/config.js';
	import { shellHref } from '#lib/app/navigation.js';

	let busy = $state(false);
	let error = $state(/** @type {string | null} */ (null));
	/** Hash fragments never reach the server, so this is settled after mount. */
	let hashError = $state(false);

	const code = $derived(page.url.searchParams.get('code'));
	const badLink = $derived(page.url.searchParams.has('error'));

	$effect(() => {
		window.history.replaceState(window.history.state, '', '/auth/callback');
	});

	$effect(() => {
		if (new URLSearchParams(window.location.hash.slice(1)).has('error')) hashError = true;
	});

	async function continueSignIn() {
		if (!code) return;
		busy = true;
		error = null;
		try {
			const auth = await getAuthClient();
			if (!auth) throw new Error('Cloud sign-in is not configured for this origin.');
			const { error: exchangeError } = await auth.auth.exchangeCodeForSession(code);
			if (exchangeError)
				throw new Error(
					'This link could not be used. It may be expired, already used, or opened in another browser. Request a fresh link.'
				);
			const destination = safeReturnPath(sessionStorage.getItem('stickerlab-auth-return'));
			sessionStorage.removeItem('stickerlab-auth-return');
			// Guest IDs are intentionally not opened in an account before explicit import.
			await goto(destination.startsWith('/editor/') ? '/my-stickers' : destination, {
				replace: true
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Sign-in failed. Request a new link.';
		} finally {
			busy = false;
		}
	}
</script>

<section class="empty [margin-block-start:20px] [min-block-size:250px]">
	<h1>Finish signing in</h1>
	<p>
		Continue only if you requested a StickerLab sign-in link in this browser. Guest work is kept
		locally.
	</p>
	{#if !code || badLink || hashError}
		<p role="alert">
			This sign-in link is missing, expired, invalid, or already used. Request a fresh link from
			Account.
		</p>
	{:else}
		<button
			type="button"
			class={buttonPrimary}
			disabled={busy}
			onclick={() => void continueSignIn()}>Continue sign-in</button
		>
	{/if}
	{#if error}<p role="alert">{error}</p>{/if}
	<AccountDialog />
	<p><a class={button} href={shellHref('/')}>Return to local editing</a></p>
</section>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.empty {
		display: flex;
		min-block-size: 208px;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-5);
		border: 1px dashed oklch(0.833566 0.047737 168.8711);
		border-radius: var(--radius);
		background: radial-gradient(
			ellipse at bottom,
			oklch(0.966239 0.018933 157.8754),
			oklch(1 0 none) 75%
		);
		color: oklch(0.535034 0.054407 249.7873);
		text-align: center;
	}
	:global(.empty h2) {
		color: var(--ink);
	}
	.empty p {
		max-inline-size: 480px;
		font-size: 14px;
	}
	:global(.empty > svg) {
		padding: 12px;
		inline-size: 56px;
		block-size: 56px;
		border-radius: 18px;
		background: var(--pale);
		color: oklch(0.551582 0.11869 163.307);
		transform: rotate(-8deg);
	}
</style>
