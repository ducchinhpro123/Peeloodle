## Review

Target: plan rows P18 (personal image insertion) and P19 (truthful save/autosave) in the presentation editor. Axis: invariants and honesty. No files edited; no shell available, so every check I recommend is listed at the end.

**Headline:** P18's document half is well built and genuinely reuses the upload trust boundary. P19 does not exist in any form — `usePresentationSave.ts` is absent (the editor directory holds only `insertImageAsset.ts`, `PresentationCanvas.tsx`, `PresentationCanvasControls.tsx`, `PresentationEditorPage.tsx`, `TextEditOverlay.tsx`, `store.ts`, `textBridge.ts`, `textEditSession.ts`, `viewGeometry.ts` + tests), no autosave, no explicit Save control, no flush of `pendingMedia`, and no unsaved-work guard. Because of that, P18's inserted media is never stored anywhere, and there is no user path that persists a presentation edit.

---

### Correct (verified)

- **No non-serializable value can reach IndexedDB.** Every document write goes through `serializePresentationDocument` (`store.ts:127`), which is `JSON.stringify` → `parsePresentationDocument` (`parse.ts:114-125`); the parser rebuilds assets and elements from known fields only (`parse.ts:186-215`, `parse.ts:261-290`) and rejects non-JSON-serializable input (`parse.ts:145-152`). Inserted assets carry only `id/blobKey/mimeType/width/height/sha256/provenance` (`insertImageAsset.ts:72-80`). The store test's "no `bytes` in JSON" assertion (`store.test.ts:369`) is weak on its own (a `Uint8Array` stringifies as `{"0":137,…}`), but the parser is the real gate.
- **Media is not in the document, and a save cannot half-commit.** Bytes live in `pendingMedia` (`store.ts:41-42`) and are submitted separately as `PresentationMediaRecord[]` (`repository.ts:17-21`). Both adapters write media + document in one transaction and refuse a document whose assets have neither submitted nor stored media (`repository.ts:100-131`, `idb.ts:88-131`); stored media is immutable against different bytes (`repository.ts:110-117`, `idb.ts:99-106`).
- **`validateUpload` is genuinely reused, not reimplemented.** `insertImageAsset.ts:89` calls it and only maps its codes (`insertImageAsset.ts:95-113`). SVG, GIF, animated PNG/WebP, byte limit, pixel limit and declared-vs-sniffed MIME agreement all still live in `validateUpload.ts:52-84`, and `resolveMimeType` (`validateUpload.ts:141-147`) is the only MIME authority. Hashing reuses the existing `sha256Hex` (`insertImageAsset.ts:69`, `backup.ts:81-86`). Refusals are pinned by tests (`insertImageAsset.test.ts:52-80`, `presentations.test.tsx:466-477`).
- **One history entry per insertion; view state never dirties.** `insertImage` performs exactly one `commit` (`store.ts:388`) and the following `set`s touch only `view`/`pendingMedia` (`store.ts:399-402`); `dirty` is derived from revisions alone (`store.ts:141-144`). Pinned by `store.test.ts:373-380` and `presentations.test.tsx:489-492`.
- **The new insert/load path leaks no object URLs and no module-level cache.** The only new URL creation is the `createImageBitmap` fallback in `decodeImageSource` (`PresentationEditorPage.tsx:36-49`), each revoked by a tracked disposer; `media.add` also registers a disposer (`PresentationEditorPage.tsx:77-88`) and the effect cleanup disposes (`PresentationEditorPage.tsx:141`, `:155`). `pendingMedia` is cleared on load/close (`store.ts:174-189`, tested `store.test.ts:456-465`), and the remaining module-level state in this path is font tables (`fonts.ts:31-34`).
- **Failure paths are honest at the module level.** A refused file yields `PrepareImageError` carrying the upload boundary's own message (`insertImageAsset.ts:88-113`), shown in `role="alert"` with document/assets/pendingMedia untouched (`PresentationEditorPage.tsx:284`, `presentations.test.tsx:466-477`). Missing artwork is distinguished from a missing presentation (`PresentationEditorPage.tsx:120-133`, tested `presentations.test.tsx:180-187`). Missing `crypto.subtle` surfaces as "could not be read on this device" (`insertImageAsset.ts:66-72`).
- **The status label does not lie.** `saveStatus` can only read "Saved locally" when `dirty === false` (`PresentationEditorPage.tsx:188`), and `dirty` only clears in `markSaved` (`store.ts:196-199`). With no save path, the editor honestly sits on "Unsaved changes" instead of claiming a save.

---

### Findings

**FATAL — P19 is not implemented at all.**
`src/features/presentations/editor/usePresentationSave.ts` does not exist; there is no autosave, no Save control, no keyboard save, and no flush. `markSaving`/`markSaved`/`markSaveFailed`/`clearPendingMedia`/`mediaForSave` (`store.ts:46-53`) have **no production caller** — only `store.test.ts:31-40`, `store.test.ts:390-459` and `presentations.test.tsx:450-491`. The only production `savePresentation` calls are blank creation (`PresentationsPage.tsx:67`) and the repository's own duplicate. Consequence: `PresentationEditorPage.tsx:188` renders "Saving…" and "Save failed" from state that can never be set, and P19's acceptance (Dirty → saving → saved locally; induced quota/write failure retains editable work) is unimplemented. A working reference exists in the repo and was not ported: `features/editor/useDraftAutosave.ts` + `features/editor/draftSaving.ts:33-80` (serialized write queue, origin matching to reject stale writes, `markSaved(document.revision)`, beforeunload warning).

**FATAL — P18 media is never stored, and unsaved work is lost silently.**
`store.ts:363-403` puts bytes into `pendingMedia`; `mediaForSave()` (`store.ts:215-223`) has no production caller and nothing calls `repository.savePresentation` from the editor. Reload discards the inserted image and its asset record. There is also no unsaved-work guard: nothing in the presentations feature listens for `beforeunload` (only `features/editor/useDraftAutosave.ts:15` does, for sticker projects), and "Back to presentations" is a plain `Link` (`PresentationEditorPage.tsx:253`). The e2e test saves by hand via `page.evaluate` (`e2e/presentations.spec.ts:341-348`) — honest in the test, but not a user path. P18's row title is "…and stored media insertion"; the document half works, the storing half does not.

**MAJOR — Nothing verifies that an inserted image ever paints; the P18 tests run against a canvas stub.**
`PresentationEditorPage.tsx:335` short-circuits to a non-Konva `data-testid` panel when `import.meta.env.MODE === 'test'`, so `renderSlide` is never executed in jsdom, and the only image-insertion tests live in that mode (`presentations.test.tsx` image-insertion describe) with `createImageBitmap` stubbed to 64×64 (`presentations.test.tsx:26`). `e2e/presentations.spec.ts` has no image step at all (grep for `Add image` / `presentation-image-input`: 0 hits). The real missing-artwork failure is a thrown `Error` (`renderSlide.ts:110`) swallowed into a generic banner (`PresentationCanvas.tsx:97-101`). The page's claim that "an accepted one can never be drawn without its image" (`PresentationEditorPage.tsx:206-211`) is therefore an assertion, not verified behavior.

**MINOR — Decode options diverge from every other decode site (EXIF orientation).**
`PresentationEditorPage.tsx:37` uses bare `createImageBitmap(blob)`, while `validateUpload.ts:90`, `backup.ts:166` and `exports/renderDocument.ts:542` all pass `{ imageOrientation: 'from-image' }`. Asset `width`/`height` — and hence the element box from `fitImageWithinSlide` — come from the orientation-applied decode, so a rotated phone JPEG draws with swapped axes/crop wherever the browser default is `'none'`. Smallest fix: pass the same option in `decodeImageSource`, keeping the fallback. Uncatchable with the 64×64 stub.

**MINOR — `insertImage` can report success for a commit that changed nothing.**
`commit()` returns `void` (`store.ts:119-146`) and `insertImage` returns `element.id` unconditionally at `store.ts:403` even when the updater returned `false` at `store.ts:390`; the caller's `if (!id)` guard (`PresentationEditorPage.tsx:237`) then never fires, and the `pendingMedia`/selection updates at `store.ts:399-402` still run. Unreachable today only because `target` is resolved from the same snapshot — the contract the page relies on ("null means nothing was inserted") is unsound.

**MINOR — `clearPendingMedia()` with no ids is a live footgun for the missing save path.**
`store.ts:205-213` drops every held record, while `mediaForSave()` deliberately filters to document-referenced records (`store.ts:215-223`). A P19 save that persists `mediaForSave()` and then calls the no-arg form destroys bytes that redo still needs, after which the document can never be saved (`missing_asset`: `repository.ts:119`, `idb.ts:115`). Correct pairing is `clearPendingMedia(mediaForSave().map(r => r.assetId))`; only tests use the overload today (`store.test.ts:456-459`).

**MINOR — A successful-entry, failed-insert path retains an orphan decoded bitmap.**
`PresentationEditorPage.tsx:242` adds to `media.images` _before_ `store.insertImage`; if `insertImage` returns null, or the user navigates away mid-insert (cleanup nulls `mediaRef` at `PresentationEditorPage.tsx:154`), the later `media.add` push (`PresentationEditorPage.tsx:77-88`) registers a disposer on an already-disposed `DecodedMedia`, so that `close()` never runs. Bounded to one bitmap per event, no correctness impact.

**MINOR — Memory and IndexedDB adapters disagree on revision safety.**
`MemoryPresentationRepository.savePresentation` checks revisions only when `options.baseRevision` is supplied (`repository.ts:82-90`), so it will silently overwrite a newer stored revision with an older one; the IDB adapter rejects that unconditionally (`idb.ts:68-82`). P18/P19 unit tests use the memory adapter (`presentations.test.tsx:23`), so a stale-write regression in a future P19 save path could pass the unit suite and only fail in the browser. `baseRevision` is optional in the contract (`repository.ts:22-25`), so correctness depends on every caller remembering it — the only real caller pattern in the repo does (`e2e/presentations.spec.ts:344`).

**MINOR — Held media and bitmaps are unbounded for the document's lifetime.**
`pendingMedia` (`store.ts:400`) and the decoded `images` map (`PresentationEditorPage.tsx:62-85`) retain every inserted image until close, with 200 assets allowed and 15 MB / 25 MP per upload (`limits.ts:17`, `validateUpload.ts:7-8`). Plan P25 owns "bounded media retention" and the store marks it (`store.ts:396-398`), but the decoded-bitmap side is not mentioned anywhere; report-only given the documented deferral.

**MINOR — Plan/status text is now stale.**
`docs/slides-implementation-plan.md` still says "P18 onward is not started" and both P18 and P19 are `[ ]`, while P18's module, store commands, UI wiring and tests exist. AGENTS.md requires the checklist to match actual behavior; P19's row should stay unchecked and P18's needs an honest note (document insertion works; media storage blocked on P19).

---

### What I could NOT confirm from the code

1. **P19's entire acceptance criterion.** No implementation and no test file to read; `saving`/`saveError` are unreachable in production.
2. **P18's "stored media insertion".** Media reaches a repository only in tests that call `savePresentation` by hand (`presentations.test.tsx:455`, `e2e/presentations.spec.ts:341-348`). No UI or hook reaches it.
3. **That an inserted image paints in a real browser.** No e2e image step exists, and the jsdom canvas never calls `renderSlide`.
4. **That any save path passes `baseRevision: savedRevision`.** The guard is opt-in and there is no production caller to inspect.
5. **That a quota/write failure retains editable work in the editor.** Only `store.test.ts:39-40` exercises `markSaveFailed`; the page surfaces `saveError` merely as a `title` tooltip (`PresentationEditorPage.tsx:281`) with no recovery UI, and no page-level failure path exists to test.
6. **Real IDB quota/transaction behaviour.** Covered only by an injected failure (`idb.test.ts:155`) and the P13/P14 proof doc.
7. **That the new tests, typecheck or build pass.** I have no shell.

### Checks a supervisor must run

```
npm run typecheck
npm run lint
npm test -- src/features/presentations/editor/store.test.ts src/features/presentations/editor/insertImageAsset.test.ts src/features/presentations/presentations.test.tsx src/lib/persistence/presentations/repository.test.ts src/lib/persistence/presentations/idb.test.ts
npm run build
```

No existing Playwright spec covers P18 or P19 insertion/save; the journey would need to be added (`npm run test:browser -- e2e/presentations.spec.ts` currently proves P15–P17 only).

### Merge verdict: **BLOCK**

P18's module, validation reuse, history behaviour and failure honesty are sound and worth keeping. It cannot merge as "P18+P19 done": P19 is absent, P18's media is unreachable by any user path, and no test anywhere exercises an inserted image being drawn or saved.
