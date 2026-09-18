# P53 — live catalog isolation against a dedicated Supabase project

**Date:** 2026-09-19 (run 2026-09-18 23:2x–23:3x UTC)
**Plan row:** P53 — run live catalog isolation checks with anonymous, ordinary and admin
clients in a test environment.
**Result:** **10/10 live checks pass** on a real, dedicated Supabase project, plus an
operator-driven role-revocation cycle (grant → admin RPC succeeds → revoke → denied).
`scripts/verify-catalog.mjs` was run with the project's publishable key and real signed-in
accounts; service-role/secret credentials were used only to provision the two test accounts and
one published fixture asset, never to act as a user.

## Environment

| Item         | Value                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| Project      | `peeloodle-catalog-test` — ref `wkmivbdheoynxaqolzdr`                                            |
| Organization | `tehottmpdqzssgrvbcqg` (free plan; `--size` cannot be specified on free plan)                    |
| Region       | Southeast Asia (Singapore), `ap-southeast-1`                                                     |
| Created      | 2026-09-18 18:50:25 UTC via `npx supabase projects create`                                       |
| Keys used    | publishable key (`sb_publishable_…`) by the verifier; secret key only for provisioning           |
| Local config | `.env.catalog-test` (gitignored, `chmod 600`) with the URL, publishable key and test credentials |
| CLI          | `npx supabase` 2.117.0                                                                           |

The production project (`StickerLab`, `ckmeozlmyvhjrzliwllz`) was **not** touched; the repository
documents it as provisioned production and the plan requires a dedicated test project.

## Migrations applied

`npx supabase link --project-ref wkmivbdheoynxaqolzdr` followed by
`npx supabase db push --linked` applied the 11 committed migrations in order:

```
20260907150553_private_cloud.sql
20260907233503_immutable_binary_identities.sql
20260916120000_catalog_schema.sql
20260916120100_catalog_policies.sql
20260916120200_catalog_admin_rpcs.sql
20260916160000_catalog_uploads.sql
20260916170000_catalog_claim_job.sql
20260916180000_catalog_template_drafts.sql
20260918120000_catalog_template_version_saves.sql
20260918140000_catalog_template_previews.sql
20260918160000_catalog_template_validation.sql
```

## Test accounts and fixture

- `peeloodle-catalog-admin@example.com` (`fe5dfc6d-a174-4eb6-b772-cd815f8433fb`) — created through
  the Auth admin API with `email_confirm: true`, then granted membership with
  `insert into public.catalog_admins (user_id) values (…) on conflict do nothing`.
- `peeloodle-catalog-user@example.com` (`9a6f8635-3914-403b-9cc0-8a444cf4d3b6`) — confirmed, not a
  member.
- A published fixture asset (so the signed-URL check can run): asset
  `22222222-2222-4222-8222-222222222222`, validated version
  `33333333-3333-4333-8333-333333333333`, derivative
  `assets/22222222-…/33333333-…/image.png`, 262 488 bytes, 256×256, sha256 `c407a072…` (the
  repository's fixture PNG), uploaded to the private `catalog-derivatives` bucket, then published by
  operator SQL (`update … state='published', published_version_id=…`).

## Checks run

```bash
node --env-file=.env.catalog-test scripts/verify-catalog.mjs
```

| Check (live, over HTTPS against the project)                                  | Result |
| ----------------------------------------------------------------------------- | ------ |
| admin predicate distinguishes admin, ordinary and anonymous clients           | ok     |
| ordinary and anonymous clients cannot call admin RPCs                         | ok     |
| ordinary and anonymous clients cannot insert catalog rows directly            | ok     |
| ordinary and anonymous clients cannot write the catalog buckets               | ok     |
| membership, upload bookkeeping and the audit journal are invisible            | ok     |
| ordinary clients read published metadata only                                 | ok     |
| a draft stays invisible to everyone but an admin, and publish reveals it      | ok     |
| a publish race resolves to exactly one conflict                               | ok     |
| a published derivative is fetchable through a signed URL (user and anonymous) | ok     |
| archive removes the collection from ordinary reading                          | ok     |

**10 checks passed.**

### Role revocation (operator SQL around a fresh sign-in each time)

| Phase                                         | `catalog_is_admin` | `catalog_admin_create_collection`                                |
| --------------------------------------------- | ------------------ | ---------------------------------------------------------------- |
| ordinary account, no membership               | `false`            | denied `42501`                                                   |
| after operator `insert` into `catalog_admins` | `true`             | `{ok:true,…}` (draft created, then archived by the same account) |
| after operator `delete` from `catalog_admins` | `false`            | denied `42501`                                                   |

## Reproduce

1. `.env.catalog-test` with `SUPABASE_TEST_URL`, `SUPABASE_TEST_KEY` (publishable), admin/user
   emails and passwords, and optionally `SUPABASE_TEST_PUBLISHED_ASSET_ID`.
2. `node --env-file=.env.catalog-test scripts/verify-catalog.mjs`.
3. For revocation: `insert`/`delete` the account's row in `public.catalog_admins` (operator SQL, as
   documented in `supabase/README.md`) and re-run the admin RPCs as that account.

## Boundaries this does not cover

- **P08** (native processing packaging in an authorized preview environment) is a separate,
  still-open milestone-0 item; the processing endpoint is not deployed for this test project, so
  the verifier seeds the published asset by operator SQL instead of the upload/processing path.
- The **app UI** was not exercised against this project; P53 is a backend isolation check.
- The project is dedicated test infrastructure. The publishable key is public by design; the secret
  key and account passwords live only in gitignored local files and are not recorded here.
