/**
 * Optional private cloud, against a production build whose public Supabase
 * configuration points at a synthetic project (`playwright.cloud.config.js`).
 *
 * Every `/auth/v1`, `/rest/v1` and `/storage/v1` request is answered by the
 * in-memory `SyntheticSupabase` below: PKCE sign-in, owner-scoped listing,
 * immutable artwork upload/download, the conflict-checked `commit_sticker_resource`
 * RPC, guest import and sign-out isolation all run through the app's real browser
 * integration. No real project, credentials or emails are involved.
 *
 * Live cross-user RLS/Storage verification still requires dedicated test accounts
 * and is reported as unavailable; these journeys are the synthetic substitute the
 * design asks for, not a claim about the deployed backend.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

const PHOTO = path.resolve('static/samples/cat-in-console.png');

type Row = { id: string; document: unknown; revision: number; deleted: boolean };
type Binary = { kind: string; logical_key: string; hash: string; metadata: unknown };
type SerializedRow = {
	kind: string;
	id: string;
	revision: number;
	deleted: boolean;
	value: unknown;
};
type Receipt = { resource: SerializedRow; original?: SerializedRow; conflict: boolean };
type User = { id: string; email: string };

/**
 * A minimal Supabase stand-in: enough of GoTrue (OTP, PKCE exchange, user, logout),
 * PostgREST (`projects`, `packs`, `project_binaries`, the commit RPC) and Storage
 * to drive the ported client. Rows and objects are keyed by owner, so the same
 * backend serves two accounts and proves isolation.
 */
class SyntheticSupabase {
	#users = new Map<string, User>();
	#codes = new Map<string, User>();
	#projects = new Map<string, Map<string, Row>>();
	#packs = new Map<string, Map<string, Row>>();
	#binaries = new Map<string, Binary[]>();
	#storage = new Map<string, Buffer>();
	#operations = new Map<string, Receipt>();
	otpEmails: string[] = [];

	registerUser(id: string, email: string) {
		this.#users.set(id, { id, email });
		return id;
	}

	/** A magic-link code the browser can exchange for that user's session. */
	issueCode(userId: string) {
		const user = this.#users.get(userId);
		if (!user) throw new Error(`no synthetic user ${userId}`);
		const code = `code-${userId}`;
		this.#codes.set(code, user);
		return code;
	}

	projectsFor(ownerId: string) {
		return [...(this.#projects.get(ownerId)?.values() ?? [])];
	}

	binariesFor(ownerId: string, projectId: string) {
		return this.#binaries.get(`${ownerId}:${projectId}`) ?? [];
	}

	uploads() {
		return this.#storage.size;
	}

	route(context: BrowserContext) {
		void context.route('**/auth/v1/**', (route) => this.#auth(route));
		void context.route('**/rest/v1/**', (route) => this.#rest(route));
		void context.route('**/storage/v1/**', (route) => this.#storageRoute(route));
	}

	#owner(route: Route): User | undefined {
		const header = route.request().headers().authorization ?? '';
		const token = header.startsWith('Bearer ') ? header.slice(7) : '';
		return this.#users.get(token.replace(/^access-/, ''));
	}

	async #auth(route: Route) {
		const url = new URL(route.request().url());
		if (url.pathname === '/auth/v1/otp' && route.request().method() === 'POST') {
			const body = JSON.parse(route.request().postData() ?? '{}') as { email?: string };
			this.otpEmails.push(String(body.email ?? ''));
			return json(route, 200, {});
		}
		if (url.pathname === '/auth/v1/token') {
			const body = JSON.parse(route.request().postData() ?? '{}') as { auth_code?: string };
			const user =
				this.#codes.get(String(body.auth_code ?? '')) ?? this.#users.values().next().value;
			if (!user) return json(route, 400, { error: 'invalid_grant', error_description: 'no user' });
			return json(route, 200, this.#session(user));
		}
		if (url.pathname === '/auth/v1/user') {
			const user = this.#owner(route);
			return user
				? json(route, 200, this.#userJson(user))
				: json(route, 401, { message: 'JWT expired' });
		}
		if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
		return json(route, 404, { message: 'not found' });
	}

	#session(user: User) {
		return {
			access_token: `access-${user.id}`,
			token_type: 'bearer',
			expires_in: 3600,
			expires_at: Math.floor(Date.now() / 1000) + 3600,
			refresh_token: `refresh-${user.id}`,
			user: this.#userJson(user)
		};
	}

	#userJson(user: User) {
		return {
			id: user.id,
			email: user.email,
			aud: 'authenticated',
			role: 'authenticated',
			app_metadata: { provider: 'email', providers: ['email'] },
			user_metadata: {},
			created_at: '2026-01-01T00:00:00.000Z'
		};
	}

	async #rest(route: Route) {
		const owner = this.#owner(route);
		const url = new URL(route.request().url());
		if (!owner) return json(route, 401, { message: 'JWT expired', code: 'PGRST301' });
		const table = url.pathname.replace('/rest/v1/', '');
		const select = url.searchParams.get('select') ?? '';
		const idFilter = url.searchParams.get('id')?.replace(/^eq\./, '');
		const projectFilter = url.searchParams.get('project_id')?.replace(/^eq\./, '');
		if (route.request().method() === 'GET') {
			if (table === 'projects' || table === 'packs') {
				const rows = [
					...((table === 'projects' ? this.#projects : this.#packs).get(owner.id)?.values() ?? [])
				]
					.filter((row) => !idFilter || row.id === idFilter)
					.sort((left, right) => left.id.localeCompare(right.id));
				if (select === 'revision') return json(route, 200, { revision: rows[0]?.revision ?? 0 });
				return json(route, 200, rows, {
					'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0'
				});
			}
			if (table === 'project_binaries') {
				const rows = (this.#binaries.get(`${owner.id}:${projectFilter}`) ?? []).map((row) => ({
					kind: row.kind,
					logical_key: row.logical_key,
					hash: row.hash,
					metadata: row.metadata
				}));
				return json(route, 200, rows, { 'content-range': `0-${rows.length}/${rows.length}` });
			}
			return json(route, 404, { message: `unknown table ${table}` });
		}
		if (route.request().method() === 'POST' && table === 'rpc/commit_sticker_resource') {
			return json(
				route,
				200,
				this.#commit(owner.id, JSON.parse(route.request().postData() ?? '{}'))
			);
		}
		return json(route, 404, { message: `unknown request ${table}` });
	}

	/**
	 * The wire contract of the existing `commit_sticker_resource` RPC: idempotent
	 * by operation id, conflicts when the base revision is stale, and a conflict
	 * copy with a new id when the incoming value must not overwrite the winner.
	 */
	#commit(
		ownerId: string,
		body: {
			operation_id?: string;
			resource_kind?: string;
			resource_id?: string;
			expected_revision?: number;
			body?: { id?: string; title?: string } | null;
			binaries?: Array<{ key: string; kind: string; hash: string; metadata: unknown }>;
		}
	): Receipt {
		const operationId = String(body.operation_id ?? '');
		const cached = this.#operations.get(operationId);
		if (cached) return cached;
		const kind = body.resource_kind === 'pack' ? 'pack' : 'project';
		const tables = kind === 'pack' ? this.#packs : this.#projects;
		const rows = tables.get(ownerId) ?? new Map<string, Row>();
		tables.set(ownerId, rows);
		const id = String(body.resource_id ?? '');
		const previous = rows.get(id);
		const conflict =
			(previous?.revision ?? 0) !== (body.expected_revision ?? 0) || !!previous?.deleted;
		let receipt: Receipt;
		if (conflict && !body.body) {
			if (!previous) throw new Error('Cannot delete unknown resource');
			receipt = { resource: serializeRow(kind, previous), conflict: true };
		} else {
			const nextId = conflict && body.body ? operationId : id;
			const value = body.body
				? {
						...body.body,
						id: nextId,
						title: `${body.body.title ?? ''}${conflict ? ' (conflict copy)' : ''}`
					}
				: previous!.document;
			const row: Row = {
				id: nextId,
				document: value,
				revision: nextId === id ? (previous?.revision ?? 0) + 1 : 1,
				deleted: !body.body
			};
			rows.set(nextId, row);
			if (kind === 'project' && !row.deleted && body.binaries)
				this.#binaries.set(
					`${ownerId}:${nextId}`,
					body.binaries.map((binary) => ({
						kind: binary.kind,
						logical_key: binary.key,
						hash: binary.hash,
						metadata: binary.metadata
					}))
				);
			receipt = {
				resource: serializeRow(kind, row),
				original: conflict && previous ? serializeRow(kind, previous) : undefined,
				conflict
			};
		}
		this.#operations.set(operationId, receipt);
		return receipt;
	}

	async #storageRoute(route: Route) {
		const owner = this.#owner(route);
		const url = new URL(route.request().url());
		if (!owner) return json(route, 401, { statusCode: '401', message: 'Invalid JWT' });
		const prefix = '/storage/v1/object/stickerlab-private/';
		if (!url.pathname.startsWith(prefix)) return json(route, 404, { message: 'not found' });
		const key = url.pathname.slice(prefix.length);
		if (route.request().method() === 'POST') {
			const upsert = route.request().headers()['x-upsert'] === 'true';
			if (this.#storage.has(key) && !upsert)
				return json(route, 409, {
					statusCode: '409',
					error: 'Duplicate',
					message: 'The resource already exists'
				});
			const raw = route.request().postDataBuffer() ?? Buffer.alloc(0);
			const contentType = route.request().headers()['content-type'] ?? '';
			// storage-js sends a Blob inside a FormData body; the stored object is the
			// file part itself, exactly as the real service unwraps it.
			this.#storage.set(
				key,
				contentType.startsWith('multipart/form-data') ? multipartFilePart(raw, contentType) : raw
			);
			return json(route, 200, { Key: `stickerlab-private/${key}` });
		}
		if (route.request().method() === 'GET') {
			const bytes = this.#storage.get(key);
			if (!bytes) return json(route, 404, { statusCode: '404', message: 'Object not found' });
			return route.fulfill({ status: 200, contentType: 'image/png', body: bytes });
		}
		return json(route, 405, { message: 'method not allowed' });
	}
}

function serializeRow(kind: string, row: Row): SerializedRow {
	return { kind, id: row.id, revision: row.revision, deleted: row.deleted, value: row.document };
}

/** The file part of a multipart upload body, as binary. */
function multipartFilePart(body: Buffer, contentType: string): Buffer {
	const boundary = /boundary=(.+)$/.exec(contentType)?.[1]?.trim();
	if (!boundary) return body;
	for (const part of body.toString('latin1').split(`--${boundary}`)) {
		if (!/filename=/.test(part)) continue;
		const headerEnd = part.indexOf('\r\n\r\n');
		if (headerEnd === -1) continue;
		let slice = part.slice(headerEnd + 4);
		if (slice.endsWith('\r\n')) slice = slice.slice(0, -2);
		return Buffer.from(slice, 'latin1');
	}
	return body;
}

function json(route: Route, status: number, body: unknown, headers: Record<string, string> = {}) {
	return route.fulfill({
		status,
		contentType: 'application/json',
		headers,
		body: JSON.stringify(body)
	});
}

const OWNER: User = {
	id: '11111111-1111-4111-8111-111111111111',
	email: 'cloud-owner@example.com'
};

/** One synthetic backend per journey, shared by every browser context in it. */
function backend(context: BrowserContext) {
	const synthetic = new SyntheticSupabase();
	synthetic.registerUser(OWNER.id, OWNER.email);
	synthetic.route(context);
	return synthetic;
}

async function signIn(page: Page, synthetic: SyntheticSupabase, user: User = OWNER) {
	await page.getByRole('button', { name: 'Guest account' }).click();
	const dialog = page.getByRole('dialog', { name: 'Sign in to StickerLab' });
	await expect(dialog).toBeVisible();
	await dialog.getByLabel('Email address').fill(user.email);
	await dialog.getByRole('button', { name: 'Request sign-in link' }).click();
	await expect(dialog.getByRole('status')).toContainText('Sign-in email requested');
	await page.keyboard.press('Escape');
	// The user opens the newest link: only the code matters to the app.
	await page.goto(`/auth/callback?code=${synthetic.issueCode(user.id)}`);
	await page.getByRole('button', { name: 'Continue sign-in' }).click();
	await expect(page.getByRole('button', { name: `Account: ${user.email}` })).toBeVisible({
		timeout: 30_000
	});
}

async function openNewEditor(page: Page) {
	await page.goto('/');
	await page.getByRole('link', { name: /Create a Sticker/ }).click();
	await expect(page).toHaveURL(/\/editor\/[0-9a-z-]+/, { timeout: 20_000 });
}

async function createSavedSticker(page: Page, title: string): Promise<string> {
	await openNewEditor(page);
	await page.setInputFiles('[data-testid="photo-file-input"]', PHOTO);
	await page.locator('[aria-label="Sticker title"]').fill(title);
	await page.getByRole('button', { name: /Save to My Stickers/ }).click();
	await expect(page.locator('.save-status')).toContainText('Saved to cloud', { timeout: 30_000 });
	const projectId = page.url().match(/editor\/([^/?#]+)/)?.[1];
	if (!projectId) throw new Error('The editor URL has no project id');
	return projectId;
}

/** The exported PNG's pixel digest, so two stickers can be compared by artwork. */
async function exportPixels(page: Page): Promise<string> {
	await page.getByRole('button', { name: /Export and share/ }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('radio', { name: 'Up to 512 px longest edge' }).check();
	const pending = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Download PNG' }).click();
	const file = await (await pending).path();
	if (!file) throw new Error('the export produced no file');
	const bytes = await readFile(file);
	return page.evaluate(async (base64) => {
		const bitmap = await createImageBitmap(
			new Blob([Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))], {
				type: 'image/png'
			})
		);
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d')!;
		context.drawImage(bitmap, 0, 0);
		bitmap.close();
		const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
		const digest = await crypto.subtle.digest('SHA-256', pixels);
		return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	}, bytes.toString('base64'));
}

test('signs in, saves stickers and a pack to the private workspace, and reopens them in a second browser', async ({
	browser
}) => {
	test.setTimeout(300_000);
	const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const second = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const synthetic = backend(first);
	synthetic.route(second);

	// 1 — sign in and save two stickers (the same photo twice, so the second
	// upload exercises the already-exists path of the private bucket).
	const page = await first.newPage();
	await page.goto('/');
	await signIn(page, synthetic);
	expect(synthetic.otpEmails).toContain(OWNER.email);
	const firstTitle = `Cloud cat ${Date.now()}`;
	const firstId = await createSavedSticker(page, firstTitle);
	const secondTitle = `Cloud dog ${Date.now()}`;
	await createSavedSticker(page, secondTitle);
	expect(synthetic.projectsFor(OWNER.id)).toHaveLength(2);
	expect(synthetic.binariesFor(OWNER.id, firstId)).toHaveLength(1);
	expect(synthetic.uploads()).toBeGreaterThan(0);
	const hash = await exportPixels(page);

	// A pack with an explicit membership order, saved to the account.
	await page.goto('/my-stickers');
	await page.getByRole('button', { name: 'New Pack' }).click();
	const createDialog = page.locator('dialog[open]');
	await createDialog.getByLabel('Pack Name').fill(`${firstTitle} pack`);
	await createDialog.getByRole('button', { name: 'Create Pack' }).click();
	await page.getByRole('button', { name: 'Add Stickers' }).click();
	const addDialog = page.locator('dialog[open]');
	await addDialog.getByRole('checkbox', { name: `Include ${firstTitle}`, exact: true }).click();
	await addDialog.getByRole('checkbox', { name: `Include ${secondTitle}`, exact: true }).click();
	await addDialog.getByRole('button', { name: 'Done' }).click();
	await expect(page.locator('.pack-sticker-tile strong')).toHaveText([firstTitle, secondTitle]);
	await page.getByRole('button', { name: `Move ${secondTitle} up` }).click();
	await expect(page.locator('.pack-sticker-tile strong')).toHaveText([secondTitle, firstTitle]);
	await expect(page.locator('.cloud-banner')).toContainText('Saved work is backed up', {
		timeout: 30_000
	});

	// 2 — a second browser signs into the same account and sees the collection
	// and the pack; the sticker reopens from the cloud cache and paints.
	const other = await second.newPage();
	await other.goto('/');
	await signIn(other, synthetic);
	await other.goto('/my-stickers');
	await expect(other.locator('.project-card-link', { hasText: firstTitle })).toBeVisible({
		timeout: 60_000
	});
	await expect(other.locator('.project-card-link', { hasText: secondTitle })).toBeVisible();
	// Open through the library, the path the app's own listing prepared.
	await other.locator('.project-card-link', { hasText: firstTitle }).click();
	await expect(other.locator('[aria-label="Sticker title"]')).toHaveValue(firstTitle, {
		timeout: 60_000
	});
	await expect(other.locator('.save-status')).toContainText('Saved to cloud', { timeout: 30_000 });
	expect(await exportPixels(other)).toBe(hash);

	// The pack's ordered ZIP is built from the account cache on device two.
	await other.goto('/my-stickers');
	await other.getByRole('button', { name: `${firstTitle} pack` }).click();
	const zipPending = other.waitForEvent('download');
	await other.getByRole('button', { name: 'Download ZIP' }).click();
	const zipFile = await (await zipPending).path();
	const zip = unzipSync(new Uint8Array(await readFile(zipFile!)));
	const manifest = JSON.parse(strFromU8(zip['manifest.json']!)) as {
		stickers: Array<{ title: string; filename: string }>;
	};
	expect(manifest.stickers.map((sticker) => sticker.title)).toEqual([secondTitle, firstTitle]);
	expect(zip[manifest.stickers[1]!.filename]).toBeTruthy();

	// 3 — a disconnect keeps local editing and saving, and the retry catches up.
	await other.route('**/rest/v1/**', (route) => route.abort());
	await other.route('**/storage/v1/**', (route) => route.abort());
	await other.locator('.project-card-link', { hasText: firstTitle }).click();
	await expect(other.locator('[aria-label="Sticker title"]')).toBeVisible({ timeout: 30_000 });
	await other.locator('[aria-label="Sticker title"]').fill(`${firstTitle} offline`);
	await other.getByRole('button', { name: /Save to My Stickers/ }).click();
	await expect(other.locator('.save-status')).toContainText('Saved locally · cloud pending', {
		timeout: 30_000
	});
	await other.reload();
	await expect(other.locator('[aria-label="Sticker title"]')).toHaveValue(`${firstTitle} offline`);
	await other.unroute('**/rest/v1/**');
	await other.unroute('**/storage/v1/**');
	await other.getByRole('button', { name: 'Refresh / retry cloud' }).click();
	await expect(other.locator('.save-status')).toContainText('Saved to cloud', { timeout: 60_000 });

	// 4 — sign-out hides the account cache; the guest library never lists it.
	await other.getByRole('button', { name: `Account: ${OWNER.email}` }).click();
	const account = other.getByRole('dialog', { name: 'Your private workspace' });
	await account.getByRole('button', { name: 'Sign out', exact: true }).click();
	await expect(other.getByRole('button', { name: 'Guest account' })).toBeVisible({
		timeout: 20_000
	});
	await other.goto('/my-stickers');
	await expect(other.getByRole('button', { name: 'Guest account' })).toBeVisible();
	await expect(other.getByRole('heading', { name: 'All Local Stickers' })).toBeVisible();
	await expect(other.locator('.project-card-link', { hasText: firstTitle })).toHaveCount(0);
	await other.goto(`/editor/${firstId}`);
	await expect(other.getByRole('heading', { name: 'Sticker not found' })).toBeVisible({
		timeout: 30_000
	});

	await first.close();
	await second.close();
});

test('a stale second-device save becomes a conflict copy instead of overwriting the winner', async ({
	browser
}) => {
	test.setTimeout(300_000);
	const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const second = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const synthetic = backend(first);
	synthetic.route(second);

	const page = await first.newPage();
	await page.goto('/');
	await signIn(page, synthetic);
	const title = `Conflict cat ${Date.now()}`;
	await createSavedSticker(page, title);
	const titles = () =>
		synthetic
			.projectsFor(OWNER.id)
			.map((row) => (row.document as { title: string }).title)
			.sort();

	// Device two loads the same revision, then device one saves a newer one.
	const other = await second.newPage();
	await other.goto('/');
	await signIn(other, synthetic);
	await other.goto(`/my-stickers`);
	await expect(other.locator('.project-card-link', { hasText: title })).toBeVisible({
		timeout: 60_000
	});
	await other.locator('.project-card-link', { hasText: title }).click();
	await expect(other.locator('[aria-label="Sticker title"]')).toHaveValue(title, {
		timeout: 60_000
	});
	await page.locator('[aria-label="Sticker title"]').fill(`${title} winner`);
	await page.getByRole('button', { name: /Save to My Stickers/ }).click();
	// The newer revision is on the backend before device two saves from its base.
	await expect.poll(titles, { timeout: 60_000 }).toEqual([`${title} winner`]);

	// Device two saves from its stale base: the winner is kept and the edit lands
	// as an independent conflict copy with a notice, not as an overwrite.
	await other.locator('[aria-label="Sticker title"]').fill(`${title} loser`);
	await other.getByRole('button', { name: /Save to My Stickers/ }).click();
	await expect
		.poll(titles, { timeout: 60_000 })
		.toEqual([`${title} loser (conflict copy)`, `${title} winner`]);
	await expect(other.locator('.cloud-banner')).toContainText('Conflict copy saved', {
		timeout: 60_000
	});
	await other.goto('/my-stickers');
	await expect(other.locator('.project-card-link', { hasText: `${title} winner` })).toBeVisible();
	await expect(other.locator('.project-card-link', { hasText: 'conflict copy' })).toBeVisible();

	await first.close();
	await second.close();
});

test('guest work is offered for import, copied into the account, and its originals are kept', async ({
	browser
}) => {
	test.setTimeout(300_000);
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const synthetic = backend(context);
	const page = await context.newPage();
	await page.goto('/');
	const title = `Guest cat ${Date.now()}`;
	await openNewEditor(page);
	await page.setInputFiles('[data-testid="photo-file-input"]', PHOTO);
	await page.locator('[aria-label="Sticker title"]').fill(title);
	await page.getByRole('button', { name: /Save to My Stickers/ }).click();
	await expect(page.locator('.save-status')).toContainText('Saved locally', { timeout: 20_000 });

	await page.goto('/');
	await signIn(page, synthetic);
	// Signing in never uploads guest work on its own: the dialog asks first.
	const account = page.getByRole('dialog', { name: 'Your private workspace' });
	await expect(
		account.getByRole('button', { name: 'Import guest collection / retry' })
	).toBeVisible({
		timeout: 20_000
	});
	await account.getByRole('button', { name: 'Import guest collection / retry' }).click();
	await expect(page.getByText(/Import saved to cloud/)).toBeVisible({ timeout: 60_000 });
	expect(synthetic.projectsFor(OWNER.id)).toHaveLength(1);
	await page.keyboard.press('Escape');
	await page.goto('/my-stickers');
	await expect(page.locator('.project-card-link', { hasText: title })).toBeVisible({
		timeout: 30_000
	});

	// Import is idempotent (a second click must not duplicate), and the guest
	// originals stay in the local database after sign-out.
	await page.getByRole('button', { name: `Account: ${OWNER.email}` }).click();
	const signedIn = page.getByRole('dialog', { name: 'Your private workspace' });
	await signedIn.getByRole('button', { name: 'Import guest collection / retry' }).click();
	await expect(
		signedIn.getByRole('button', { name: 'Import guest collection / retry' })
	).toBeEnabled({
		timeout: 60_000
	});
	expect(synthetic.projectsFor(OWNER.id)).toHaveLength(1);
	await signedIn.getByRole('button', { name: 'Sign out', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Guest account' })).toBeVisible({
		timeout: 20_000
	});
	await page.goto('/my-stickers');
	await expect(page.locator('.project-card-link', { hasText: title })).toBeVisible();
	await context.close();
});

for (const viewport of [
	{ width: 1440, height: 900 },
	{ width: 1024, height: 768 },
	{ width: 390, height: 844 }
]) {
	test(`the account dialog and an invalid callback stay usable at ${viewport.width}`, async ({
		browser
	}) => {
		const context = await browser.newContext({ viewport });
		backend(context);
		const page = await context.newPage();
		await page.goto('/');
		await page.getByRole('button', { name: 'Guest account' }).click();
		const dialog = page.getByRole('dialog', { name: 'Sign in to StickerLab' });
		await expect(dialog.getByLabel('Email address')).toBeFocused();
		await expect(dialog.getByRole('button', { name: 'Request sign-in link' })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('button', { name: 'Guest account' })).toBeFocused();
		await page.goto('/auth/callback?error=access_denied&next=https://example.invalid');
		await expect(page.getByRole('alert')).toContainText('Request a fresh link');
		await expect(page).toHaveURL(/\/auth\/callback$/);
		await context.close();
	});
}
