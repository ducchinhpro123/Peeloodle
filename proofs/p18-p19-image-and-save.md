# P18 + P19 — personal image insertion and truthful save/autosave

**Date:** 2026-09-12
**Plan rows:** P18 (personal PNG/JPEG/static-WebP image upload and stored media insertion),
P19 (autosave and explicit Save with truthful state and edit/media flushing).
**Scope:** `src/features/presentations/**` and one appended test in `e2e/presentations.spec.ts`,
plus a new browser spec. No schema change, no new dependency, no persistence-contract change.

## What was built

| File | Change |
| --- | --- |
| `src/features/presentations/editor/insertImageAsset.ts` | New. `preparePresentationImage(file)` → `{ asset, media }`; reuses `validateUpload` as the trust boundary and `sha256Hex` for a content-addressed `blobKey`. |
| `src/features/presentations/editor/store.ts` | `insertImage`, `pendingMedia`, `clearPendingMedia`, `mediaForSave`; `commit` now reports whether it applied. |
| `src/features/presentations/editor/usePresentationSave.ts` | New. Save + 750 ms autosave, flush-before-save, coalescing, distinct conflict state. |
| `src/features/presentations/editor/PresentationEditorPage.tsx` | "Add image" affordance with per-code failure copy, Save control, real status state, decode-orientation fix, exit guard. |
| `src/lib/persistence/presentations/repository.ts` | Memory adapter gained the IndexedDB adapter's two revision guards (see "Integration fixes"). |
| `e2e/presentations.spec.ts` | Appended one test (append-only): typed edit → autosave → reload → reopen. |
| `e2e/presentations-image.spec.ts` | New browser spec: real upload, canvas pixel evidence, IndexedDB media evidence, refusal path. |

## Checks run

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean (`tsc -b`) |
| `npm run lint` | 0 errors, 4 pre-existing `react-refresh` warnings (unrelated files) |
| `npm test` | **394 passed / 33 files** |
| `npm run build` | `✓ built in 6.02s` |
| `npx playwright test e2e/presentations-image.spec.ts` | **2 passed** — the stored-media assertion hashes the bytes and compares them to the document asset's `sha256`, so it proves identity with the uploaded file rather than type and length |
| `npx playwright test e2e/presentations.spec.ts -g "autosaves a typed edit"` | **1 passed** |

## Browser evidence (the part unit tests could not prove)

`e2e/presentations-image.spec.ts` uploads a real repo PNG through the real hidden file input and asserts:

1. the asset is `image/png` at **173×180** with a 64-character SHA-256, and the element is placed
   inside the 1280×720 page at natural size (the policy never upscales);
2. **the canvas actually paints it** — opaque pixels differing from the canvas's dominant colour
   increase by more than 500 after insertion, and `.presentation-canvas-error` never appears;
3. the edit autosaves: the status reaches "Saved locally" with no Save click;
4. **the bytes really landed in IndexedDB** — `getMedia(assetId)` returns the stored PNG bytes and
   `hasMedia` is true;
5. after a reload and reopen, the asset and element are identical and **it paints again**, which
   proves the stored media is rehydrated rather than remembered in memory.

The second test uploads an SVG and asserts a visible `role="alert"`, zero assets, zero elements and
a still-clean document — the "failed upload leaves no broken layer" criterion, in a real browser.

Why this mattered: the reviewer of the first pass found that jsdom stubs the canvas
(`MODE === 'test'`), so `renderSlide` never ran in unit tests and **nothing** proved an inserted image
was drawn. That gap is now closed by pixels, not by assertion.

## Integration fixes (found by review, fixed by the lead)

1. **Decode orientation.** `decodeImageSource` called bare `createImageBitmap(blob)` while every other
   decode site passes `{ imageOrientation: 'from-image' }`; a rotated phone JPEG would have drawn with
   swapped axes against the width/height that `fitImageWithinSlide` used. Now mirrored, with the bare
   call kept as the fallback.
2. **`insertImage` return contract.** `commit` swallowed its no-op case and `insertImage` returned an
   element id unconditionally, so a refused insert could report success and the caller's `null` check
   could never fire. `commit` now returns whether it applied, and `insertImage` returns `null` when it
   did not.
3. **Adapter divergence.** `MemoryPresentationRepository` only enforced a revision conflict when
   `baseRevision` was supplied, while the IndexedDB adapter also refuses to write an older revision
   over a newer stored one (and refuses to silently recreate a deleted row). A stale-write regression
   could therefore pass the unit suite and fail only in the browser. The memory adapter now carries
   both guards; the full suite stayed green, so no existing test relied on the lax behaviour.

## Also verified by an independent reviewer

An invariants review re-derived the P18 half against the working tree and confirmed: no
non-serializable value can reach IndexedDB (every write goes through `serializePresentationDocument`,
whose parser rebuilds known fields only); media is out of the document and a save cannot half-commit
in either adapter; `validateUpload` is genuinely reused rather than reimplemented, with its refusals
pinned by tests; exactly one history entry per insertion; view state never dirties the document; no
object-URL leaks in the new decode path. Its BLOCK verdict rested on two facts that were true when it
read the tree and are now false: P19 did not exist, and no user path persisted media.

A separate test-honesty review ("OK with notes") confirmed the P19 hook suite and the appended
e2e journey genuinely exercise the app's own save path and read stored documents back. It raised two
MAJOR findings against the then-current tree, both of which `e2e/presentations-image.spec.ts` closes:

| Finding | Closed by |
| --- | --- |
| "Stored media insertion" was only proven by a test that called `savePresentation` itself | The browser spec uploads through the real file input, lets the app's own autosave persist, then reads `getMedia`/`hasMedia` back. If the editor stopped sending media the save would fail and "Saved locally" would never appear. |
| An inserted image being drawn and surviving reopen was unverified (jsdom stubs the canvas) | The browser spec asserts painted pixels, then reloads, reopens and asserts painting again from stored media. |

It also listed P18 refusal-in-a-real-browser, which the spec's second test covers (SVG → visible
alert, zero assets, zero elements, still-clean document).

## Test hardening (13 tests, each verified by mutation)

A test-honesty review found the places where the suite would stay green under a real regression.
Each new test below was confirmed by applying the corresponding break to production code, watching
the test fail, and restoring the code:

| Test guards | The break that makes it fail |
| --- | --- |
| The save submits a just-inserted image's bytes | `mediaForSave()` replaced with `[]` (previously all of `npm test` stayed green, since the only other in-CI media assertion covered the *undone* case) |
| Media clearing drops only ids the write persisted | the no-arg `clearPendingMedia()`, or recomputing `mediaForSave()` after the write |
| On-screen text is included in the write | deleting the flush call |
| Autosave stays silent while a history group is open | removing the group guard |
| The exit guard prompts only when dirty | removing the dirty check |
| The visible `Saving…` state | removing the `saving` publish |
| A stale write reads as a conflict, not a generic failure | downgrading the conflict branch to `failed` |
| JPEG and static-WebP mime types propagate | hardcoding `image/png` in the asset |
| Slide-full and asset-cap refusals are explained | removing either guard |
| Older revision over newer stored work with no `baseRevision` is refused | removing the `storedRevision > clean.revision` guard (a guard this increment added, previously unpinned) |
| A row deleted after the caller read it is not silently recreated | removing the `baseRevision >= 0` branch |

## Known gaps and deliberate ceilings

- **One narrow coupling remains untested:** the text-flush test supplies a field carrying the same
  `data-testid` the hook looks for, so renaming that attribute in `TextEditOverlay.tsx` would turn the
  flush into a silent no-op without failing a test. No jsdom or browser test yet drives
  flush-before-save through the real overlay. Closing it needs one test that opens a real text session
  and clicks Save.
- **Two findings from review were judged immaterial and left as-is:** `store.test.ts`'s
  `not.toContain('bytes')` is a weak leak detector (`JSON.stringify` of a `Uint8Array` produces numeric
  keys, not a `bytes` key — the parser is the real gate and is covered elsewhere), and the
  `insertImage` no-op return is unreachable today because the target slide is resolved from the same
  snapshot, so it cannot be pinned without contriving state.
- **Browser evidence is not enforced by CI.** `.github/workflows/ci.yml` runs typecheck, lint,
  `npm test` and build, and never runs Playwright. The pixel and IndexedDB-media evidence in
  `e2e/presentations-image.spec.ts` is therefore a manual gate; the fast-suite pin for the media write
  path is the mutation-verified hook test above.
- **The P15–P17 browser capture suite was not re-run.** Those specs regenerate committed captures in
  `proofs/out/`, which another writer had concurrently regenerated; re-running would have churned
  proof artifacts belonging to unrelated work. P15–P17 rendering is covered here by unit tests only.
- **Unrequested work is present in this tree** (a presentation-library hero redesign, generated
  artwork, modified `docs/assets-provenance.md`, regenerated `proofs/out/p15-library-*.png`, and about
  130 lines of `.presentation-card*`/`.presentation-art-*` CSS). It is **not** part of this change set,
  was not authored by this increment, and was deliberately left untouched pending an owner decision.
- Held media and decoded bitmaps are retained until the document closes; plan P25 owns bounded
  retention. Asset records are not garbage-collected.
- P19 ceilings: no `pagehide`/unmount flush (a pending debounce is dropped on route change; close and
  reload are covered by the exit prompt), autosave does not fire while a text session's history group
  is open (blur, Escape or Save flushes it), and a conflict leaves the work editable but unsavable
  until a reload/merge decision — no resolution path is built yet.
- One orphan decoded bitmap can survive a refused insert (bounded to one per event, no correctness
  impact).

## Next

P20 (library thumbnails, rename, duplicate, safe delete) then P21 (the milestone's create → edit →
save → reload → reopen browser journey), which is what closes Milestone 1.
