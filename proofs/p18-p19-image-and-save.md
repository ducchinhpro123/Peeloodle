# P18 + P19 — personal image insertion and truthful save/autosave

**Date:** 2026-09-12
**Plan rows:** P18 (personal PNG/JPEG/static-WebP image upload and stored media insertion),
P19 (autosave and explicit Save with truthful state and edit/media flushing).
**Scope:** `src/features/presentations/**`, `src/lib/persistence/presentations/**`, the shared shell's
in-app links (`src/main.tsx`), and the presentation browser specs. No schema change, no new dependency,
no persistence-contract change.

This document covers the original increment **and** the review-driven hardening round that followed it.
The hardening round is the part that changed guarantees, so it is not folded away.

## What was built

| File                                                           | Change                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/presentations/editor/insertImageAsset.ts`        | `preparePresentationImage(file)` → `{ asset, media }`; reuses `validateUpload` as the trust boundary and `sha256Hex` for a content-addressed `blobKey`.                                                                                                          |
| `src/features/presentations/model/limits.ts`                   | One `PRESENTATION_LIMITS` home for the caps, including the **200 MB per-presentation media budget**.                                                                                                                                                             |
| `src/features/presentations/editor/store.ts`                   | Insert planning and refusal (`imageInsertRefusal`, `planImageInsert`, `checkImageInsert`), `pendingMedia`/`mediaForSave`/`clearPendingMedia`, and persist-then-adopt (`adoptPersistedInsert`). The media budget is summed from the document's own asset records. |
| `src/features/presentations/editor/usePresentationSave.ts`     | 750 ms autosave + explicit Save, flush-before-save, coalescing, distinct conflict state, **atomic `persistInsert`**, **`keepMineAsCopy`** conflict recovery, **`saveBeforeLeave`**.                                                                              |
| `src/features/presentations/editor/textEditSession.ts`         | `registerActiveTextEditFlush`/`flushActiveTextEdit`: an explicit flush API, replacing a `data-testid` DOM query.                                                                                                                                                 |
| `src/features/presentations/editor/leaveGuard.ts`              | One in-app navigation guard registry (`registerLeaveGuard`/`hasLeaveGuard`/`invokeLeaveGuards`).                                                                                                                                                                 |
| `src/features/presentations/editor/PresentationEditorPage.tsx` | Add-image affordance, real save status, conflict-recovery action, decode-on-replace, guarded exit; the decode-failure and recovery-failure copy now describes what actually happened.                                                                            |
| `src/features/presentations/editor/TextEditOverlay.tsx`        | Registers its own flush while a session is open, so the flush is not coupled to markup.                                                                                                                                                                          |
| `src/main.tsx`                                                 | `GuardedLink`: the brand logo, all five topnav links, the sidebar, the mobile sheet and the studio note consult the guard. Identical to `Link` when no editor is open.                                                                                           |
| `src/lib/persistence/presentations/revision.ts`                | `assertRevisionWritable`: the revision rules both adapters share, so they cannot diverge again.                                                                                                                                                                  |
| `e2e/presentations-image.spec.ts`                              | Upload → painted pixels → bytes hashed in IndexedDB → reload/reopen repaint; SVG refusal.                                                                                                                                                                        |
| `e2e/presentations-save-guard.spec.ts`                         | Leaving mid-edit persists the on-screen text; a clean exit is not blocked.                                                                                                                                                                                       |
| `e2e/presentations-shell-guard.spec.ts`                        | A shell nav link persists the pending edit before leaving; a clean editor navigates immediately.                                                                                                                                                                 |

## The four guarantees this round added

1. **Insertion is atomic.** `prepare → check → plan → persist (document + bytes in one repository
transaction) → adopt → decode`. Nothing is shown, nothing is mutated and nothing is held until the
   write succeeds; the bytes are decoded _after_ the commit, so a refusal cannot leave an orphan bitmap.
   On failure, document, assets, `pendingMedia`, history and the stored row are all untouched.
2. **The 200 MB media budget is enforced before mutation and only once per asset.** The budget is
   charged by unique asset, so re-inserting artwork the presentation already holds is not charged twice,
   and a refusal names the limit, what is already stored, this file's size and two remedies.
3. **A revision conflict has a recovery path.** "Keep my copy" writes the local work as an independent
   copy (new ids, no `baseRevision`, so it can only create a row), re-keys held media, then reloads the
   newer stored revision and re-decodes its artwork. Save is no longer a dead end.
4. **Leaving the editor saves first.** The header Back link and every guarded shell link flush the
   on-screen text and `await` the write; a failed write keeps the editor open with a visible note.
   _(Scope, stated plainly: the browser Back/Forward buttons and programmatic `navigate()` calls are
   **not** guarded — see Known gaps.)_

## Checks run (final state)

| Command                                                                                                                          | Result                                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                              | clean (`tsc -b`)                                                    |
| `npm run lint`                                                                                                                   | 0 errors, 4 pre-existing `react-refresh` warnings (unrelated files) |
| `npm test`                                                                                                                       | **431 passed / 34 files**                                           |
| `npm run build`                                                                                                                  | `✓ built in 2.63s`                                                  |
| `npx playwright test e2e/presentations-image.spec.ts e2e/presentations-save-guard.spec.ts e2e/presentations-shell-guard.spec.ts` | **6 passed**                                                        |

## Browser evidence (the part unit tests could not prove)

- **Insertion** (`e2e/presentations-image.spec.ts`): a real repo PNG through the real hidden input →
  asset is `image/png` at **173×180** with a 64-character SHA-256, placed inside the 1280×720 page at
  natural size; the canvas **actually paints it** (opaque pixels differing from the canvas dominant
  colour rise by >500, and `.presentation-canvas-error` never appears); the editor is **not dirty**
  afterwards, because the insert was persisted as part of the insert; `getMedia`/`hasMedia` prove the
  bytes are in IndexedDB; after reload and reopen it **paints again** from stored media. A second test
  uploads an SVG and asserts a visible `role="alert"`, zero assets, zero elements, clean document.
- **Leaving mid-edit** (`e2e/presentations-save-guard.spec.ts`): a text session is left open, text is
  typed, and Back is clicked with no debounce wait. The test reads the **stored row** back and asserts
  the text is there, then reopens from the library and asserts it is still there. A clean editor
  navigates without being blocked.
- **Leaving via the shell** (`e2e/presentations-shell-guard.spec.ts`): the same journey through the
  shell's "Home" link, with the stored row read back, plus an assertion that a clean editor follows the
  link immediately and never shows a save-failure note.

### Mutation checks (a test that cannot fail is not evidence)

| Test                                             | Break applied                                           | Observed                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Back-link journey (browser)                      | `preventDefault` bypassed in the exit path              | **fails** — the typed text is lost; the clean-exit test still passes. File restored, sha256 identical, then passed again.                                            |
| Concurrent-command survival (unit)               | stale-command branch in `adoptPersistedInsert` disabled | **fails** — `expected [1 slide] to have a length of 2 but got 1`, i.e. the mid-write command was dropped exactly as reviewed. Restored, sha256 identical, 27 passed. |
| Shell-link journey (browser) and two guard units | `GuardedLink` ignores the guard                         | **fails** — stored text is `""` because the editor unmounted and dropped the document; unit variants also fail. Restore hash recorded by the implementing pass.      |

## Review findings and what happened to them

Two fresh reviewers ran against this change set: one on correctness/honesty, one on whether the new
tests actually bite. Both verdicts and every finding are accounted for:

| Finding                                                                                                                                                            | Severity       | Outcome                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`adoptPersistedInsert` replaced the whole live document, so a command landing during the insert's write was silently dropped while the UI said "Saved locally"** | **BLOCK / P1** | **Fixed.** The store now detects that the live document is no longer the plan's predecessor (`current.revision !== plan.document.revision - 1`), advances the stored revision as the new base, forces `dirty`, and **replays the insert onto the live document** instead of overwriting it. Pinned by the mutation-checked unit test above. |
| **Only the header Back link was guarded; every other in-app exit unmounted the editor and dropped unsaved work**                                                   | **P1**         | **Fixed.** `leaveGuard.ts` + `GuardedLink` cover the brand logo, topnav, sidebar, mobile sheet and studio note, with one shared leave implementation. Browser- and unit-tested with mutation checks.                                                                                                                                        |
| The media budget's "charged once per identical asset" rule had **no test at the boundary**; deleting the known-asset exemption kept the suite green                | MAJOR (test)   | **Fixed.** New test: budget exactly full of a held asset → re-inserting it is accepted, a new asset is refused.                                                                                                                                                                                                                             |
| `baseRevision` was captured at click time, so a save completing before the queued insert write produced a **false "Save conflict"**                                | MINOR          | **Fixed.** `persistDocument` now reads `savedRevision` inside the serialized task (strictly fewer false conflicts; the older-over-newer rule still protects newer stored work).                                                                                                                                                             |
| The explicit Save path returned "saved" without flushing when the document merely _looked_ clean                                                                   | MINOR          | **Fixed.** Flush moved before the clean check, matching `saveBeforeLeave`.                                                                                                                                                                                                                                                                  |
| A decode failure after a successful persist said "This image could not be added" although it was already saved                                                     | MINOR          | **Fixed.** Now says it was saved but cannot be displayed here yet, and handles the gone-canvas case instead of returning silently.                                                                                                                                                                                                          |
| A failed `reloadStoredArtwork()` after a successful recovery said the newer version "could not be reopened" although it was loaded                                 | MINOR          | **Fixed** (message only — no new test; the seam needs a `getMedia` that fails only after the copy write).                                                                                                                                                                                                                                   |
| The memory adapter mapped an unreadable stored row to "newer" with no test, while IndexedDB throws `invalid_document`                                              | MINOR          | **Fixed.** New parity test: an unreadable row must refuse an older write as a conflict.                                                                                                                                                                                                                                                     |
| Two of this document's own browser-spec comments misdescribed the mechanism ("text not yet in any committed command", "the write happened before navigation")      | MINOR          | **Fixed.** Both comments corrected; the await-before-navigate property is pinned by the jsdom guard tests, which keep the editor open when the write fails.                                                                                                                                                                                 |

The correctness reviewer's earlier BLOCK rested on P19 not existing and no user path persisting media;
both were already closed before this round and are covered by the browser evidence above.

## Manual interactive verification (real browser, driven by hand)

Beyond the scripted specs, the four guarantees were driven manually in Chromium against the dev
server. For the two guard runs the **page clock was frozen**, so the 750 ms autosave timer could not
fire: the exit guard is then the only code that can write, which makes the check deterministic rather
than a race with the debounce.

| Flow                            | What was done                                                                    | What was observed                                                                                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exit guard, inside the debounce | timers frozen, text typed into an open session, Back clicked                     | landed on `/presentations`, and the **stored row held the exact text** although the debounce could not have written it                                                                                                                                   |
| Shell nav guard                 | same technique, leaving via the shell's "Home" link                              | landed on `/`, exactly one row held the text, no save-failure note                                                                                                                                                                                       |
| Image insertion                 | a real PNG uploaded through the file input                                       | asset `sha256` equals the file's independently computed SHA-256; stored bytes (33166) equal the file's; one image element; `dirty: false` with `savedRevision === documentRevision`; status "Saved locally"; the canvas visibly paints it                |
| Conflict recovery               | two tabs on one document; tab B saved a newer revision; tab A saved its own edit | the conflict message named the other tab and stated the work was not written over it; "Keep my copy" created an **independent row** (revision 0) holding tab A's work while the newer row kept tab B's, and the editor reopened the newer revision clean |
| Guard refusal                   | two tabs again, then Back clicked in the stale tab                               | **stayed in the editor**, showed the actionable note, kept both texts with `dirty: true`, and left the newer stored row untouched                                                                                                                        |

Console output across the entire session: **zero errors, zero warnings**.

Observation, recorded rather than fixed: revisions advance per keystroke (48 keystrokes → revision 48)
because `TextEditOverlay` commits each input inside one history group. Undo remains one entry per
session and writes stay debounced, so this is not a defect — but revision numbers grow faster than
"user actions", which is worth knowing when reading stored revisions.

## Simplification pass (over-engineering review, applied)

A follow-up over-engineering review of this change set found six things to cut. All were applied; no
behaviour changed except the one noted:

| Cut                                                                         | What replaced it                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `mediaBytes` side map, `setMediaBytes` and the load-time hydration step | `byteLength` on the asset record: the budget is summed from the document, so it survives reload, duplication and backup restore. **This also closed the gap that a restored document's artwork was not counted**, and removed the failure mode where a missed hydration silently under-reported the budget. One obsolete test went with it. |
| `adoptPersistedInsert(plan, mediaAssetId, image)`                           | `adoptPersistedInsert(plan, image)` - the id was always `image.media.assetId`.                                                                                                                                                                                                                                                              |
| `clearPendingMedia(assetIds?)` optional argument                            | Required argument: production only ever passed ids, and the no-argument form existed for one test.                                                                                                                                                                                                                                          |
| `persistDocument` on the hook's public return                               | Dropped from the interface; it has one caller and no consumer outside the hook.                                                                                                                                                                                                                                                             |
| `LEAVE_ATTEMPTS = 3` tunable                                                | Two inline passes: the second writes an edit that landed during the first.                                                                                                                                                                                                                                                                  |
| Three copies of the browser-spec helpers                                    | `e2e/presentations.ts` (`settleDevServer`, `readDocument`, `readStoredDocument`, `openBlankEditor`); two of the copies were byte-identical.                                                                                                                                                                                                 |

Recorded as deliberate non-findings: `insertRefusalMessage` (suppresses the two reasons the hook
already publishes, passing the store's message through - not duplicated copy), and the cross-feature
decode pair `decodeImageSource` / `backup.ts` (they share two lines of orientation options but differ
in ownership: a live source with `dispose` versus an immediate close and domain error).

**Trap found while verifying:** the browser specs import app modules inside `page.evaluate`, so they
must run against a **fresh dev server**. A dev server that has been running through edits serves those
modules with Vite HMR version queries (`store.ts?t=...`), and the bare import then resolves to a
second module instance with an empty store - five specs failed with `Cannot read properties of null`
until the server was restarted. Stop any dev server before running these specs.

## Known gaps and deliberate ceilings

- **Unguarded exits, stated plainly.** The browser Back/Forward buttons and programmatic `navigate()`
  calls (search results, in-editor save flows) cannot be intercepted: the app renders `<BrowserRouter>`
  - `<Routes>`, not a data router, so react-router's `useBlocker` throws. `beforeunload` covers close
    and reload only. Closing this properly means migrating to a data router — deliberately not done here.
- **The media budget is enforced at insertion.** It is summed from the document, so a restored,
  duplicated or backup-recovered presentation counts its artwork correctly; a document that is already
  over budget is still not refused at open time. A document written before the `byteLength` field
  existed counts its artwork as unknown (0 bytes) until it is re-saved.
- **Untested branches, each named:** the object-URL fallback of `decodeImageSource` (every test
  provides `createImageBitmap`, so only the bitmap branch of dispose-on-replace runs); the
  conflict-recovery test asserts the _new_ bitmap is live but not that the pre-recovery one was
  released; the media-limit message assertion is satisfied by the limit alone, so its "is already
  stored" clause is verified by reading, not by a test; the document-wide 2000-element cap is untested
  (~12.6 s to construct), though the per-slide cap is.
- **`keepMineAsCopy` when the row was deleted** (rather than merely stale): the copy is written but the
  call reports failure and never mentions it. Unreachable today — no delete path exists until P20.
- **A decode failure leaves that artwork undrawn until reload.** The message is now honest; there is no
  in-editor retry.
- **Dispose-on-replace is immediate**, while the mounted Konva layer may still hold the closed source
  until the next render effect. A wheel/pan repaint inside that window could draw a closed bitmap;
  narrow, deliberate, and recorded rather than fixed.
- Held media and decoded bitmaps are retained until the document closes; plan P25 owns bounded
  retention. Asset records are not garbage-collected.
- Autosave does not fire while a text session's history group is open (blur, Escape, Save or leaving
  flushes it).
- **Browser evidence is not enforced by CI.** `.github/workflows/ci.yml` runs typecheck, lint,
  `npm test` and build, and never runs Playwright, so the pixel, IndexedDB and guard evidence above is
  a manual gate.
- **`e2e/foundation.spec.ts` has one pre-existing failure**, `Dashboard composition at 1440x900`
  (horizontal overflow), reproduced with pristine `src/main.tsx` swapped in. It is unrelated to this
  work: `GuardedLink` renders a `Link` with the same props, so the published DOM is unchanged.
- **The P15–P17 browser capture suite was not re-run**, because those specs regenerate committed
  captures in `proofs/out/`.

## Note on the generated artwork in this tree

Earlier notes from this session described the presentation-library hero redesign, generated artwork and
regenerated `proofs/out/p15-library-*.png` as unowned work of unknown origin, and recommended
quarantining them. That was wrong and is retracted: they are the owner's own commit `c136845`
("Redesign presentation library and add template stickers"), which the owner has stated is ready and
needs no corrections. Nothing in it was reverted or modified by this increment.

## Next

P20 (library thumbnails, rename, duplicate, safe delete) then P21 (the milestone's create → edit →
save → reload → reopen browser journey), which is what closes Milestone 1.
