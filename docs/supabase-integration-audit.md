# Supabase private-cloud integration audit

Date: 2026-09-08. Spec: [`specs/supabase-private-cloud.md`](specs/supabase-private-cloud.md).

## Verdict

**Harness follow-up is addressed in source; production is still not configured and must not be deployed without owner approval.** The defect in [the verification follow-up](supabase-review-followup.md) was a test-harness reseed of Account A on every navigation, not a demonstrated application data leak. Session seeding is now one-shot; the four same-browser A→B cases assert B’s session email after isolation navigations, wait for the held Account A response to finish, wait until a known B-owned fixture is visible, then assert A’s records are absent. Guest import still covers explicit consent, sign-out, guest-original retention, and repeat-import. A rejected stale project delete in a pack now keeps membership; that case is covered separately from the successful-delete path.

**Code is ready for review on the revision named at handoff.** The deployed Vercel app still has cloud functionality disabled by missing configuration; real magic-link delivery/callback success is not claimed. Do not treat a green local/cloud suite as production acceptance.

Completion labels: **Code ready** — yes, pending owner review of the named revision. **Production configured/deployed** — no; Vercel production has no environment variables. **Real authentication verified** — no; no owner-controlled inbox was authorized. **End-to-end cloud acceptance** — configured test environment passes the strengthened checks; deployed acceptance remains blocked by the preceding two items.

This is a current-implementation audit. The editor canvas/UI restyle (Back to Home, title/save chrome, Adjust inspector) is retained. No production configuration changes, migrations, deployments, invitations, or emails were performed. Real verification created small fixtures only through the existing dedicated ordinary test accounts.

## Confirmed findings

### F1 — Production cloud configuration is missing (release blocker)

- `vercel env ls production`: **No Environment Variables found** for `ducchinhpro123s-projects/stickerlab`.
- Playwright opened `https://stickerlab-eta.vercel.app`, clicked Guest account, and found: **“Cloud saving is not configured for this site.”** No Supabase requests were observed during that check.
- `src/features/auth/client.ts:5–15` requires a valid public URL/key and an exact match for `window.location.origin` in `VITE_AUTH_ALLOWED_ORIGINS`. Failing any check intentionally makes the app local-only.
- Local `.env.local` also lacked the three Vite cloud variables at audit time. The successful cloud browser tests used a separate, explicitly configured development server, not this production deployment.

Required production build inputs:

```dotenv
VITE_SUPABASE_URL=https://ckmeozlmyvhjrzliwllz.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<enabled public/publishable key, never service-role>
VITE_AUTH_ALLOWED_ORIGINS=https://stickerlab-eta.vercel.app
```

Add any other intended application origins explicitly. Configure matching Supabase Auth redirects, including `https://stickerlab-eta.vercel.app/auth/callback`, and the canonical Site URL. Vite embeds these values at build time: setting Vercel variables alone does not update an existing deployment; a newly authorized build/deployment is required. Current Supabase Site URL/redirect/SMTP settings were not accessible through the exposed MCP tools and were not independently verified.

Production deployment observed: `dpl_2QPmCu4AfjRFJJk6pt3LpVXAAAtZ`, Ready, URL `stickerlab-3sz1rs171-ducchinhpro123s-projects.vercel.app`, alias `stickerlab-eta.vercel.app`. Public account-dialog screenshot: `/tmp/stickerlab-cloud-audit/production-account.png`.

### F2 — A stale sticker-delete confirmation can delete a newer cloud revision (fixed)

Spec requirement: “Deletes must also detect stale versions.”

Locations:

- `src/features/editor/LocalProjectList.tsx`: the confirmation now passes the selected project object through deletion.
- `src/lib/persistence/cloud.ts`: project listing binds a revision token to each listed object, and deletion passes that captured token to the queue.
- `src/lib/persistence/repository.ts`: the shared delete boundary accepts the explicit baseline while retaining the existing fallback for ordinary callers.
- `src/lib/persistence/cloudRemote.ts`: the captured baseline remains the RPC's `expected_revision`.

The original behavior was reproduced against real Supabase using two `CloudRepository` instances for the same dedicated account. The focused regression now repeats the sequence with the in-memory remote and verifies the safe result:

1. Create a fixture and synchronize revision 1.
2. Device B lists it and retains the old project as a confirmation target, without opening the editor.
3. Device A changes the document and commits revision 2.
4. Device B refreshes (the application's online handler can do this while a dialog remains open).
5. Device B deletes the old listed ID.

The original behavior tombstoned revision 2 as revision 3 with no conflict notice. The fixed path carries a captured server-revision token from project listing/selection through the delete confirmation at the repository boundary, as already done for packs. The focused regression edits on device A, refreshes device B while its old selection remains, and verifies that the newer document survives with a recoverable notice. The editor document revision is not used as the server concurrency revision.

Clearing pack membership before delete used to leave a surviving sticker out of its pack when that delete was rejected as stale. `removeProject` now restores membership after a rejected delete; a dedicated cloud unit test covers that sequence. The successful-delete-after-clearing-membership test still passes.

### F3 — Signed-in deletion is described as device-only (fixed)

`src/features/editor/LocalProjectList.tsx` now distinguishes browser-local guest deletion from removal across the private account and explains that pack membership is removed while other stickers remain.


## Release-verification gaps

### G1 — Real magic-link authentication is not demonstrated

The spec explicitly requires production email delivery and a real successful callback, not just synthetic sessions (`specs/supabase-private-cloud.md:49,76`).

- `e2e/cloud.spec.ts:11–36` signs in test accounts with passwords and injects sessions. It does **not** exercise the app's email-link success path.
- The callback browser coverage tests an invalid callback, not successful PKCE exchange, used-link retry, or real email delivery.
- The public Auth settings confirmed email authentication is enabled, signups are allowed, and email auto-confirm is disabled. Those settings do not prove custom SMTP, allowed redirects, or deliverability.
- README already acknowledges that inbox delivery remains unverified. This audit did not send mail or access an inbox.

Verify Site URL/redirects and SMTP in the Supabase dashboard, then test one owner-controlled inbox through the deployed app: request → delivered link → same-browser callback → authenticated workspace → save/reopen. Supabase's default mail service is restricted and is not a production delivery substitute; see the [SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp) and [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod). No paid provider or upgrade is authorized by this audit.

### G2 — Same-browser A→B isolation (fixed, with strengthened waits)

The follow-up found that `context.addInitScript` rewrote Account A on every `goto`, so isolation assertions could run as A (or against an empty list). The harness now writes the seeded session only when auth storage is empty and is not signed out; switches use `setSession`. All four A→B cases assert `auth.getSession().data.session.user.email` is still B after switch and after each isolation navigation, wait for the held A response to finish (`route.fetch` + fulfill, not only `continue()`), wait until a known B-owned fixture is visible, then assert A’s title is absent. Guest import still covers explicit consent, Not now on B, sign-out, guest-original retention, and a repeat import that does not duplicate the sticker.

Synthetic password sessions remain a test seam; they do not replace real magic-link verification (G1).

### G3 — Cloud test execution was not self-contained (fixed)

`npm run test:cloud` now loads `.env.cloud-test` only in the test process, derives `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and the exact `VITE_AUTH_ALLOWED_ORIGINS` for `127.0.0.1:4174`, refuses missing dedicated variables, and uses `reuseExistingServer: false`. GitHub CI remains local-only and does not require cloud secrets.

## What passed

### Live infrastructure and authorization

- Supabase project `ckmeozlmyvhjrzliwllz` / StickerLab is `ACTIVE_HEALTHY`, Singapore (`ap-southeast-1`), in the specified organization.
- Both committed migrations are applied: `20260907150553_private_cloud` and `20260907233503_immutable_binary_identities`.
- All six exposed public tables have RLS enabled. Authenticated clients have owner-scoped read access to the application tables; writes go through the RPC. Anonymous execution of the commit RPC is denied. The function uses an empty search path and derives identity from `auth.uid()`.
- `stickerlab-private` is private; size limit is 15 MiB; allowed MIME types are PNG, JPEG, and WebP. Owner-scoped reads/inserts exist; no ordinary-client update/delete policy permits mutation of committed bytes.
- `scripts/verify-cloud.mjs` passed real ordinary-user A/B/anonymous checks: database and Storage isolation, forged membership rejection, immutable object and logical identities, incomplete-publication rejection, project/pack compare-and-set conflicts, stale server-side deletes, tombstones, pack order, and idempotent commit receipts.
- Additional read checks confirmed B and anonymous callers cannot read A's rows in projects, packs, pack_items, project_binaries, binary_versions, or cloud_operations.
- A narrow scan found no occurrence of the dedicated test password in tracked files or built assets. This is not a claim of a comprehensive secret-history audit.

### Application behavior with configuration supplied

Eight cloud Playwright tests passed on an isolated cloud-enabled Vite server at `http://127.0.0.1:4174` using the existing ordinary test accounts:

- Upload, transformed mask, and bundled font saved remotely.
- A second isolated browser reopened the document and produced the same decoded PNG pixel hash, with correct dimensions/transparency.
- A renamed two-sticker pack preserved description/order; its exported ZIP manifest and PNG pixels matched.
- Blocked Supabase requests preserved local editing and pending work through reload; reconnect/retry synchronized it.
- Sign-out hid account work; guest originals survived explicit, repeat-safe import.
- Same-page A → B transitions during private loading, binary upload, save, and guest import kept A's work out of B: B remained authenticated after isolation navigations, the held A response finished, a B-owned fixture was visible, then A's title was absent. Guest import consent, sign-out, guest originals, and repeat-import passed.
- Account and invalid-callback UI worked at 1440×900, 1024×768, and 390×844.

The three selected unconfigured guest browser journeys also passed: dashboard create/edit/save/reload/PNG, mobile save/reopen/export, and pack ZIP export.

### Spec coverage summary

| User stories | Assessment |
| --- | --- |
| 1–2: guest operation/data retention | Guest browser flows and atomic local persistence passed; a dedicated pre-upgrade IndexedDB migration fixture was not run. |
| 3–5: magic-link request/callback/errors | UI and code exist; invalid callback checked; real delivery and successful callback remain a release gate. |
| 6–9: drafts, identity, sign-out, workspace isolation | Flush/epoch/scoped-client mechanisms implemented; same-page in-flight load/upload/save/import isolation passed with one-shot seeding, B session assertions, held-response completion, and a visible B fixture before asserting A is absent. |
| 10–13: explicit repeat-safe guest import | Consent, retry, original retention, and ordered mappings implemented; browser and repository tests passed for covered cases. |
| 14–18: local-first/offline/status/session failure | Repository tests plus real offline/reload/retry journey passed; session-expiry error handling tested at repository level. |
| 19–21: second-device restoration/export | Real second-browser mask/font/PNG and ZIP parity passed with configuration supplied. |
| 22–24: packs/order/deletion/conflicts | Real RPC conflicts and ordering passed; pack deletion retains stickers; stale project deletion is covered, including rejected-delete-in-a-pack membership restore. Successful-delete-after-clearing-membership remains covered separately. |
| 25–26: conflicts/idempotence | Real RPC compare-and-set and receipt checks passed; lost-response client recovery unit test passed. |
| 27: corrupt/unsupported remote data | Client validation and recoverable error paths inspected; not every corrupt remote-record/binary scenario was browser-injected. |
| 28: cross-user privacy | Real authorization tests and live grants/policies checked; no cross-user access observed. |
| 29: accessible cloud controls | Account/import UI and invalid callback checked at desktop/tablet/mobile; transition coverage runs at the mobile workspace where account switching is most constrained. |
| 30: migrations/config/security tests | Schema/types/setup/tests present; production configuration and real inbox verification remain owner actions. |

### Security Advisor interpretation

Three notices were returned:

- [`cloud_operations` RLS without a policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy): intentional deny-all journal; ordinary client grants are revoked.
- [Authenticated SECURITY DEFINER RPC](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable): intentional transactional write boundary; checked identity/search path/grants and exercised it with ordinary clients. Not an automatic reason to remove the function.
- [Leaked password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection): hardening consideration. The product's requested flow is passwordless, although dedicated tests use password accounts. Do not purchase a plan or enable a paid feature implicitly.

## Checks run

```sh
vercel project inspect
vercel env ls production
vercel inspect https://stickerlab-eta.vercel.app
vercel inspect https://stickerlab-eta.vercel.app --json
gh run list --repo ducchinhpro123/Peeloodle --limit 5 --json status,conclusion,headSha,workflowName,url
node --env-file=.env.cloud-test scripts/verify-cloud.mjs
npm run test:cloud
npm run typecheck
npm run lint
npm test
npm run build
npm run test:browser -- e2e/editor.spec.ts --grep "dashboard create|mobile editor|pack creation" --workers=1
```

Results: **108 unit/integration tests (including rejected stale-delete-in-a-pack) and eight cloud browser tests with the strengthened A→B waits passed**. Typecheck/build are recorded with this increment. Lint had zero errors and pre-existing Fast Refresh warnings. Browser execution used Chromium at `/usr/bin/chromium`; Firefox/WebKit were not exercised. Production configuration, SMTP/inbox, and deployment were not applied.

For the isolated browser run, only the child Vite process received `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` from the dedicated test configuration and `VITE_AUTH_ALLOWED_ORIGINS=http://127.0.0.1:4174`. No environment file or Vercel setting was overwritten. Local artifacts/config/logs are in `/tmp/stickerlab-cloud-audit/`; they are not committed. The separate audit Vite process was stopped afterward.

## Recommended completion order

1. With explicit owner approval, set the public production environment variables, verify Supabase redirect/SMTP settings, and rebuild/redeploy from the approved source revision.
2. Use an owner-controlled inbox to verify the actual deployed magic-link journey, then repeat second-browser cloud save/reopen/export against that deployment.

Public sharing, cloud favorites/export history, messenger installation, and billing are explicitly out of this spec; their absence is not an integration defect.
