<script>
	import { isCatalogError } from '#lib/catalog/repository.js';
	import { button, buttonPrimary } from '#lib/ui/styles.js';

	/**
	 * Catalog access gate (P51).
	 *
	 * The route layout supplies the workspace facts (configured, session email)
	 * and the repository; this component only decides what to render. The server
	 * re-checks membership on every RPC, so this gate is convenience and honest
	 * messaging, never the authorization boundary.
	 *
	 * @type {{
	 *   configured: boolean,
	 *   sessionEmail: string | null,
	 *   repository: import('#lib/catalog/repository.js').CatalogAdminRepository | null,
	 *   homeHref: string,
	 *   children: import('svelte').Snippet
	 * }}
	 */
	let { configured, sessionEmail, repository, homeHref, children } = $props();

	/** @type {'checking' | 'unconfigured' | 'signed-out' | 'denied' | 'error' | 'ready'} */
	let status = $state('checking');
	/** @type {string | null} */
	let message = $state(null);
	let attempt = $state(0);

	$effect(() => {
		// "Try again" bumps this so the membership check re-runs.
		void attempt;
		if (!configured) {
			status = 'unconfigured';
			return;
		}
		if (!sessionEmail) {
			status = 'signed-out';
			return;
		}
		if (!repository) {
			status = 'checking';
			return;
		}
		let live = true;
		status = 'checking';
		message = null;
		void repository
			.isAdmin()
			.then((admin) => {
				if (live) status = admin ? 'ready' : 'denied';
			})
			.catch((cause) => {
				if (!live) return;
				status = isCatalogError(cause) && cause.code === 'permission' ? 'denied' : 'error';
				message = cause instanceof Error ? cause.message : 'The catalog could not be checked.';
			});
		return () => {
			live = false;
		};
	});
</script>

{#if status === 'ready'}
	{@render children()}
{:else}
	<section class="catalog-gate [display:grid] [max-width:62ch] [gap:var(--space-3)]">
		{#if status === 'checking'}
			<p role="status">Checking catalog access…</p>
		{:else if status === 'unconfigured'}
			<h1>Catalog is not configured</h1>
			<p>
				This site has no public Supabase configuration, so the admin catalog is unavailable. Local
				editing and saving are unaffected. See the cloud setup guide for the public configuration
				and approved callback origins.
			</p>
			<a class={button} href={homeHref}>Back to the app</a>
		{:else if status === 'signed-out'}
			<h1>Sign in to open the catalog</h1>
			<p>
				Use the Account button in the header. After the email link is confirmed you return to this
				page. Catalog administration needs an account; the guest workspace cannot be an
				administrator.
			</p>
			<a class={button} href={homeHref}>Open the app</a>
		{:else if status === 'denied'}
			<h1>This account is not a catalog administrator</h1>
			<p>
				Membership is granted through the database, not from this page, and every catalog operation
				re-checks it on the server. If you expected access, ask an existing administrator to add
				your account.
			</p>
			<a class={button} href={homeHref}>Back to the app</a>
		{:else}
			<h1>The catalog could not be checked</h1>
			<p role="alert">{message}</p>
			<button type="button" class={buttonPrimary} onclick={() => (attempt += 1)}>Try again</button>
		{/if}
	</section>
{/if}
