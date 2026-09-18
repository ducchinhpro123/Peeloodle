// Seed the three shipped presentation templates (P72–P74) as catalog drafts.
//
// The documents themselves live in
// `src/lib/presentations/templates/shippedTemplates.js`, the same module the app
// and its tests use, so there is one source of truth. This script only creates
// the atomic draft (stable template + first immutable pending version) through
// the guarded RPC, using an administrator's own access token: it never uses a
// service-role key, and it never publishes anything. Slide previews, validation
// and publication stay explicit actions in `/admin/templates`, as the design
// requires.
//
// Usage:
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_PUBLISHABLE_KEY=<publishable anon key> \
//   SUPABASE_ADMIN_ACCESS_TOKEN=<admin's access token> \
//   node scripts/seed-template-catalog.mjs
//
// Add `--dry-run` to print the documents' hashes and sizes without network.
import { createHash } from 'node:crypto';
import { SHIPPED_TEMPLATES } from '../src/lib/presentations/templates/shippedTemplates.js';

const dryRun = process.argv.includes('--dry-run') || process.env.SEED_DRY_RUN === '1';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
const token = process.env.SUPABASE_ADMIN_ACCESS_TOKEN;

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

if (!dryRun && (!url || !key || !token)) {
	fail(
		'set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_ADMIN_ACCESS_TOKEN (or pass --dry-run)'
	);
}

for (const template of SHIPPED_TEMPLATES) {
	const document = template.build();
	const json = JSON.stringify(document);
	const bytes = Buffer.byteLength(json);
	const sha256 = createHash('sha256').update(json).digest('hex');
	const slides = document.slides.length;
	process.stdout.write(
		`${template.key}: ${template.title} — ${slides} slides, ${bytes} bytes, sha256 ${sha256.slice(0, 12)}…\n`
	);
	if (dryRun) continue;

	let response;
	try {
		response = await fetch(`${url}/rest/v1/rpc/catalog_admin_create_template_draft`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				apikey: key,
				authorization: `Bearer ${token}`
			},
			body: JSON.stringify({
				p_title: template.title,
				p_use_case: template.useCase,
				p_description: template.description,
				p_tags: template.tags,
				p_sort_order: template.sortOrder,
				p_document: JSON.parse(json),
				p_document_sha256: sha256,
				p_document_bytes: bytes,
				p_font_requirements: [
					{ fontId: document.theme.headingFontId },
					{ fontId: document.theme.bodyFontId }
				]
			})
		});
	} catch (error) {
		fail(`could not reach ${url}: ${error instanceof Error ? error.message : error}`);
	}

	if (response.status === 401 || response.status === 403) {
		fail(
			'the access token was refused; sign in as a catalog administrator and use that session token'
		);
	}
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		fail(`RPC failed (${response.status}): ${JSON.stringify(payload)}`);
	}
	if (!payload || payload.ok !== true) {
		fail(`draft refused: ${JSON.stringify(payload)}`);
	}
	process.stdout.write(
		`  created draft ${payload.item.template.id} (version ${payload.item.version.version_number})\n`
	);
}

if (dryRun) {
	process.stdout.write('dry run: nothing was written.\n');
} else {
	process.stdout.write(
		'Done. Generate previews, validate and publish each draft in /admin/templates.\n'
	);
}
