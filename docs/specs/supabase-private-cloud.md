# Supabase magic-link authentication and private cloud saving

## Problem Statement

StickerLab currently saves stickers, source images, masks, and packs on one browser through IndexedDB. Users cannot sign in, recover their work on another device, or distinguish a local save from a cloud backup. Adding cloud access must not compromise working guest editing, lose offline edits, or expose private photos to another user.

## Solution

Add email magic-link sign-in and private cloud saving using Supabase Auth, PostgreSQL, and private Storage. Keep local saves as the first durable step. Signed-in users can reopen their cloud stickers and packs on another device, explicitly import existing guest work, and retry failed synchronization without losing local data. Preserve conflicting edits as independent copies instead of silently overwriting them. Public sharing is not part of this milestone.

## User Stories

1. As a guest, I want to create, edit, save, reopen, and export stickers without signing in, so that cloud setup is optional.
2. As a guest, I want existing local work to survive the upgrade, so that enabling cloud features does not reset my collection.
3. As a user, I want to request a sign-in link by email, so that I do not have to manage a password.
4. As a user, I want clear request, delivery-requested, failure, and retry states, so that I know whether to check my inbox or try again.
5. As a user, I want expired, invalid, and already-used links handled recoverably, so that I can request a fresh link.
6. As a user, I want sign-in to preserve my current draft, so that authentication does not interrupt editing.
7. As a signed-in user, I want my actual account identity displayed, so that I know whose private workspace is active.
8. As a signed-in user, I want to sign out, so that another person cannot browse my account through the app.
9. As a user on a shared browser, I want account-specific local caches and in-flight work isolated, so that switching accounts cannot expose or upload another person's work.
10. As a guest signing in, I want to choose whether to import my guest collection, so that signing in does not upload private local photos without my consent.
11. As a user importing guest work, I want stickers, required uploads, masks, and ordered packs copied together, so that the imported collection remains usable.
12. As a user importing guest work, I want interrupted imports to resume without duplicates, so that retrying is safe.
13. As a user importing guest work, I want the original local data retained, so that a partial cloud failure cannot destroy my collection.
14. As a signed-in creator, I want edits saved locally before cloud synchronization, so that network failures do not lose completed work.
15. As a creator, I want local-save and cloud-sync states distinguished, so that “Saved to cloud” means my current saved composition is actually recoverable remotely.
16. As an offline user, I want to edit previously downloaded stickers and export them, so that a connection is not required for cached work.
17. As an offline user, I want pending changes to survive a reload and retry when connected, so that closing the page does not forget unfinished synchronization.
18. As a user with an expired session, I want local edits preserved and a sign-in prompt, so that authentication failure is recoverable.
19. As a user on a second device, I want to list and reopen my cloud stickers, so that I can continue editing elsewhere.
20. As a user reopening a sticker, I want original images, crops, masks, text, fonts, outlines, filters, and layer order restored, so that the composition matches my saved work.
21. As a user exporting a cloud sticker, I want the same transparent PNG and ordered pack ZIP output as local editing, so that cloud storage does not change rendering.
22. As a pack owner, I want pack creation, renaming, descriptions, duplication, membership, and ordering saved across devices, so that my collection stays organized.
23. As a pack owner, I want deleting a pack to preserve its stickers, so that removing a collection does not destroy artwork.
24. As a user making offline changes to a pack, I want those changes synchronized without silently replacing newer remote changes, so that organization work is not lost.
25. As a user editing on two devices, I want a visible conflict copy when both change the same sticker, so that both versions remain available.
26. As a user retrying an uncertain save, I want the operation to avoid duplicate conflict copies or imported projects, so that a lost response does not duplicate my collection.
27. As a user encountering missing or corrupt remote data, I want a recoverable error that leaves local work intact, so that one bad record does not destroy other projects.
28. As a private account owner, I want other accounts and anonymous visitors blocked from my documents, source images, masks, and packs, so that private content stays private.
29. As a mobile or keyboard user, I want accessible account, import, retry, and conflict controls, so that cloud features remain usable on every supported layout.
30. As a maintainer, I want reproducible migrations, configuration instructions, and security tests, so that the integration can be deployed and verified without browser secrets.

## Implementation Decisions

- Preserve React, TypeScript, Vite, Zustand, the existing serializable ProjectDocument, and the repository-provider boundary. Do not replace editor commands or introduce a second document model. Add the supported Supabase JavaScript client using the existing npm lockfile.
- Use the provisioned StickerLab project, reference `ckmeozlmyvhjrzliwllz`, in Singapore (`ap-southeast-1`), organization `tehottmpdqzssgrvbcqg`. Creation was approved at the quoted $0/month; this is not a guarantee of unlimited usage or authorization for paid upgrades.
- Add email magic-link authentication, session restoration, sign-out, and a callback route. Use explicitly allowed redirect origins and a safe internal return destination; never accept arbitrary external return URLs. Handle token exchange failures and request throttling without claiming email delivery merely because a request succeeded.
- Configure development and deployment callback URLs. Verify current Supabase email-delivery restrictions and redirect behavior before implementation. Production email delivery must be verified; if custom SMTP or domain ownership requires the owner, document the blocker rather than presenting restricted test delivery as launch-ready.
- Initialize cloud functionality only when valid public configuration is available. Without configuration, retain full local-only operation with an honest account setup explanation. Ship placeholder environment examples; never ship service-role credentials, SMTP secrets, or privileged tokens to the frontend or logs.
- Keep guest data separate from account-scoped local caches. Bind each asynchronous load/save/sync/import operation to its originating user and workspace. On sign-out or account change, flush recoverable work to its originating local workspace, invalidate stale callbacks, clear rendered private data and runtime resources, and prevent queued work from replaying under a different identity. Do not silently turn an account cache into guest data. Retained account caches are not a promise of encryption against someone controlling the device.
- Extend the existing repository boundary with the minimum coordination needed for local-first persistence and observable sync status. Do not require each editor control to implement cloud writes. Keep a durable pending-operation record and remote base revision per resource so reloads and retries preserve unsynchronized work.
- Keep local document/asset/mask writes atomic. Cloud failure must not reverse a successful local transaction. Distinguish unsaved, saving locally, saved locally/pending cloud, syncing, saved to cloud, and failure states. Cloud acknowledgment applies only to the uploaded snapshot; newer edits remain pending.
- Store project documents as validated versioned JSONB with owner, stable identifier, timestamps, and server-controlled concurrency revision. Keep remote concurrency revision separate from the editor revision counter. Store asset metadata separately and image/mask bytes in private Storage, never base64 document columns or permanent signed URLs.
- Add owner-scoped projects, asset/mask metadata, packs, and ordered pack membership. Enforce unique membership per project per pack and ownership-consistent references in the database. Packs reference projects rather than owning their lifetime; duplicating a pack retains references to its existing stickers and creates independent membership order.
- Use immutable object identities for original uploads and saved mask versions. Upload and verify every required binary before publishing references in a transactional database commit. PostgreSQL and Storage are not one transaction: incomplete uploads must never publish a broken project, and bounded retry/orphan cleanup behavior must be documented. Never overwrite binary content still referenced by a committed revision or conflict copy.
- Enforce authenticated owner-based RLS on all exposed tables and private bucket policies for reads and writes. Derive identity from the authenticated session in database operations; do not trust a submitted owner identifier. Validate owner consistency for membership and object references, not only top-level rows. Use narrowly scoped transactional database functions where required, with explicit authorization and safe execution privileges.
- Save projects and mutable packs with expected-revision checks in a transaction rather than last-write-wins timestamps. If the base revision is stale, preserve the local variant as a clearly named independent conflict copy, retain the newer remote original, and explain the result. Pack conflict copies preserve the competing membership/order without duplicating underlying stickers. Deletes must also detect stale versions; deleted remote records must not be silently resurrected by stale offline clients. Track acknowledged deletions sufficiently for reconnecting clients to reconcile them.
- Make retries idempotent using durable operation identities and stable guest-to-account mappings. If a server commit succeeds but the client loses the response, retry must recognize that commit instead of creating another object or conflict copy.
- Offer explicit guest import after sign-in, with progress, decline, and retry. Import projects and their required assets/masks before dependent pack memberships. Persist mapping/checkpoint state per target account and retain guest originals through failures and successful imports; no destructive guest cleanup is required in this milestone.
- Fetch cloud listings on sign-in and provide a deliberate refresh/retry path. Download and validate required assets/masks before hydrating the editor. Previously cached projects remain available offline; uncached projects need connectivity and must say so. Continuous real-time collaboration and background synchronization while the app is closed are not promised.
- Reuse existing font loading, rendering, PNG, and ZIP export paths. Cloud persistence must not serialize viewport state, transient object URLs, DOM objects, or Konva nodes.
- Reuse shared accessible dialogs, buttons, and account controls. Preserve reachable save/export actions, safe dialog focus, and editor shortcut isolation on desktop, tablet, and mobile.
- Keep favorites in their existing local behavior for this milestone; explicitly document that they do not yet synchronize. Do not add unrelated favorites, export-history, or sharing tables merely because the broader brief describes a later cloud phase.
- Commit reproducible schema/policy migrations and generated database types where consumed. Update setup documentation and the implementation checklist to distinguish provisioned infrastructure, implemented features, and actually verified features.

## Testing Decisions

The user confirmed the following three boundaries: repository integration, browser journeys, and real Supabase authorization. Prefer external outcomes over internal method-call assertions. Reuse repository injection and existing test infrastructure rather than introducing a parallel editor test architecture.

- Extend the existing memory/IndexedDB repository contract tests and editor integration tests. Prior art covers atomic missing-asset failure, mask persistence, injected write failure, stale hydration, navigation flush, and in-flight snapshot saves.
- Test local-first cloud coordination through repository-level behavior: project/asset/mask round-trip, durable pending operations across reload, offline edits, session expiry, failed or partial uploads, lost commit responses, and correct snapshot-specific status.
- Verify repeat-safe guest imports with interrupted project and pack transfers; retries must preserve original local data and avoid duplicate projects, memberships, and conflict copies.
- Use two independent clients with the same base revision to exercise project and pack conflicts. Verify both variants survive, remote writes use atomic compare-and-set, and stale updates/deletes do not overwrite or resurrect newer state.
- Extend Playwright's existing Dashboard → create → upload → edit → save → reload → export journey to cloud saving and a second isolated browser context. Include transformed masks and bundled fonts, then inspect exported PNG dimensions/transparency/composition and ordered ZIP contents rather than only clicking Download.
- Cover real magic-link callback success and recoverable failures using a controlled test inbox or supported local Auth mail capture. Synthetic sessions can support narrower browser tests but cannot substitute for verifying the actual email callback journey. Never send test mail to arbitrary third parties.
- Test sign-out/account switching during in-flight loads, uploads, saves, and imports. Assert no old-account data appears in the new workspace and no old-account operation is replayed with new credentials.
- Run real RLS and Storage tests as user A, user B, and anonymous callers. Attempt list/read/create/update/delete operations, forged ownership, cross-owner membership, and guessed object paths. Privileged setup may prepare fixtures outside the browser, but authorization assertions must use ordinary user or anonymous clients.
- Test existing guest flow with cloud configuration absent and signed-in cached editing with connectivity interrupted. Validate that local save success is not mislabeled as cloud success and retry is reachable.
- Check account/import/conflict dialogs at 1440×900, 1024×768, and 390×844 for keyboard access, focus restoration, usable touch controls, and overflow. Extend existing UI-polish coverage where shared controls change.
- Run the actual typecheck, lint, focused Vitest tests, applicable Playwright tests, and production build. Record exact commands and any unavailable infrastructure; mocked tests and a clean security advisor report alone do not establish cloud authorization or email delivery.

## Out of Scope

- Public or read-only shared packs, shared links, community publishing, and shared-with-me implementation.
- Google/social login, passwords, account profile customization, and a broader account-management suite.
- Cloud favorites and export history; existing local favorites and export generation remain functional.
- Real-time collaboration, automatic merging of concurrent layer edits, and continuous live updates across devices.
- Native WhatsApp/Telegram installation, billing, subscriptions, automatic background removal, AI image generation, animated stickers, and a separate application backend.
- Paid upgrades, paid email-provider purchases, public production deployment, or invitations without separate authorization.
- Guaranteed offline access to cloud assets never downloaded to the device, and synchronization while the application is closed.

## Further Notes

- The scope and testing boundaries were confirmed in conversation. The project has been provisioned and reported healthy; application integration, schema, policies, email configuration, and cloud verification have not yet been completed.
- This is a multi-step implementation spec, suitable for later decomposition into dependency-ordered end-to-end tickets. No subagents are authorized.
- Repository instructions require private storage, explicit migration, local data preservation, and conflict copies. The narrower approved scope intentionally defers the broader brief's sharing and export-history features.
- Release acceptance requires a real second-browser reopen/export, two-user isolation evidence, recoverable failure/conflict behavior, and working guest operation—not merely successful infrastructure provisioning.
- Tracker destination is `ducchinhpro123/Peeloodle`, resolved from the Git remote. Publish this spec with the `ready-for-agent` label when GitHub API access is available.
