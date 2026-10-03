<script>
	import { button, buttonPrimary } from '#lib/ui/styles.js';
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
	import { shellHref } from '#lib/app/navigation.js';
	import { getAuthClient, safeReturnPath } from '#lib/cloud/config.js';
	import { getCloudWorkspace } from '#lib/cloud/workspace.svelte.js';
	import { getLocalRepository } from '#lib/persistence/repository.js';

	let { header = false } = $props();
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
	class={[button, 'profile', header && 'profile-header']}
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
			class={button}
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
				<div class="button-row [display:flex] [flex-wrap:wrap] [gap:8px]">
					<button
						type="button"
						class={button}
						disabled={busy}
						onclick={() => {
							localStorage.setItem(`stickerlab-import-choice:${session.user.id}`, 'later');
							open = false;
						}}>Not now</button
					>
					<button
						type="button"
						class={buttonPrimary}
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
		<p class="muted [color:var(--muted)]">
			Favorites remain browser-local and do not synchronize. Public sharing is not available.
		</p>
		<div
			class="dialog-footer [display:flex] [flex-wrap:wrap] [justify-content:flex-end] [gap:var(--space-3)] [padding-top:var(--space-5)] [border-top:1px_solid_var(--line)]"
		>
			<button type="button" class={button} onclick={() => (open = false)}>Close</button>
			<button type="button" class={button} disabled={busy} onclick={() => void run(signOut)}
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
			<p class="muted [color:var(--muted)]">
				Signing in will not upload your guest photos. You choose whether to import them afterward.
			</p>
			<div
				class="dialog-footer [display:flex] [flex-wrap:wrap] [justify-content:flex-end] [gap:var(--space-3)] [padding-top:var(--space-5)] [border-top:1px_solid_var(--line)]"
			>
				<button type="button" class={button} onclick={() => (open = false)}
					>Keep editing locally</button
				>
				<button type="submit" class={buttonPrimary} disabled={busy}
					>{busy ? 'Requesting…' : 'Request sign-in link'}</button
				>
			</div>
		</form>
	{/if}
	{#if message}<p role="status">{message}</p>{/if}
	{#if error}<p role="alert">{error}</p>{/if}
</Modal>

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.profile {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 44px;
		min-height: 44px;
		font-size: 13px;
		font-weight: 600;
	}
	.profile span {
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		border-radius: 50%;
		background: #1e3b5d;
		color: #fff;
		font-size: 12px;
		font-weight: 700;
	}
	.dialog-field {
		display: grid;
		gap: var(--space-2);
	}
	.dialog-field label {
		font-size: 13px;
		font-weight: 700;
	}
	.dialog-field input {
		width: 100%;
		min-height: 48px;
		padding: var(--space-3) var(--space-4);
		border: 1px solid #d5dfdc;
		border-radius: var(--radius-sm);
		background: #fcfdfb;
		font: inherit;
	}
	.profile-header {
		position: relative;
		flex-shrink: 0;
		min-height: 52px;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-4);
		border: 0;
		border-radius: var(--radius);
		background: var(--canvas);
		box-shadow: var(--shadow);
		font-size: clamp(14px, 1.08vw, 18px);
	}
	.profile-header span {
		width: 36px;
		height: 36px;
		font-size: 17px;
		font-weight: 500;
	}
	.profile-header::before {
		position: absolute;
		top: -4px;
		right: -9px;
		width: 35px;
		height: 21px;
		background: #ffe3a4b3;
		transform: rotate(45deg);
		content: '';
		pointer-events: none;
	}
	.profile-header::after {
		position: absolute;
		right: -22px;
		bottom: -8px;
		width: 22px;
		height: 26px;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 27 32'%3E%3Cpath d='m15 3 9-1M11 13l10 5M4 20l2 9' fill='none' stroke='%231c3a52' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E")
			center / contain no-repeat;
		content: '';
		pointer-events: none;
	}
	@media (max-width: 1150px) {
		.profile-header {
			min-height: 48px;
			padding: var(--space-2);
		}
		.profile-header span {
			width: 32px;
			height: 32px;
			font-size: 14px;
		}
		.profile-header::after {
			display: none;
		}
	}
	@media (max-width: 720px) {
		.profile-header {
			grid-area: 1 / 3;
			width: 44px;
			min-height: 44px;
			padding: 6px;
		}
		.profile-header b,
		.profile-header > :global(svg) {
			display: none;
		}
		.profile-header::before {
			right: -3px;
			width: 22px;
			height: 12px;
		}
	}
</style>
