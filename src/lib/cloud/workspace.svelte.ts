/**
 * The account workspace: session, per-account repository and cloud status
 * (ported from the source `Workspace.tsx`).
 *
 * The source mounted a provider that gated the app while restoring a session,
 * flushed the outgoing draft before replacing the repository, reset the editor
 * store and remounted the routed tree on every account switch. This class keeps
 * the same rules in runes; the root layout drives it and remounts its children
 * with `{#key workspace.epoch}`, so a switch can never leave another account's
 * document mounted.
 *
 * Local-first is preserved: without public config nothing here starts, the guest
 * repository is the app's repository, and signing in is always explicit. A draft
 * that cannot be flushed keeps the app locked on the workspace it belongs to
 * rather than switching to a repository that cannot see it.
 */

import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { createContext } from 'svelte';
import type { Session } from '@supabase/supabase-js';
import { getAuthClient, readCloudConfig } from './config';
import { getLocalRepository, type StickerLabRepository } from '$lib/persistence/repository';
import type { CloudRepository, CloudStatus } from '$lib/persistence/cloud';
import type { Database } from './database';

/** Pages with no cloud use the same shape, so consumers need no branch. */
export const GUEST_CLOUD_STATUS: CloudStatus = {
	state: 'synced',
	pending: 0,
	error: null,
	notices: [],
	version: 0,
	conflicts: {}
};

export type WorkspaceHost = {
	/** The editor state reset that runs between accounts (`workspaceEpoch` bump). */
	resetEditor: () => void;
	/** Flush that keeps the outgoing draft when it cannot be written locally. */
	flush: (repository: StickerLabRepository) => Promise<void>;
};

export class CloudWorkspace {
	#local = getLocalRepository();
	#tail: Promise<void> = Promise.resolve();
	#sequence = 0;
	#unsubscribeAuth: (() => void) | null = null;
	#unsubscribeCloud: (() => void) | null = null;
	#flush: (repository: StickerLabRepository) => Promise<void> = async () => {};

	session = $state.raw<Session | null>(null);
	repository = $state.raw<StickerLabRepository>(this.#local);
	cloud = $state.raw<CloudRepository | null>(null);
	cloudStatus = $state.raw<CloudStatus>(GUEST_CLOUD_STATUS);
	epoch = $state(0);
	/** False while a configured session is being restored; the gate shows then. */
	ready = $state(true);
	configured = $state(browser && readCloudConfig() !== null);
	error = $state<string | null>(null);

	/**
	 * Starts session restore and the online retry hook. Returns the cleanup the
	 * layout's effect owns; calling it never cancels an in-flight flush (a failed
	 * flush keeps the draft, it is not abandoned mid-write).
	 */
	init(host: WorkspaceHost): () => void {
		if (!browser) return () => {};
		this.#flush = host.flush;
		this.#sequence = 0;
		this.error = null;
		if (!readCloudConfig()) {
			this.configured = false;
			this.ready = true;
			return () => {};
		}
		this.configured = true;
		let live = true;
		this.ready = false;
		const online = () => {
			void this.cloud?.refresh();
		};
		window.addEventListener('online', online);
		void getAuthClient().then((auth) => {
			if (!live) return;
			if (!auth) {
				this.ready = true;
				return;
			}
			const switchTo = (session: Session | null) => {
				if (this.session?.user.id === session?.user.id && this.ready) {
					this.session = session;
					return;
				}
				const request = ++this.#sequence;
				const previous = {
					repository: this.repository,
					cloud: this.cloud,
					session: this.session,
					epoch: this.epoch
				};
				this.#unsubscribeCloud?.();
				this.#unsubscribeCloud = null;
				previous.cloud?.dispose();
				this.ready = false;
				this.#tail = this.#tail
					.then(async () => {
						if (!live || request !== this.#sequence) return;
						await host.flush(previous.repository);
						if (!live || request !== this.#sequence) return;
						host.resetEditor();
						const config = readCloudConfig();
						let cloud: CloudRepository | null = null;
						if (session && config) {
							const [{ CloudRepository }, { SupabaseRemote }, supabase] = await Promise.all([
								import('$lib/persistence/cloud'),
								import('$lib/persistence/cloudRemote'),
								import('@supabase/supabase-js')
							]);
							if (!live || request !== this.#sequence) return;
							const ownerId = session.user.id;
							// A second client scoped to this account's token: an in-flight request
							// from a previous account cannot borrow the new session's credentials.
							const scoped = supabase.createClient<Database>(config.url, config.key, {
								accessToken: async () => {
									const { data } = await auth.auth.getSession();
									if (
										this.cloud !== cloud ||
										this.session?.user.id !== ownerId ||
										data.session?.user.id !== ownerId
									)
										throw new Error(
											'Session changed. Sign in to the originating account to retry.'
										);
									return data.session.access_token;
								}
							});
							cloud = new CloudRepository(
								`stickerlab-account-${ownerId}`,
								new SupabaseRemote(scoped, ownerId)
							);
						}
						this.session = session;
						this.cloud = cloud;
						this.cloudStatus = cloud ? cloud.getStatus() : GUEST_CLOUD_STATUS;
						if (cloud)
							this.#unsubscribeCloud = cloud.subscribe(() => {
								this.cloudStatus = cloud.getStatus();
							});
						this.repository = cloud ?? this.#local;
						this.epoch = previous.epoch + 1;
						this.error = null;
						this.ready = true;
						if (
							previous.epoch > 0 &&
							previous.session?.user.id !== session?.user.id &&
							!window.location.pathname.startsWith('/auth/') &&
							!window.location.pathname.startsWith('/editor/')
						)
							void goto('/my-stickers', { replaceState: true });
						void cloud?.refresh();
					})
					.catch(() => {
						if (live)
							this.error =
								'Your draft could not be saved locally. The workspace is locked and the draft is retained in memory. Free device storage, then retry; do not close this tab.';
					});
			};
			const { data: listener } = auth.auth.onAuthStateChange((event, session) => {
				if (!live) return;
				if (event === 'SIGNED_OUT' && this.session) {
					if (sessionStorage.getItem('stickerlab-signing-out'))
						sessionStorage.removeItem('stickerlab-signing-out');
					else sessionStorage.setItem('stickerlab-session-expired', '1');
				}
				switchTo(session);
			});
			this.#unsubscribeAuth = () => listener.subscription.unsubscribe();
			void auth.auth.getSession().then(({ data, error: sessionError }) => {
				if (!live || this.#sequence) return;
				if (sessionError) this.error = 'Session restoration failed. Reconnect and retry.';
				else switchTo(data.session);
			});
		});
		return () => {
			live = false;
			this.#unsubscribeAuth?.();
			this.#unsubscribeAuth = null;
			window.removeEventListener('online', online);
		};
	}

	refresh(): Promise<void> {
		return this.cloud?.refresh() ?? Promise.resolve();
	}

	/** Flushes the current draft with the caller's save coordinator (see `WorkspaceHost`). */
	flushCurrent(): Promise<void> {
		return this.#flush(this.repository);
	}

	importGuest(ownerId: string, progress: (message: string) => void): Promise<void> {
		return (
			this.cloud?.importGuest(this.#local, ownerId, progress) ??
			Promise.reject(new Error('Sign in to import guest work into an account.'))
		);
	}

	dismissConflict(id: string) {
		this.cloud?.dismissConflict(id);
	}
}

export const [getCloudWorkspaceContext, setCloudWorkspaceContext, hasCloudWorkspaceContext] =
	createContext<CloudWorkspace>();

/** Components mounted without the layout (tests, previews) get a guest workspace. */
let fallback: CloudWorkspace | undefined;
export function getCloudWorkspace(): CloudWorkspace {
	if (hasCloudWorkspaceContext()) return getCloudWorkspaceContext();
	fallback ??= new CloudWorkspace();
	return fallback;
}
