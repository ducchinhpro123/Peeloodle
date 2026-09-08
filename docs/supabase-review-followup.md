# Cloud verification follow-up

## Verdict

**Historical finding:** the account-switch gate was not complete while navigation reseeding Account A remained. That harness defect, and the missing rejected-delete-in-a-pack coverage, are addressed in source; see the current claims in `supabase-integration-audit.md`. This note remains the record of what the independent rerun found. Do not deploy without owner approval of production configuration, SMTP/inbox, and the named revision.

## Independently rerun

- `npm test`: 107 passed.
- `npm run test:cloud`: all 8 existing tests passed, with the qualification below.
- `node --env-file=.env.cloud-test scripts/verify-cloud.mjs`: ordinary A/B/anonymous database and Storage authorization checks passed.
- Typecheck, production build, lint: passed; lint reports five existing Fast Refresh warnings and no errors.
- `vercel env ls production`: no production environment variables found.

No production configuration, deployment, migrations, invitations, or email delivery were performed. Verification created bounded fixtures using the existing dedicated test accounts.

## Confirmed gap: navigation silently restores Account A

`e2e/cloud.spec.ts:18–29` installs a persistent `context.addInitScript` that writes the supplied session into localStorage on every navigation. The A→B barrier tests subsequently call `page.goto('/my-stickers')`, which restores A before the assertion intended to examine B. An immediate `toHaveCount(0)` can also pass before the collection finishes loading.

Reproduced in a temporary copy of the existing test, without changing cloud application code or the committed test implementation. Added an assertion after navigation that `auth.getSession().data.session.user.email` still equals the configured B account. The original late-load test passes; the strengthened version fails with **Expected true; received false**, after five seconds.

Local evidence: `/tmp/stickerlab-cloud-review/cloud.spec.ts`, `playwright.config.ts`, and `check.log`. Reproduction command (no credential values in arguments):

```bash
STICKERLAB_CLOUD_TEST=1 node --env-file=.env.cloud-test node_modules/@playwright/test/cli.js test --config /tmp/stickerlab-cloud-review/playwright.config.ts --grep 'late private project response'
```

## Next steps for the cloud agent

1. Seed the initial session only once; never restore A implicitly after a switch or sign-out. Assert B remains authenticated after each navigation in all four A→B cases.
2. Wait for the held A response to finish, not merely for `route.continue()` to dispatch it. Establish that B's collection loaded (for example, a known B-owned fixture is visible) before asserting A's records are absent. Preserve explicit guest import consent, sign-out, guest-original retention, and repeat-import coverage.
3. Add a stale-delete-in-a-pack regression. `LocalProjectList.removeProject()` currently saves pack membership removals before submitting the project deletion; verify what happens when that deletion is rejected as stale, including whether the surviving sticker loses its pack membership. The new successful-deletion test does not cover that case.
4. Rerun the strengthened tests and update the audit's coverage claims. Prepare an exact reviewed source revision including the agreed canvas fixes, rather than requesting deployment of an evolving dirty worktree.
5. Request explicit owner approval for the exact production configuration and deployment, plus the selected SMTP service/sender and owner-controlled inbox. After approval, verify the real deployed magic-link callback and second-browser save/reopen/export.

Supabase's [SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp) confirms default delivery is restricted to team addresses and is not intended for production. [Redirect documentation](https://supabase.com/docs/guides/auth/redirect-urls) confirms the canonical Site URL and allowed callback requirements. Actual project SMTP/redirect configuration and real inbox delivery were not independently verified here.
