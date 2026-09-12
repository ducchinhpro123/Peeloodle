## Review

Target: freshly written P18 (personal image insertion) and P19 (truthful save/autosave) in the presentation editor.
Axis: **are the tests real** — would each fail if the production logic regressed?

**Volatility caveat (important):** the tree was being written while I read it. My first pass found no `usePresentationSave.ts`; by the end of the pass `usePresentationSave.ts` + `usePresentationSave.test.ts` (8 tests) and a new e2e autosave journey existed. Everything below reflects the **final** state I read: `usePresentationSave.ts`/`.test.ts`, `PresentationEditorPage.tsx`, `store.ts`/`store.test.ts`, `insertImageAsset.ts`/`.test.ts`, `presentations.test.tsx`, `e2e/presentations.spec.ts`, `repository.ts`/`idb.ts` + their tests, `validateUpload.ts`. Re-run the greps in "Checks" before acting on M1/M2.

### Correct — tests that are real (would fail on regression)

- `usePresentationSave.test.ts:29-45` extends `MemoryPresentationRepository` and delegates to `super.savePresentation`, so the real revision/media rules run; it records the store's state *at call time*. No fake repository bypass.
- `usePresentationSave.test.ts:82-102` — dirty → saving → saved: pins `{revision: 1, baseRevision: 0, saving: true, dirty: true}` and reads the stored document back (`storedSlideName`). Fails if autosave, `baseRevision`, or `markSaved` regress.
- `usePresentationSave.test.ts:104-132` and `:295-320` — induced write failure (`injectWriteFailure` is the repo's own seam): message in words, `dirty` retained, stored row unchanged (read back), recovery through the Save control persists the edit. Fails if failures were swallowed or the edit dropped.
- `usePresentationSave.test.ts:134-158` — stale `baseRevision` → conflict, and the newer stored revision/name is read back unchanged. Real conflict test.
- `usePresentationSave.test.ts:160-177` — concurrent `saveNow` coalesces to one write; clean document is not re-written.
- `e2e/presentations.spec.ts:370-400` — types into the real overlay, waits for the app's own debounce, reloads and reopens: proves the app (not the harness) persisted the text. Fails if autosave is removed.
- `insertImageAsset.test.ts:19-50` — SHA-256 asserted against `FIXTURE_IMAGE_SHA256`, which `fixture.test.ts:72-73` independently derives with `node:crypto`; the stub only supplies decoded size, it does not bypass `validateUpload`.
- `presentations.test.tsx:464-480` — refused file leaves no element/asset/`pendingMedia`/dirty and keeps the boundary's specific copy (BMP → PNG/JPEG/WebP, SVG → SVG message). Fails if validation is skipped.
- `store.test.ts:359-404, 406-416, 425-447, 449-475` — insert/undo/redo, dedupe by content, asset cap, held-media isolation across documents: all behaviour assertions on real store commands.

### Findings

**MAJOR (P1) — `presentations.test.tsx:453-461` is the only test claiming P18 media is "stored", and the test performs the save itself.**
`await repository.savePresentation(document, mediaForSave())` + `getMedia(...)` are called by the test, not by the app, so it passes unchanged if the editor stops persisting media (`usePresentationSave.test.ts:226-241` undoes the insert, so it is not the positive case either). Smallest fix: in that same test, drive the real path (advance the autosave or click Save after the `fireEvent.change`) and assert `getMedia(assetId).bytes` and the reopened element, with no direct `savePresentation` call.

**MAJOR (P1) — `PresentationEditorPage.tsx:348` + `presentations.test.tsx:26` + `e2e/presentations.spec.ts` (no upload step) leave "an inserted image is drawn and survives reopen" unverified.**
jsdom renders a non-Konva stub and `createImageBitmap` is globally stubbed to 64×64, so the P18 assertions on `width/height/x/y` come from the stub; no e2e test uses `presentation-image-input` (grep: 0 hits), so only the pre-seeded fixture image is ever pixel-sampled (`e2e:119-158`).

**MINOR — `store.test.ts:31-34` asserts `saving`/`dirty` immediately after calling the setters.**
It asserts values it just constructed (it passed while no save path existed) and is now redundant with `usePresentationSave.test.ts:82-102`.

**MINOR — `usePresentationSave.test.ts:211-241` only covers the negative media case.**
With `media = []`, `clearPendingMedia(media.map(...))` (`usePresentationSave.ts:100`) is indistinguishable from the no-arg footgun (`store.ts:205-213`). Regression-catching test to add: insert A, insert B, undo B, save (writes A), redo B, save again → must succeed; the no-arg form fails `missing_asset`.

**MINOR — `usePresentationSave.test.ts:180-209` fabricates the overlay field (`:193-196`) instead of using `TextEditOverlay` (`TextEditOverlay.tsx:129-132`), and `e2e:370-385` presses Escape before waiting.**
Nothing would catch the flush silently no-op'ing if the selector (`usePresentationSave.ts:31,187`) or overlay markup drifts.

**MINOR — `usePresentationSave.ts:139` (no autosave mid-gesture) is not exercised.**
Every hook test either has no open history group or calls `saveNow()` directly, so removing the `lastHistoryGroup !== null` guard fails no test.

**MINOR — `usePresentationSave.ts:167-177` (`beforeunload` unsaved-work guard) has no test.**

**MINOR — conflict copy in the page is untested at page level.**
`PresentationEditorPage.tsx:195` ("Save conflict") has no page test; `usePresentationSave.test.ts:134-158` only asserts hook state. Same for the page's failed-state composition at `:194-200` (the `:295-320` test covers only the failure path).

**MINOR — `store.test.ts:359-386` and `presentations.test.tsx:438-448` restate `fitImageWithinSlide`'s formula** (also unit-tested at `insertImageAsset.test.ts:83-116`); duplicate of the implementation rather than a second acceptance check.

**MINOR — `insertImageAsset.test.ts:72-80` fakes `File.size` and asserts only the code mapping;** the byte-limit arithmetic is covered upstream (`validateUpload.test.ts:68`), and no test accepts a JPEG or static WebP through `preparePresentationImage` (only PNG, `:19-50`), so mimeType propagation to the asset/media record is unpinned.

**MINOR — `presentations.test.tsx:26` stubs `createImageBitmap` for the whole file, including `validateUpload`'s dimension decode** — the 64×64 assertions verify plumbing, not decoding; no test uses the real `decodeImageSize`.

**MINOR — `e2e/presentations.spec.ts:341-349` still saves by hand via `page.evaluate`,** so the journey title "inserts, edits, saves, and reopens" credits the app with a save the harness performs; now redundant with `e2e:370-400`.

**MINOR — the hook suite's oracle is `MemoryPresentationRepository`,** which checks revisions only when `baseRevision` is passed (`repository.ts:82-90`) unlike IDB (`idb.ts:68-74`); the hook's `baseRevision` is pinned only by the recording assertion at `usePresentationSave.test.ts:88`.

**MINOR — `PresentationEditorPage.tsx:233-245` (slide-full / asset-cap insert errors) has no test.**

**MINOR — `store.test.ts:463` and `presentations.test.tsx:317` start the `it()` body on the callback's line;** cosmetic, but it makes review diffs noisy.

### P18 acceptance criteria with NO test that would catch their regression

1. **"stored media insertion" through the app** — no test; only a test-performed save (`presentations.test.tsx:455`). Media reaching a repository from the editor's own save is unproven.
2. **Inserted image decodes and paints, and survives reopen from stored media** — no test (canvas stubbed, no e2e upload).
3. **A refused upload leaves no broken layer in a real browser** — jsdom only (`presentations.test.tsx:464`).
4. **JPEG / static WebP accepted and typed correctly** through `preparePresentationImage` — no test.
5. **UI limit copy for a full slide / asset cap** (`PresentationEditorPage.tsx:233-245`) — no test.

### P19 acceptance criteria with NO test that would catch their regression

1. **Autosave must not write mid-gesture / mid-session** (`usePresentationSave.ts:139`) — no test.
2. **Flush of text still only on screen when the debounce fires** (type → autosave with the session open) — no test; the flush is only exercised against a hand-built field and via `saveNow()`.
3. **Media flushing drops exactly the persisted ids** (`usePresentationSave.ts:100`) — no test.
4. **Unsaved work guarded on tab close** (`beforeunload`) — no test.
5. **"Save conflict" copy in the status region** (`PresentationEditorPage.tsx:195`) — hook state only.
6. **Explicit Save in a browser** — unit-only (`usePresentationSave.test.ts:265-293`); no e2e click. Soft gap.

Covered and *not* on this list: dirty → saving → saved locally (unit + browser), failed write retains editable work and recovers, conflict does not overwrite the newer revision, `baseRevision` is passed, coalescing, media selection for an undone insert.

### Checks a supervisor must run (I have no shell)

```
npm run typecheck
npm run lint
npm test -- src/features/presentations/editor/store.test.ts src/features/presentations/editor/insertImageAsset.test.ts \
  src/features/presentations/editor/usePresentationSave.test.ts src/features/presentations/presentations.test.tsx \
  src/lib/persistence/presentations/repository.test.ts src/lib/persistence/presentations/idb.test.ts
npm run test:browser -- e2e/presentations.spec.ts --workers=1
npm run build
```

Re-verify M1/M2 are still open with: grep `insertImage` in `usePresentationSave.test.ts`/`e2e/`, and grep `getMedia` in `usePresentationSave.test.ts` (currently 0 hits).

### Merge verdict: **OK with notes**

No test lies about app behaviour any more: the P19 hook suite and the new e2e autosave journey genuinely exercise the app's own save path and read stored documents back. But M1/M2 mean P18's row evidence ("stored media insertion") is still only proven by a test that saves by hand and a canvas that never runs — do not tick P18 in `docs/slides-implementation-plan.md` until at least M1 (and ideally an e2e image step) lands.