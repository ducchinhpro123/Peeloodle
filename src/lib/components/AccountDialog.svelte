<script>
	/**
	 * The account control: a header button, the sign-in workspace dialog, the
	 * guest-import consent and the cloud status (ported from the source `Account.tsx`).
	 *
	 * Cloud is optional and explicit: the dialog explains when it is not configured,
	 * guest work is never uploaded without choosing to import it, and sign-out only
	 * hides the account cache on this device.
	 */
	import { ChevronDown } from 'lucide-svelte';
	import Modal from './Modal.svelte';
	import { page } from '$app/state';
	import { shellHref } from '$lib/app/navigation';
	import { getAuthClient, safeReturnPath } from '$lib/cloud/config';
	import { getCloudWorkspace } from '$lib/cloud/workspace.svelte';
	import { getLocalRepository } from '$lib/persistence/repository';

	const workspace = getCloudWorkspace();

	let open = $state(false);
	let email = $state('');
	let busy = $state(false);
	let message = $state(/** @type {string | null} */ (null));
	let error = $state(/** @type {string | null} */ (null));
	let guestCount = $state(0);
	/** @type {HTMLInputElement | undefined} */
	let emailInput = $state();

	const session = $derived(workspace.session);
	const status = $derived(workspace.cloudStatus);
	const cloudReady = $derived(workspace.configured);
	const statusLabel = $derived(
		status.error ??
			(status.state === 'synced'
				? 'Saved to cloud'
				: status.state === 'syncing'
					? 'Syncing saved work…'
					: 'Saved locally · cloud pending')
	);

	/** @param {() => Promise<void>} action */
	async function run(action) {
		busy = true;
		error = null;
		message = null;
		try {
			await action();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The request failed. Please retry.';
		} finally {
			busy = false;
		}
	}

	// A session that expired during sync re-opens the dialog with the retained-work copy.
	$effect(() => {
		if (!sessionStorage.getItem('stickerlab-session-expired')) return;
		sessionStorage.removeItem('stickerlab-session-expired');
		error = 'Session expired. Your local edits are kept on this device. Sign in again to sync.';
		open = true;
	});

	// Guest work is counted per session so import can be offered, never automatic.
	$effect(() => {
		const user = workspace.session?.user;
		if (!user) return;
		let live = true;
		void Promise.all([getLocalRepository().listProjects(), getLocalRepository().listPacks()])
			.then(([projects, packs]) => {
				if (!live) return;
				const count = projects.length + packs.length;
				guestCount = count;
				if (count && localStorage.getItem(`stickerlab-import-choice:${user.id}`) !== 'later')
					open = true;
			})
			.catch(() => {
				if (live) error = 'Could not inspect guest work. It has not been uploaded.';
			});
		return () => {
			live = false;
		};
	});

	async function requestLink() {
		const auth = await getAuthClient();
		if (!auth) throw new Error('Cloud sign-in is not configured for this origin.');
		await workspace.flushCurrent();
		sessionStorage.setItem('stickerlab-auth-return', safeReturnPath(page.url.pathname));
		const { error: signInError } = await auth.auth.signInWithOtp({
			email: email.trim(),
			options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
		});
		if (signInError)
			throw new Error(
				signInError.status === 429
					? 'Too many requests. Wait before requesting another link.'
					: `Could not request a link: ${signInError.message}`
			);
		message =
			'Sign-in email requested. Check your inbox and spam folder; delivery is not guaranteed. Open the newest link in this browser. You can retry if it does not arrive.';
	}

	async function signOut() {
		await workspace.flushCurrent();
		open = false;
		sessionStorage.setItem('stickerlab-signing-out', '1');
		const auth = await getAuthClient();
		if (!auth) return;
		const { error: signOutError } = await auth.auth.signOut({ scope: 'local' });
		if (signOutError) {
			sessionStorage.removeItem('stickerlab-signing-out');
			throw signOutError;
		}
	}
</script>

<button
	type="button"
	class="button profile"
	aria-label={session
		? `Account: ${session.user.email}`
		: session === null && cloudReady
			? 'Guest account'
			: 'Guest account'}
	onclick={() => (open = true)}
>
	<span aria-hidden="true">{session?.user.email?.slice(0, 1).toUpperCase() ?? 'G'}</span>
	<b>{session ? 'Account' : 'Guest'}</b>
	<ChevronDown size={15} aria-hidden="true" />
</button>

<Modal
	{open}
	title={session ? 'Your private workspace' : 'Sign in to StickerLab'}
	description={session
		? session.user.email
		: 'Guest editing stays on this device. Sign in by email to save a private cloud copy.'}
	onclose={() => (open = false)}
	focusOnOpen={() => emailInput}
>
	{#if !cloudReady}
		<p>
			Cloud saving is not configured for this site. Local editing, saving, and export still work.
			See the cloud setup guide for public configuration and approved callback origins.
		</p>
	{:else if session}
		<p>
			Account caches are kept separately on this browser. Signing out hides them in the app; they
			are not encrypted against someone controlling this device.
		</p>
		<p role="status">{statusLabel}</p>
		{#each status.notices as notice (notice)}
			<p>
				{notice}
				<a href={shellHref('/my-stickers')} onclick={() => (open = false)}
					>Review stickers and packs</a
				>
			</p>
		{/each}
		<button
			type="button"
			class="button"
			disabled={busy}
			onclick={() => void run(() => workspace.refresh())}>Refresh cloud / retry sync</button
		>
		{#if guestCount > 0}
			<section>
				<h3>Import guest work?</h3>
				<p>
					{guestCount} guest stickers and packs are on this device. Copy stickers, required photos, masks,
					and ordered packs to this account only if you choose. Originals are kept; retries resume safely.
				</p>
				<div class="button-row">
					<button
						type="button"
						class="button"
						disabled={busy}
						onclick={() => {
							localStorage.setItem(`stickerlab-import-choice:${session.user.id}`, 'later');
							open = false;
						}}>Not now</button
					>
					<button
						type="button"
						class="button primary"
						disabled={busy}
						onclick={() =>
							void run(async () => {
								await workspace.importGuest(session.user.id, (next) => (message = next));
								localStorage.setItem(`stickerlab-import-choice:${session.user.id}`, 'later');
							})}>Import guest collection / retry</button
					>
				</div>
			</section>
		{/if}
		<p class="muted">
			Favorites remain browser-local and do not synchronize. Public sharing is not available.
		</p>
		<div class="dialog-footer">
			<button type="button" class="button" onclick={() => (open = false)}>Close</button>
			<button type="button" class="button" disabled={busy} onclick={() => void run(signOut)}
				>Sign out</button
			>
		</div>
	{:else}
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void run(requestLink);
			}}
		>
			<div class="dialog-field">
				<label for="account-email">Email address</label>
				<input
					id="account-email"
					type="email"
					autocomplete="email"
					required
					bind:this={emailInput}
					bind:value={email}
				/>
			</div>
			<p class="muted">
				Signing in will not upload your guest photos. You choose whether to import them afterward.
			</p>
			<div class="dialog-footer">
				<button type="button" class="button" onclick={() => (open = false)}
					>Keep editing locally</button
				>
				<button type="submit" class="button primary" disabled={busy}
					>{busy ? 'Requesting…' : 'Request sign-in link'}</button
				>
			</div>
		</form>
	{/if}
	{#if message}<p role="status">{message}</p>{/if}
	{#if error}<p role="alert">{error}</p>{/if}
</Modal>
