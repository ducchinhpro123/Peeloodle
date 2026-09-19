# Presentation Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make presentation text fit predictably and provide useful heading/body presets and five offline, visually previewed slide layouts.

**Architecture:** Extend the existing document, command store, DOM editing overlay, and shared renderer. Resolve automatic height growth and explicit shrink-to-fit into stored geometry/font sizes within the originating command, so history, save, canvas, and exports agree. Build layouts from ordinary text/shapes and insert them with one asset-free store command; reuse atomic image replacement for the image area.

**Tech Stack:** Existing Svelte 5/SvelteKit, TypeScript and JSDoc, Konva 9, Vitest browser/server projects, Playwright, PptxGenJS 4, IndexedDB repositories. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-19-presentation-editing-design.md`

## Global Constraints

- Extend the existing Svelte 5 presentation editor; do not replace it or introduce dependencies.
- Keep the 1280 × 720 document coordinate system independent of viewport zoom.
- Preserve existing documents on load: no automatic reflow, revision bump, or silent font-size change.
- New editor text presets and built-in layout text use automatic height growth by default.
- Shrink-to-fit is an explicit, undoable action, never an automatic side effect of typing.
- Built-in layouts and text presets work without a catalog connection and after offline readiness completes.
- Insert layouts as new slides after the active slide; never replace existing slide content.
- Keep image writes persist-first and atomic with their media bytes.
- Preserve text selection/caret, IME input, safe paste/link handling, save/reopen, and grouped undo/redo.
- Do not promise pixel-identical editable PPTX rendering across third-party readers; verify stored geometry, font sizes, and representative reader output.

---

## Starting evidence and execution rules

Planning baseline: clean tree at `756499c`; on 2026-09-19 the following command passed **75 tests across three files**:

```bash
npm run test:unit -- --run --project server src/lib/presentations/rendering/textLayout.test.ts src/lib/presentations/editor/store.test.ts src/lib/presentations/model/parse.test.ts
```

This is baseline evidence, not evidence that proposed code works. No application code has been changed by this plan. Reinspect working tree and files when executing. Create an isolated workspace using using-git-worktrees if needed. Read both spec and plan. Run failing tests before implementation and preserve useful failure output. Do not commit someone else's changes.

Installed package ranges in `package.json` are not installed version evidence: the baseline runner reports Vitest 4.1.11. Use the lockfile/installed packages when checking specific library behavior.

A visual defect cannot be closed by unit tests alone. Reproduce typing several lines and enlarging a selection in a real editor first. Record overlay dimensions, paragraph rectangles, stored box geometry after blur, font readiness, and a screenshot. Use `e2e/presentations.ts` helpers rather than exposing the store on window.

### Files and responsibilities

| File                                                                       | Responsibility / change                                                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/lib/presentations/model/types.ts`, `parse.ts`, `factories.ts`         | Optional persisted `autoGrow`; validate without rewriting old data                                                      |
| `src/lib/presentations/rendering/textLayout.ts`                            | Correct small-font and hard-newline measurement before fitting                                                          |
| `src/lib/presentations/editor/textFit.ts` (new)                            | Pure height growth, rotated page bounds, explicit proportional shrink                                                   |
| `src/lib/presentations/editor/textMeasure.ts`                              | Real browser canvas metrics, deterministic server fallback                                                              |
| `src/lib/presentations/editor/store.svelte.ts`                             | Fit within existing history transaction; explicit shrink and asset-free slide insertion; rectangle-to-image replacement |
| `src/lib/presentations/editor/textBridge.ts`                               | Consistent paragraph metrics and styled empty text                                                                      |
| `src/lib/components/presentation/TextEditOverlay.svelte`                   | Preserve empty style, rotation, no flex shrinking, caret-safe growth                                                    |
| `src/lib/components/presentation/TextOverflowNotice.svelte`                | Sizing mode and explicit fit controls, actionable refusal                                                               |
| `src/lib/presentations/editor/textPresets.ts` (new)                        | Heading/subheading/body factories based on theme                                                                        |
| `src/lib/presentations/templates/builtinLayouts.ts` (new)                  | Five asset-free slide factories                                                                                         |
| `src/lib/components/presentation/BuiltinLayoutDialog.svelte` (new)         | Accessible layout cards and actual slide previews                                                                       |
| `src/lib/components/presentation/PresentationEditorPage.svelte`            | Wire presets/layouts and existing image-write flow                                                                      |
| `src/lib/components/presentation/ElementGeometryInspector.svelte`          | Add image here action for rectangle areas                                                                               |
| Existing tests + new adjacent tests and `e2e/presentation-editing.spec.ts` | Regression and acceptance coverage                                                                                      |

Do not split `PresentationEditorPage.svelte` or the store as unrelated cleanup. The new pure factories isolate the new responsibility without rewriting existing editor orchestration. Do not change the remote `InsertTemplateDialog` behavior.

## Task 1: Persist sizing intent and implement reliable pure fitting

**Files:**

- Modify: `src/lib/presentations/model/types.ts:TextElement`
- Modify: `src/lib/presentations/model/factories.ts:TextElementInput, createTextElement`
- Modify: `src/lib/presentations/model/parse.ts:parseTextElement`
- Modify: `src/lib/presentations/rendering/textLayout.ts:maxRunSize, tokenizeParagraph`
- Create: `src/lib/presentations/editor/textFit.ts`
- Test: `src/lib/presentations/model/parse.test.ts`
- Test: `src/lib/presentations/rendering/textLayout.test.ts`
- Create: `src/lib/presentations/editor/textFit.test.ts`

**Interfaces:**

- Consumes existing `TextElement`, `PresentationDocument['pageSize']`, `MeasureText`, `layoutTextElement`.
- Produces optional `autoGrow?: boolean`; absent means false.
- Produces `growTextToFit(element: TextElement, page: PresentationDocument['pageSize'], measure: MeasureText): TextElement`.
- Produces `shrinkTextToFit(element: TextElement, measure: MeasureText): TextElement | null` (null means no readable fit).
- Produces `textBoxInsidePage(element: TextElement, page: PresentationDocument['pageSize']): boolean`.

- [ ] **Step 1: Add regression tests for parser compatibility and layout inputs.** Add to the existing test files using their current imports/helpers:

```ts
// parse.test.ts: import factories if not already imported.
it('preserves optional sizing intent without migrating old documents', () => {
	const document = createPresentationDocument();
	const legacy = createTextElement({ text: 'Old deck' });
	document.slides[0]!.elements = [legacy];
	const old = parsePresentationDocument(document);
	expect(old.slides[0]!.elements[0]).not.toHaveProperty('autoGrow');
	Object.assign(legacy, { autoGrow: true });
	expect(parsePresentationDocument(document).slides[0]!.elements[0]).toHaveProperty(
		'autoGrow',
		true
	);
	Object.assign(legacy, { autoGrow: false });
	expect(parsePresentationDocument(document).slides[0]!.elements[0]).toHaveProperty(
		'autoGrow',
		false
	);
	Object.assign(legacy, { autoGrow: 'yes' });
	expect(() => parsePresentationDocument(document)).toThrow(/autoGrow/);
});

// textLayout.test.ts: use its existing paragraph/fakeMeasure helpers.
it('preserves repeated explicit newlines', () => {
	const result = layoutParagraphs([paragraph('one \n\ntwo')], { ...base, width: 400 });
	expect(result.lines.map((line) => line.text)).toEqual(['one', '', 'two']);
});
it('does not impose an 18-unit floor on authored small text', () => {
	const p = paragraph('small');
	p.runs[0]!.size = 12;
	const result = layoutParagraphs([p], { ...base, width: 400 });
	expect(result.contentHeight).toBeCloseTo(14.4);
});
```

Create `textFit.test.ts`:

```ts
import { expect, it } from 'vitest';
import { createTextElement } from '../model/factories';
import { layoutTextElement, type MeasureText } from '../rendering/textLayout';
import { growTextToFit, shrinkTextToFit, textBoxInsidePage } from './textFit';
const measure: MeasureText = (text, font) => (Array.from(text).length * font.size) / 2;
const page = { width: 1280, height: 720 } as const;

it('grows vertically without changing typography or shrinking on deletion', () => {
	const source = createTextElement({
		x: 80,
		y: 80,
		width: 160,
		height: 40,
		text: 'Words across several lines with Vietnamese: Xin chào',
		size: 28
	});
	const grown = growTextToFit(source, page, measure);
	expect(grown.height).toBeGreaterThan(source.height);
	expect(grown.paragraphs).toEqual(source.paragraphs);
	expect([grown.x, grown.y, grown.width]).toEqual([80, 80, 160]);
	expect(layoutTextElement(grown, measure).overflow).toBe(false);
	const shortened = structuredClone(grown);
	shortened.paragraphs[0]!.runs[0]!.text = 'Short';
	expect(growTextToFit(shortened, page, measure).height).toBe(grown.height);
});
it('caps growth at the slide edge and accounts for rotation', () => {
	const source = createTextElement({
		x: 80,
		y: 660,
		width: 200,
		height: 40,
		text: 'Long text '.repeat(50)
	});
	const grown = growTextToFit(source, page, measure);
	expect(grown.height).toBeLessThanOrEqual(60);
	expect(layoutTextElement(grown, measure).overflow).toBe(true);
	const rotated = createTextElement({
		x: 200,
		y: 80,
		width: 200,
		height: 40,
		rotation: 90,
		text: 'Long text '.repeat(50)
	});
	const result = growTextToFit(rotated, page, measure);
	expect(textBoxInsidePage(result, page)).toBe(true);
	expect(result.height).toBeLessThanOrEqual(200);
});
it('shrinks proportionally, explicitly, and refuses unreadable fits atomically', () => {
	const source = createTextElement({
		width: 220,
		height: 120,
		padding: 8,
		text: 'One two three four five six',
		size: 56
	});
	const original = structuredClone(source);
	const fitted = shrinkTextToFit(source, measure);
	expect(fitted).not.toBeNull();
	expect(fitted!.autoGrow).toBe(false);
	expect(fitted!.height).toBe(source.height);
	expect(fitted!.paragraphs[0]!.runs[0]!.size).toBeLessThan(56);
	expect(layoutTextElement(fitted!, measure).overflow).toBe(false);
	expect(source).toEqual(original);
	expect(shrinkTextToFit({ ...source, height: 1 }, measure)).toBeNull();
});
it('keeps empty and already-fitting text stable', () => {
	const source = createTextElement({ text: '', size: 28 });
	expect(growTextToFit(source, page, measure)).toBe(source);
	expect(shrinkTextToFit(source, measure)?.paragraphs).toEqual(source.paragraphs);
});
```

- [ ] **Step 2: Run the tests and confirm failures for missing fit exports, dropped boolean, small-font height, and repeated newline.**

```bash
npm run test:unit -- --run --project server src/lib/presentations/model/parse.test.ts src/lib/presentations/rendering/textLayout.test.ts src/lib/presentations/editor/textFit.test.ts
```

- [ ] **Step 3: Implement the additive model changes and layout corrections.** In `TextElement` and `TextElementInput`, add `autoGrow?: boolean`. In the factory's returned text object and the parser's returned text object respectively:

```ts
// Factory: absence stays absent; existing fixtures/templates remain fixed.
...(input.autoGrow === undefined ? {} : { autoGrow: input.autoGrow }),
// Parser: null, strings, numbers and objects are invalid, not false.
...(value.autoGrow === undefined
  ? {}
  : { autoGrow: requiredBoolean(value.autoGrow, `${label}.autoGrow`) }),
```

Keep `ElementBaseValues` correct by adding `'autoGrow'` to its omitted text-only keys. Keep schema version 1. Change the tokenizer split to `/(\n|[^\S\n]+)/` in source. Change `maxRunSize` to return `fallback` only when `paragraph.runs.length === 0`, otherwise reduce from 0. Retain current paragraph-wide maximum-size line metrics; do not introduce a new line-breaking algorithm in this task.

- [ ] **Step 4: Implement the pure fitting module.**

```ts
import type { PresentationDocument, TextElement } from '../model/types';
import { layoutTextElement, type MeasureText } from '../rendering/textLayout';

type Page = PresentationDocument['pageSize'];
export function textBoxInsidePage(element: TextElement, page: Page): boolean {
	const radians = (element.rotation * Math.PI) / 180;
	const cos = Math.cos(radians),
		sin = Math.sin(radians);
	return [
		[0, 0],
		[element.width, 0],
		[0, element.height],
		[element.width, element.height]
	].every(([x, y]) => {
		const px = element.x + x! * cos - y! * sin;
		const py = element.y + x! * sin + y! * cos;
		return px >= -0.01 && py >= -0.01 && px <= page.width + 0.01 && py <= page.height + 0.01;
	});
}
export function growTextToFit(element: TextElement, page: Page, measure: MeasureText): TextElement {
	const required = Math.ceil(
		layoutTextElement(element, measure).contentHeight + element.padding * 2
	);
	if (required <= element.height || !textBoxInsidePage(element, page)) return element;
	const full = { ...element, height: required };
	if (textBoxInsidePage(full, page)) return full;
	let low = element.height,
		high = required;
	for (let i = 0; i < 24; i++) {
		const height = (low + high) / 2;
		if (textBoxInsidePage({ ...element, height }, page)) low = height;
		else high = height;
	}
	const height = Math.max(element.height, Math.floor(low));
	return height === element.height ? element : { ...element, height };
}
export function shrinkTextToFit(element: TextElement, measure: MeasureText): TextElement | null {
	const scale = (factor: number): TextElement => ({
		...element,
		autoGrow: false,
		paragraphs: element.paragraphs.map((paragraph) => ({
			...paragraph,
			runs: paragraph.runs.map((run) => ({ ...run, size: run.size * factor }))
		}))
	});
	const fits = (candidate: TextElement) => {
		const result = layoutTextElement(candidate, measure);
		return (
			!result.overflow && result.lines.every((line) => line.width <= line.availableWidth + 0.01)
		);
	};
	if (fits(element)) return scale(1);
	const runs = element.paragraphs.flatMap((paragraph) => paragraph.runs);
	if (!runs.length) return null;
	const floor = Math.max(...runs.map((run) => Math.min(12, run.size) / run.size));
	let low = floor,
		high = 1;
	if (!fits(scale(low))) return null;
	for (let i = 0; i < 24; i++) {
		const middle = (low + high) / 2;
		if (fits(scale(middle))) low = middle;
		else high = middle;
	}
	return scale(low);
}
```

These helpers consume parser-validated geometry. Do not call them on raw imported JSON. Add a mixed-run test with a 56/28 size ratio, bold, italic and link attributes; assert the ratio and all non-size properties survive. Add an already-off-page test: growth returns its original element. Add a 1-unit existing run test: the helper must not reduce that run at all.

- [ ] **Step 5: Run focused tests and type checks, then commit only Task 1 files.**

```bash
npm run test:unit -- --run --project server src/lib/presentations/model/parse.test.ts src/lib/presentations/rendering/textLayout.test.ts src/lib/presentations/editor/textFit.test.ts
npm run check
git add src/lib/presentations/model/{types.ts,factories.ts,parse.ts,parse.test.ts} src/lib/presentations/rendering/{textLayout.ts,textLayout.test.ts} src/lib/presentations/editor/{textFit.ts,textFit.test.ts}
git commit -m "feat: add compatible text sizing and pure fitting"
```

## Task 2: Make sizing part of the text/geometry command transaction

**Files:**

- Modify: `src/lib/presentations/editor/store.svelte.ts:createPresentationStore, commit, updateText, updateElement`
- Modify: `src/lib/presentations/editor/textMeasure.ts:measureTextWidth`
- Test: `src/lib/presentations/editor/store.test.ts`
- Test: `src/lib/presentations/editor/presentationSaving.test.ts`

**Interfaces:**

- Consumes Task 1 fitting functions.
- Extends `createPresentationStore(options?: { measureText?: MeasureText }): PresentationStore`.
- Adds `PresentationStoreState.shrinkText(elementId: string): boolean`; false means unavailable/locked/unreadable, with no mutation.
- Existing `updateText`, `updateElement`, `transformElement`, `commitTransform` signatures stay unchanged.

- [ ] **Step 1: Add command tests using an injected deterministic measurer.**

```ts
it('groups typing and automatic geometry into one undo entry', () => {
	const store = createPresentationStore({
		measureText: (text, spec) => (text.length * spec.size) / 2
	});
	const document = createPresentationDocument();
	const text = createTextElement({
		id: 'grow',
		autoGrow: true,
		x: 80,
		y: 80,
		width: 200,
		height: 40,
		text: 'Hello'
	});
	document.slides[0]!.elements = [text];
	store.getState().loadDocument(document);
	const paragraphs = structuredClone(text.paragraphs);
	paragraphs[0]!.runs[0]!.text = 'Many words across multiple lines '.repeat(3);
	store.getState().updateText(text.id, paragraphs, { historyGroup: 'text:grow' });
	const grown = store.getState().document!.slides[0]!.elements[0]!;
	expect(grown.height).toBeGreaterThan(40);
	expect(store.getState().past).toHaveLength(1);
	store.getState().endHistoryGroup();
	store.getState().undo();
	expect(store.getState().document!.slides[0]!.elements[0]).toEqual(text);
	store.getState().redo();
	expect(store.getState().document!.slides[0]!.elements[0]).toEqual(grown);
});
it('does not reflow legacy text on load or on unrelated edits', () => {
	const store = createPresentationStore();
	const document = createPresentationDocument();
	const text = createTextElement({ text: 'Overflow '.repeat(100), height: 20 });
	document.slides[0]!.elements = [text];
	store.getState().loadDocument(document);
	expect(store.getState().dirty).toBe(false);
	store.getState().renameSlide(document.slides[0]!.id, 'Renamed');
	expect(store.getState().document!.slides[0]!.elements[0]).toEqual(text);
});
```

- [ ] **Step 2: Run store tests and confirm the new signature/auto-grow behavior fails.**

```bash
npm run test:unit -- --run --project server src/lib/presentations/editor/store.test.ts
```

- [ ] **Step 3: Fit changed text before publishing the next revision.** Import `measureTextWidth`, `MeasureText`, and Task 1 functions. Change the store constructor signature to `export function createPresentationStore(options: { measureText?: MeasureText } = {}): PresentationStore` and capture `const measure = options.measureText ?? measureTextWidth` before `return createStore(...)`. In `commit`, replace the single serialization of `withRevision(current, draft)` with:

```ts
let next = serializePresentationDocument(withRevision(current, draft));
const previous = new Map(current.slides.flatMap((slide) => slide.elements).map((e) => [e.id, e]));
let fitted = false;
for (const slide of next.slides) {
	slide.elements = slide.elements.map((element) => {
		if (element.kind !== 'text' || !element.autoGrow || element.locked) return element;
		const old = previous.get(element.id);
		const signature = (value: typeof element) =>
			JSON.stringify([
				value.paragraphs,
				value.width,
				value.height,
				value.padding,
				value.lineHeight,
				value.autoGrow
			]);
		if (old?.kind === 'text' && signature(old) === signature(element)) return element;
		const result = growTextToFit(element, next.pageSize, measure);
		if (result !== element) fitted = true;
		return result;
	});
}
if (fitted) next = serializePresentationDocument(next);
```

Both validation passes happen before history/state mutation. Loading, undo, redo, and remote persisted adoption stay exact; do not fit on read or in an effect. Fitting only changes height, so no caret reseed is needed.

Route `updateText` through the existing `updateElement` after verifying the target is unlocked text, rather than maintaining a second fitting path:

```ts
updateText(elementId, paragraphs, options) {
  const element = get().document?.slides.flatMap(slide => slide.elements)
    .find(candidate => candidate.id === elementId);
  if (element?.kind !== 'text' || element.locked) return;
  get().updateElement(elementId, { paragraphs }, options);
},
shrinkText(elementId) {
  const element = get().document?.slides.flatMap(slide => slide.elements)
    .find(candidate => candidate.id === elementId);
  if (element?.kind !== 'text' || element.locked) return false;
  const fitted = shrinkTextToFit(element, measure);
  if (!fitted) return false;
  get().endHistoryGroup();
  get().updateElement(elementId, { paragraphs: fitted.paragraphs, autoGrow: false });
  get().endHistoryGroup();
  return true;
},
```

Guard sizing/text patches in `updateElement` when the target is locked (paragraphs, width, height, padding, lineHeight, autoGrow). Keep lock-toggle commands working. Use the existing structural equality to preserve no-op behavior.

In `textMeasure.ts`, remove `import.meta.env.MODE === 'test'` from the fallback condition: Vitest's client project uses a real browser and must measure real fonts. Keep the `typeof document === 'undefined'` fallback and inject `measureText` in deterministic Node command tests. This is not permission to replace browser metrics with estimates.

- [ ] **Step 4: Add width/format/locking/save regressions.** Use the first test's store setup to test `updateElement(id, { width: 120 })`, larger paragraph run sizes, `lineHeight: 2`, and `padding: 24`; each must fit within the same single command. With `autoGrow: false`, height remains unchanged. With a locked element, sizing and shrink are no-ops. An invalid width patch throws before changing document/history. In the existing saver harness, save an auto-grown document and compare the repository's stored height and `autoGrow` to the store document; reload into a fresh store and assert clean state.

Concrete invalid-input assertion:

```ts
const before = store.getState().document;
const history = store.getState().past;
expect(() => store.getState().updateElement('grow', { width: NaN })).toThrow();
expect(store.getState().document).toBe(before);
expect(store.getState().past).toBe(history);
```

- [ ] **Step 5: Verify all affected suites and run Svelte autofixer on `store.svelte.ts`; fix findings, then commit.**

```bash
npm run test:unit -- --run --project server src/lib/presentations/editor/store.test.ts src/lib/presentations/editor/presentationSaving.test.ts src/lib/presentations/editor/textFit.test.ts
npm run check
git add src/lib/presentations/editor/{store.svelte.ts,store.test.ts,textMeasure.ts,presentationSaving.test.ts}
git commit -m "feat: fit text atomically with editor commands"
```

## Task 3: Fix DOM text bounds and expose usable sizing controls

**Files:**

- Modify: `src/lib/presentations/editor/textBridge.ts:paragraphsToHtml`
- Modify: `src/lib/components/presentation/TextEditOverlay.svelte:commit, markup, styles`
- Modify: `src/lib/components/presentation/TextOverflowNotice.svelte`
- Test: `src/lib/presentations/editor/textBridge.svelte.test.ts`
- Test: `e2e/presentation-text.spec.ts`
- Create: `e2e/presentation-editing.spec.ts`

**Interfaces:**

- Uses `store.shrinkText`, `TextElement.autoGrow`, and existing overlay/session contracts.
- Keeps `TextOverflowNotice` props `{ element, store }` unchanged, so desktop and properties-modal consumers both work.
- No DOM object or HTML is added to the document.

- [ ] **Step 1: Add a browser regression that measures actual contents rather than merely checking that a warning appears.** Create the new E2E file:

```ts
import { expect, test } from '@playwright/test';
import { openBlankEditor, readStoredPresentationJson } from './presentations';

test('multiline text remains inside its auto-growing box while typing', async ({ page }) => {
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add text', exact: true }).click();
	const field = page.getByTestId('text-edit-field');
	await expect(field).toBeFocused();
	await field.blur();
	await page
		.getByRole('complementary', { name: 'Presentation details' })
		.getByLabel('Text sizing')
		.selectOption('grow');
	await page.getByRole('button', { name: 'Edit text', exact: true }).click();
	await expect(field).toBeFocused();
	await field.fill('Xin chào Việt Nam\nSecond line\nThird line\nFourth line\nFifth line');
	await expect
		.poll(() =>
			field.evaluate((host) => {
				const rect = host.getBoundingClientRect();
				return Array.from(host.children).every((child) => {
					const box = child.getBoundingClientRect();
					return box.bottom <= rect.bottom + 1 && box.right <= rect.right + 1;
				});
			})
		)
		.toBe(true);
	await field.blur();
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	const row = JSON.parse(await readStoredPresentationJson(page, id));
	expect(row.slides[0].elements[0].autoGrow).toBe(true);
	await page.reload();
	await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
	const reopened = JSON.parse(await readStoredPresentationJson(page, id));
	expect(reopened.slides[0].elements[0]).toEqual(row.slides[0].elements[0]);
});
```

This test explicitly enables Automatic height, so Task 3 is independently testable before presets are wired. In Task 4, remove the blur/select/Edit text setup from this test to verify the new default directly.

- [ ] **Step 2: Write/run bridge tests for styled empty text and paragraph metrics.**

```ts
it('keeps an empty heading run styled in the editing DOM', () => {
	const paragraphs = [
		{
			alignment: 'left' as const,
			bullet: 'none' as const,
			bulletLevel: 0 as const,
			runs: [{ text: '', fontId: 'spectral', size: 56, color: '#123456' }]
		}
	];
	const host = document.createElement('div');
	host.innerHTML = paragraphsToHtml(paragraphs, { lineHeight: 1.3 });
	expect(host.querySelector('[data-size="56"]')).not.toBeNull();
	expect(host.querySelector('p')?.style.fontSize).toBe('56px');
});
```

Run `npm run test:unit -- --run --project client src/lib/presentations/editor/textBridge.svelte.test.ts`; expect the empty styled span assertion to fail before the change.

- [ ] **Step 3: Preserve empty styles and prevent flex compression; rotate the overlay.** In `paragraphsToHtml`, keep styled empty runs rather than replacing all empty content with a bare `<br>`. Use the paragraph's maximum authored size on its `<p>` to match the existing layout service's paragraph-wide line metrics:

```ts
const paragraphSize = paragraph.runs.reduce((max, run) => Math.max(max, run.size), 0);
const sizeStyle = paragraphSize ? `font-size:${paragraphSize * scale}px;` : '';
const runs = paragraph.runs
	.map((run) => {
		const text = escapeHtml(run.text).replace(/\n/g, '<br>');
		const inner = text || (paragraph.runs.length === 1 ? '<br>' : '');
		return `<span ${runStyleAttributes(run)} style="${runCss(run, scale)}">${inner}</span>`;
	})
	.join('');
const content = runs || '<br>';
```

Insert `sizeStyle` into the existing paragraph style string. Preserve safe escaping, marker attributes, hanging indents, and link restrictions. Do not introduce unsanitized HTML.

In overlay `commit`, normalize a genuinely empty result to one empty run carrying `defaults()` before calling `updateText`:

```js
const paragraphs = readParagraphsFromDom(host, defaults());
if (paragraphs.every((paragraph) => paragraph.runs.every((run) => run.text === ''))) {
	paragraphs[0].runs = [{ ...defaults(), text: '' }];
}
store.getState().updateText(element.id, paragraphs, {
	historyGroup: textHistoryGroup(element.id)
});
```

Do not collapse explicit blank paragraphs. Add these rules/attributes to the current overlay, not a replacement editor:

```svelte
style:transform="rotate({element.rotation}deg)"
```

```css
.presentation-text-editor {
	transform-origin: 0 0;
}
.presentation-text-editor :global(p) {
	flex-shrink: 0;
	min-width: 0;
}
```

The outer layer still handles viewport scale/offset; the field handles element rotation. Do not observe the transformed bounding rectangle to compute document height. Do not reseed on height updates. Preserve current IME and selection caching logic.

- [ ] **Step 4: Expand `TextOverflowNotice.svelte` into persistent sizing controls.** Retain its existing layout/overflow derived values. Import `tick` and add `let fitError = $state('')`. Put a sizing select above the conditional notice:

```svelte
<label>
	Text sizing
	<select
		aria-label="Text sizing"
		value={element.autoGrow ? 'grow' : 'fixed'}
		disabled={element.locked}
		onchange={(event) => {
			fitError = '';
			store
				.getState()
				.updateElement(element.id, { autoGrow: event.currentTarget.value === 'grow' });
			store.getState().endHistoryGroup();
		}}
	>
		<option value="grow">Automatic height</option>
		<option value="fixed">Fixed box</option>
	</select>
</label>
<button type="button" class={button} disabled={element.locked} onclick={shrink}>
	Shrink text to fit
</button>
{#if fitError}<p role="status">{fitError}</p>{/if}
```

Use the following click handler; normal pointer focus/blur ends editing before the shrink transaction. Do not prevent mousedown for this button, because an open overlay could otherwise flush pre-shrink runs back into the document on teardown.

```js
async function shrink() {
	const id = element.id;
	await tick();
	if (store.getState().view.editingElementId === id) {
		fitError = 'Finish editing this text before shrinking it.';
		return;
	}
	fitError = store.getState().shrinkText(id)
		? ''
		: 'This text cannot fit at a readable size. Enlarge the box or shorten the text.';
}
```

Keep Grow box to fit for legacy/fixed boxes, disabled for locked text. Replace its raw unbounded `height: fitHeight` patch with `growTextToFit(element, pageSize, measureTextWidth)` and update only height. When capped, retain the notice and show “Text reaches the slide edge. Move or widen the box, shrink the text, or shorten it.” Remove now-unused derived variables. Style labels/buttons using existing `button` and spacing variables, not a new control framework.

- [ ] **Step 5: Update the manual-overflow E2E test to explicitly choose Fixed box.** Scope inspector controls to the visible Presentation details panel because the properties modal mounts another copy. Add browser checks for heading-size 56/96, consecutive blank lines, mixed font sizes, rotated text, width changes, an emoji/long unbroken word, and caret insertion in the middle. Use real canvas metrics; inspect screenshot and element bounds at fit zoom and 200%. If an unsupported wrapping case still spills horizontally, keep a failing regression and fix the shared wrapping path before proceeding; do not hide it with overflow clipping.

- [ ] **Step 6: Run bridge/browser suites, Svelte autofixer on changed components, and commit.**

```bash
npm run test:unit -- --run --project client src/lib/presentations/editor/textBridge.svelte.test.ts
npx playwright test e2e/presentation-text.spec.ts e2e/presentation-editing.spec.ts
npm run check
git add src/lib/presentations/editor/textBridge.ts src/lib/presentations/editor/textBridge.svelte.test.ts src/lib/components/presentation/{TextEditOverlay.svelte,TextOverflowNotice.svelte} e2e/presentation-text.spec.ts e2e/presentation-editing.spec.ts
git commit -m "fix: align text editing bounds and expose explicit fitting"
```

## Task 4: Add heading, subheading, and body presets

**Files:**

- Create: `src/lib/presentations/editor/textPresets.ts`
- Create: `src/lib/presentations/editor/textPresets.test.ts`
- Modify: `src/lib/components/presentation/PresentationEditorPage.svelte:addTextBox, insertion toolbar`
- Test: `src/lib/components/presentation-editor-page.svelte.test.ts`
- Test: `e2e/presentation-editing.spec.ts`

**Interfaces:**

- Produces `TextPreset = 'heading' | 'subheading' | 'body'`.
- Produces `createPresetText(preset: TextPreset, theme: Theme, text?: string): TextElement`.
- The optional text argument is for layout samples; insertion defaults to an empty styled run.

- [ ] **Step 1: Write/run the preset contract test.**

```ts
import { expect, it } from 'vitest';
import { DEFAULT_THEME } from '../model/factories';
import { createPresetText } from './textPresets';

it('uses theme fonts/colors and independent ids for every insertion', () => {
	const theme = { ...DEFAULT_THEME, colors: { text: '#123456', muted: '#345678' } };
	const heading = createPresetText('heading', theme);
	const subheading = createPresetText('subheading', theme);
	const body = createPresetText('body', theme);
	expect(heading.paragraphs[0]!.runs[0]).toMatchObject({
		text: '',
		size: 56,
		fontId: theme.headingFontId,
		color: '#123456'
	});
	expect(subheading.paragraphs[0]!.runs[0]).toMatchObject({ size: 36, color: '#345678' });
	expect(body.paragraphs[0]!.runs[0]).toMatchObject({ size: 28, fontId: theme.bodyFontId });
	expect([heading, subheading, body].every((text) => text.autoGrow)).toBe(true);
	expect(createPresetText('heading', theme).id).not.toBe(heading.id);
});
```

Run `npm run test:unit -- --run --project server src/lib/presentations/editor/textPresets.test.ts`; expect missing module.

- [ ] **Step 2: Implement the small theme-aware factory.**

```ts
import { createTextElement, DEFAULT_THEME } from '../model/factories';
import type { TextElement, Theme } from '../model/types';
export type TextPreset = 'heading' | 'subheading' | 'body';
const PRESETS = {
	heading: { name: 'Heading', size: 56, y: 64, height: 96 },
	subheading: { name: 'Subheading', size: 36, y: 176, height: 72 },
	body: { name: 'Body text', size: 28, y: 272, height: 80 }
} as const;
export function createPresetText(preset: TextPreset, theme: Theme, text = ''): TextElement {
	return createTextElement({
		...PRESETS[preset],
		text,
		x: 80,
		width: 1120,
		padding: 8,
		lineHeight: 1.3,
		autoGrow: true,
		fontId: preset === 'body' ? theme.bodyFontId : theme.headingFontId,
		color:
			(preset === 'subheading' ? theme.colors.muted : undefined) ??
			theme.colors.text ??
			DEFAULT_THEME.colors.text!
	});
}
```

- [ ] **Step 3: Replace only insertion construction and add visible actions.** Import the factory instead of `createTextElement` if no other call remains. Update `addTextBox(preset = 'body')` with JSDoc `@param {import('$lib/presentations/editor/textPresets').TextPreset} [preset]`:

```js
const state = store.getState();
if (!state.document || !activeSlide) return;
textSession.flush();
const element = createPresetText(preset, state.document.theme);
const id = store.getState().addElement(element);
if (id) store.getState().startTextEdit(id);
else insertError = 'This slide cannot hold another text box. Remove an element first.';
```

Use arrow callbacks so MouseEvent never becomes a preset argument. Keep Add text as the body alias, and add three explicit visible actions:

```svelte
<button type="button" class={button} onclick={() => addTextBox('heading')}>Add heading</button>
<button type="button" class={button} onclick={() => addTextBox('subheading')}>Add subheading</button
>
<button type="button" class={button} onclick={() => addTextBox('body')}>Add body text</button>
```

Group text insertions visually and allow wrapping on narrow screens. Do not add another full-width ribbon or hide heading insertion inside properties.

- [ ] **Step 4: Add a first-keystroke and reload test.**

```ts
test('heading preset styles survive first typing and reopening', async ({ page }) => {
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add heading', exact: true }).click();
	await expect(page.getByTestId('text-edit-field')).toBeFocused();
	await page.keyboard.type('My heading');
	await page.keyboard.press('Escape');
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	const row = JSON.parse(await readStoredPresentationJson(page, id));
	const text = row.slides[0].elements[0];
	expect(text.paragraphs[0].runs[0].size).toBe(56);
	expect(text.paragraphs[0].runs[0].fontId).toBe(row.theme.headingFontId);
	await page.reload();
	await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
	expect(JSON.parse(await readStoredPresentationJson(page, id)).slides[0].elements[0]).toEqual(
		text
	);
});
```

Also clear a heading with Select all/Backspace, type again, and assert size/font remain. Run Task 3's default auto-growing text test now without its temporary explicit sizing selection.

- [ ] **Step 5: Verify factory, editor component, browser tests and autofixer; commit.**

```bash
npm run test:unit -- --run --project server src/lib/presentations/editor/textPresets.test.ts
npm run test:unit -- --run --project client src/lib/components/presentation-editor-page.svelte.test.ts
npx playwright test e2e/presentation-text.spec.ts e2e/presentation-editing.spec.ts
npm run check
git add src/lib/presentations/editor/{textPresets.ts,textPresets.test.ts} src/lib/components/presentation/PresentationEditorPage.svelte src/lib/components/presentation-editor-page.svelte.test.ts e2e/presentation-editing.spec.ts
git commit -m "feat: add theme-aware text insertion presets"
```

## Task 5: Build offline layout factories and an atomic new-slide command

**Files:**

- Create: `src/lib/presentations/templates/builtinLayouts.ts`
- Create: `src/lib/presentations/templates/builtinLayouts.test.ts`
- Modify: `src/lib/presentations/editor/store.svelte.ts:PresentationStoreState, command object`
- Test: `src/lib/presentations/editor/store.test.ts`

**Interfaces:**

- Produces `BUILTIN_LAYOUTS`, `BuiltinLayoutId`, `createBuiltinLayout(id: BuiltinLayoutId, theme: Theme): Slide`.
- Adds `insertSlide(slide: Slide, afterSlideId?: string): string | null` to the store. Null means no document/cap refusal. Invalid model data throws before mutation.
- Reuses `slideInsertionRefusal(document, [slide], [])`; no repository write or remote catalog is needed.

- [ ] **Step 1: Write/run factory tests.**

```ts
import { expect, it } from 'vitest';
import { createPresentationDocument, DEFAULT_THEME } from '../model/factories';
import { parsePresentationDocument } from '../model/parse';
import { BUILTIN_LAYOUTS, createBuiltinLayout } from './builtinLayouts';

it.each(['title', 'title-body', 'two-columns', 'section', 'image-caption'] as const)(
	'creates a valid, independent %s slide without media',
	(id) => {
		const document = createPresentationDocument();
		const first = createBuiltinLayout(id, DEFAULT_THEME);
		const second = createBuiltinLayout(id, DEFAULT_THEME);
		document.slides = [first, second];
		expect(parsePresentationDocument(document).assets).toEqual([]);
		expect(first.id).not.toBe(second.id);
		expect(first.elements.every((e) => !second.elements.some((other) => other.id === e.id))).toBe(
			true
		);
		expect(first.elements.filter((e) => e.kind === 'text').every((e) => e.autoGrow)).toBe(true);
	}
);
it('exposes exactly five named layout choices', () => {
	expect(BUILTIN_LAYOUTS.map((item) => item.name)).toEqual([
		'Title slide',
		'Title + body',
		'Two columns',
		'Section header',
		'Image + caption'
	]);
});
```

Run `npm run test:unit -- --run --project server src/lib/presentations/templates/builtinLayouts.test.ts` (missing module expected).

- [ ] **Step 2: Implement the five concrete slide compositions.**

```ts
import { createSlide, createShapeElement, DEFAULT_THEME } from '../model/factories';
import { createPresetText, type TextPreset } from '../editor/textPresets';
import type { Element, Slide, Theme } from '../model/types';
export const BUILTIN_LAYOUTS = [
	{ id: 'title', name: 'Title slide' },
	{ id: 'title-body', name: 'Title + body' },
	{ id: 'two-columns', name: 'Two columns' },
	{ id: 'section', name: 'Section header' },
	{ id: 'image-caption', name: 'Image + caption' }
] as const;
export type BuiltinLayoutId = (typeof BUILTIN_LAYOUTS)[number]['id'];
export function createBuiltinLayout(id: BuiltinLayoutId, theme: Theme): Slide {
	const text = (
		preset: TextPreset,
		content: string,
		x: number,
		y: number,
		width: number,
		height: number
	) => ({ ...createPresetText(preset, theme, content), x, y, width, height });
	let elements: Element[];
	switch (id) {
		case 'title':
			elements = [
				text('heading', 'Presentation title', 80, 224, 1120, 104),
				text('subheading', 'Add a subtitle', 80, 344, 1120, 80)
			];
			break;
		case 'title-body':
			elements = [
				text('heading', 'Slide heading', 80, 56, 1120, 104),
				text('body', 'Add your main points', 80, 200, 1120, 400)
			];
			break;
		case 'two-columns':
			elements = [
				text('heading', 'Slide heading', 80, 56, 1120, 104),
				text('body', 'Left column', 80, 200, 536, 400),
				text('body', 'Right column', 664, 200, 536, 400)
			];
			break;
		case 'section':
			elements = [
				text('heading', 'Section heading', 80, 264, 1120, 112),
				text('subheading', 'Introduce this section', 80, 400, 1120, 80)
			];
			break;
		case 'image-caption':
			elements = [
				createShapeElement({
					name: 'Image area',
					x: 160,
					y: 64,
					width: 960,
					height: 480,
					fill: theme.colors.surface ?? '#eef2f0',
					stroke: theme.colors.accent ?? DEFAULT_THEME.colors.accent!,
					strokeWidth: 2
				}),
				text('body', 'Add a caption', 160, 568, 960, 88)
			];
			break;
	}
	return {
		...createSlide({
			name: BUILTIN_LAYOUTS.find((layout) => layout.id === id)!.name,
			background: theme.colors.background ?? DEFAULT_THEME.colors.background!
		}),
		elements
	};
}
```

- [ ] **Step 3: Add a store insertion test before adding the command.**

```ts
it('inserts one asset-free layout after the active slide as one undo entry', () => {
	const document = reset();
	const first = document.slides[0]!.id;
	const incoming = createSlide({ name: 'Layout' });
	incoming.elements = [createTextElement({ text: 'Heading' })];
	const before = structuredClone(state().document);
	const id = state().insertSlide(incoming);
	expect(state().document!.slides.map((slide) => slide.id)).toEqual([first, id]);
	expect(state().view.activeSlideId).toBe(id);
	expect(state().past).toHaveLength(1);
	expect(state().dirty).toBe(true);
	state().undo();
	expect(state().document!.slides).toEqual(before!.slides);
	state().redo();
	expect(state().document!.slides[1]).toEqual(incoming);
});
```

Import `createSlide` in the existing factory imports. Run the store suite and confirm the missing command failure.

- [ ] **Step 4: Add the command using the store's existing transaction machinery.**

```ts
insertSlide(slide, afterSlideId) {
  const document = get().document;
  if (!document || slideInsertionRefusal(document, [slide], [])) return null;
  const anchor = afterSlideId ?? get().view.activeSlideId;
  commit(draft => {
    const index = draft.slides.findIndex(candidate => candidate.id === anchor);
    draft.slides.splice(index < 0 ? draft.slides.length : index + 1, 0, structuredClone(slide));
  });
  set({ view: { ...get().view, activeSlideId: slide.id, selectedElementIds: [],
    editingElementId: null, transformPreview: null, guides: [] } });
  return slide.id;
},
```

Parser validation rejects duplicate IDs, missing image assets, or per-slide element limits before publication. Add cap/invalid-ID tests asserting no document/history mutation. Do not use `adoptPersistedSlideInsertion` for content that was not persisted. Do not call `persistSlides` in template mode: it would create a draft version just from adding a local layout.

- [ ] **Step 5: Verify and commit this independently testable factory/command deliverable.**

```bash
npm run test:unit -- --run --project server src/lib/presentations/templates/builtinLayouts.test.ts src/lib/presentations/editor/store.test.ts
npm run check
git add src/lib/presentations/templates/{builtinLayouts.ts,builtinLayouts.test.ts} src/lib/presentations/editor/{store.svelte.ts,store.test.ts}
git commit -m "feat: add built-in slide layouts and undoable insertion"
```

## Task 6: Expose visual layout cards and make image areas usable

**Files:**

- Create: `src/lib/components/presentation/BuiltinLayoutDialog.svelte`
- Modify: `src/lib/components/presentation/PresentationEditorPage.svelte`
- Modify: `src/lib/components/presentation/ElementGeometryInspector.svelte`
- Modify: `src/lib/presentations/editor/store.svelte.ts:imageReplaceRefusal, planImageReplacement`
- Test: `src/lib/presentations/editor/store.test.ts`
- Test: `src/lib/presentations/editor/presentationSaving.test.ts`
- Test: `e2e/presentation-editing.spec.ts`

**Interfaces:**

- Dialog props: `{ theme: Theme, disabled?: boolean, oninsert: (id: BuiltinLayoutId) => { ok: boolean; message?: string } }`.
- Existing `persistReplace(elementId, image)` accepts image elements and unlocked rectangle/rounded-rectangle shapes; all other shapes remain refused.
- Existing `onreplaceimage(elementId)` inspector callback is reused. No new asset kind, magic name detection, or placeholder metadata.

- [ ] **Step 1: Add a visible-flow E2E test and a replacement regression before implementation.**

```ts
test('inserts a built-in layout offline without replacing existing content', async ({
	page,
	context
}) => {
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add heading', exact: true }).click();
	await page.keyboard.type('Keep my original');
	await page.keyboard.press('Escape');
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	await context.setOffline(true);
	await page.getByRole('button', { name: 'Add layout', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a slide layout' });
	await expect(dialog.getByRole('button', { name: 'Two columns', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Two columns', exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect
		.poll(async () => JSON.parse(await readStoredPresentationJson(page, id)).slides.length)
		.toBe(2);
	const row = JSON.parse(await readStoredPresentationJson(page, id));
	expect(row.slides[0].elements[0].paragraphs[0].runs[0].text).toBe('Keep my original');
	expect(row.slides[1].elements).toHaveLength(3);
	await context.setOffline(false);
});
```

Add this beside the image replacement tests, where the existing `preparedImage` helper is in scope:

```ts
it('fills a rectangle with a real image and keeps its geometry', () => {
	const document = createPresentationDocument();
	const rectangle = createShapeElement({ x: 160, y: 64, width: 960, height: 480 });
	document.slides[0]!.elements = [rectangle];
	const image = preparedImage('a'.repeat(64));
	const plan = planImageReplacement(document, rectangle.id, image);
	expect(plan?.document.slides[0]!.elements[0]).toMatchObject({
		id: rectangle.id,
		kind: 'image',
		x: 160,
		y: 64,
		width: 960,
		height: 480,
		rotation: rectangle.rotation,
		opacity: rectangle.opacity,
		crop: coverCrop(image, rectangle)
	});
	rectangle.locked = true;
	expect(planImageReplacement(document, rectangle.id, image)).toBeNull();
	expect(imageReplaceRefusal(document, image, rectangle.id)).not.toBeNull();
	rectangle.locked = false;
	rectangle.shape = 'ellipse';
	expect(planImageReplacement(document, rectangle.id, image)).toBeNull();
});
```

Update the existing test named `refuses to replace anything that is not a selected image`: use an ellipse rather than a rectangle for its non-replaceable shape, and rename it to describe images or rectangular areas. Do not remove rejection coverage.

- [ ] **Step 2: Implement the preview dialog.** This is the complete component body; keep existing UI tokens:

```svelte
<script lang="ts">
	import { onDestroy } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { button } from '$lib/ui/styles.js';
	import { ensurePresentationFonts } from '$lib/presentations/rendering/fonts';
	import {
		BUILTIN_LAYOUTS,
		createBuiltinLayout,
		type BuiltinLayoutId
	} from '$lib/presentations/templates/builtinLayouts';
	import type { Theme } from '$lib/presentations/model/types';
	let {
		theme,
		disabled = false,
		oninsert
	}: {
		theme: Theme;
		disabled?: boolean;
		oninsert: (id: BuiltinLayoutId) => { ok: boolean; message?: string };
	} = $props();
	let open = $state(false);
	let error = $state('');
	let previews = $state<Record<string, string>>({});
	let epoch = 0;
	onDestroy(() => {
		epoch++;
	});
	function close() {
		epoch++;
		open = false;
	}
	async function show() {
		open = true;
		error = '';
		previews = {};
		const generation = ++epoch;
		const slides = BUILTIN_LAYOUTS.map((item) => ({
			id: item.id,
			slide: createBuiltinLayout(item.id, theme)
		}));
		try {
			await ensurePresentationFonts();
			const { rasterizeSlidePage } = await import('$lib/presentations/rendering/rasterizeSlide');
			for (const item of slides) {
				if (generation !== epoch) return;
				const raster = await rasterizeSlidePage({
					slide: item.slide,
					pageSize: { width: 1280, height: 720 },
					images: new Map(),
					width: 320,
					height: 180
				});
				if (generation !== epoch) return;
				previews[item.id] = raster.dataUrl;
			}
		} catch {
			// Preview failure never prevents inserting the ordinary editable slide.
		}
	}
	function insert(id: BuiltinLayoutId) {
		const result = oninsert(id);
		if (result.ok) close();
		else error = result.message ?? 'The slide could not be added.';
	}
</script>

<button type="button" class={button} {disabled} onclick={show}>Add layout</button>
<Modal
	{open}
	title="Add a slide layout"
	description="Adds a new slide after the current slide. Your existing content stays unchanged."
	onclose={close}
>
	<div class="layout-grid">
		{#each BUILTIN_LAYOUTS as item (item.id)}
			<button type="button" class="layout-card" onclick={() => insert(item.id)}>
				{#if previews[item.id]}
					<img src={previews[item.id]} alt="" width="320" height="180" />
				{:else}
					<span class="preview-fallback" aria-hidden="true">Slide preview</span>
				{/if}
				<span>{item.name}</span>
			</button>
		{/each}
	</div>
	{#if error}<p role="alert">{error}</p>{/if}
</Modal>

<style>
	.layout-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
	}
	.layout-card {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.layout-card:focus-visible {
		outline: 2px solid var(--mint);
		outline-offset: 2px;
	}
	.layout-card img,
	.preview-fallback {
		width: 100%;
		height: auto;
		aspect-ratio: 16 / 9;
	}
	.preview-fallback {
		display: grid;
		place-items: center;
		background: var(--surface);
	}
	@media (max-width: 600px) {
		.layout-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
```

The `onDestroy` hook invalidates pending previews on unmount. The native dialog restores focus to its opener; verify repeated open/Escape cycles with the existing modal tests. If native focus restoration fails when insertion changes the page, use the existing Modal `onclosed` callback with a registered opener attachment, not document-wide selectors. Do not add a module-global preview cache for five cards.

- [ ] **Step 3: Wire the layout command in both local and template modes.** Mount the dialog unconditionally when the editor is ready (not behind `catalogRepository`), next to Add slide. Import `createBuiltinLayout` and use:

```js
/** @param {import('$lib/presentations/templates/builtinLayouts').BuiltinLayoutId} layoutId */
function addBuiltinLayout(layoutId) {
	textSession.flush();
	store.getState().endTextEdit();
	store.getState().endHistoryGroup();
	const current = store.getState().document;
	if (!current) return { ok: false, message: 'Open a presentation before adding a layout.' };
	const slide = createBuiltinLayout(layoutId, current.theme);
	const id = store.getState().insertSlide(slide);
	if (!id)
		return { ok: false, message: 'This presentation has reached its slide or element limit.' };
	focusSlideId = id;
	return { ok: true };
}
```

```svelte
<BuiltinLayoutDialog theme={presentation.theme} disabled={inserting} oninsert={addBuiltinLayout} />
```

No automatic template draft save; the existing mode-specific saver behavior remains authoritative. Add an editor component assertion that clicking a built-in layout in template mode leaves the repository's save spy untouched until Save is clicked.

- [ ] **Step 4: Reuse atomic image replacement for rectangular areas.** In `imageReplaceRefusal`, accept images or rectangle/rounded-rectangle shapes and reject locked targets. In `planImageReplacement`, locate the parent slide and element index, then replace the target by creating an image element if the target is a rectangle:

```ts
const eligible =
	target &&
	!target.locked &&
	(target.kind === 'image' ||
		(target.kind === 'shape' && ['rectangle', 'rounded-rectangle'].includes(target.shape)));
if (!eligible) return null;
const replacement = createImageElement({
	id: target.id,
	name: target.name,
	x: target.x,
	y: target.y,
	width: target.width,
	height: target.height,
	rotation: target.rotation,
	opacity: target.opacity,
	visible: target.visible,
	locked: false,
	assetId: image.asset.id,
	alt: image.asset.provenance.label,
	crop: coverCrop(image, target),
	...(target.kind === 'image' ? { flipX: target.flipX, flipY: target.flipY } : {})
});
```

Assign the replacement to the same slide/index; reuse the existing known-asset check, validation, revision, and plan shape. Do not spread shape-only fields into a returned image object. Keep `persistReplace` and adoption/race replay semantics; the same rectangle id must survive. A save failure must leave the original rectangle and history untouched.

In `ElementGeometryInspector`'s shape branch, after the existing style controls:

```svelte
{#if onreplaceimage && (element.shape === 'rectangle' || element.shape === 'rounded-rectangle')}
	<button
		type="button"
		class={button}
		disabled={element.locked}
		onclick={() => onreplaceimage?.(element.id)}>Add image here</button
	>
{/if}
```

The editor already withholds local upload callbacks in template mode; verify both inspector instances and preserve that restriction. Reuse `beginReplaceImage` and `replacePhoto`, including file cancellation and image decoding error states.

- [ ] **Step 5: Verify failures, keyboard flow, offline previews, and image insertion.** Extend the existing saver failure test to replace a rectangle and assert it survives a rejected write. Verify image fitting with a tall photo and undo back to the rectangle. Open the dialog twice, Escape twice, then reopen and insert; Tab must stay in the modal and Escape must restore focus. At 390px width, confirm all five cards are reachable without horizontal scroll. If preview rendering fails, insertion still succeeds through the labeled card.

```bash
npm run test:unit -- --run --project server src/lib/presentations/editor/store.test.ts src/lib/presentations/editor/presentationSaving.test.ts
npm run test:unit -- --run --project client src/lib/components/presentation-editor-page.svelte.test.ts
npx playwright test e2e/presentation-editing.spec.ts e2e/presentation-image.spec.ts e2e/presentation-offline.spec.ts e2e/presentation-responsive.spec.ts
npm run check
```

Run Svelte autofixer on the new dialog, editor page, inspector, and store. Fix findings before committing the Task 6 files with `git commit -m "feat: expose offline layout previews and fillable image areas"`.

## Task 7: Prove rendering/export consistency and close regressions

**Files:**

- Test: `src/lib/presentations/exports/pptx.test.ts`
- Test: `src/lib/presentations/exports/snapshot.test.ts`
- Test: `src/lib/presentations/rendering/rasterizeSlide.svelte.test.ts`
- Test: `e2e/presentation-editing.spec.ts`
- Create: `proofs/presentation-editing-acceptance.md`
- Modify production export code only if a new failing assertion demonstrates a mismatch.

**Interfaces:**

- Consumes the same stored fitted `TextElement` and existing `PresentationExportSnapshot`.
- Produces regression evidence, not a second fitting implementation or a renderer-specific policy.

- [ ] **Step 1: Add exact PPTX geometry/font-size assertions.** In `pptx.test.ts`, reuse `snapshotOf`, `unzipSync`, and `strFromU8`, and import `growTextToFit`/`shrinkTextToFit`:

```ts
it('exports resolved text geometry and sizes rather than fitting again', async () => {
	const document = createPresentationDocument();
	const measure = (text: string, font: { size: number }) => (text.length * font.size) / 2;
	const source = createTextElement({
		name: 'Fitted heading',
		x: 80,
		y: 80,
		width: 300,
		height: 100,
		text: 'Heading across several lines',
		size: 56
	});
	const fitted = shrinkTextToFit(source, measure)!;
	expect(fitted).not.toBeNull();
	document.slides[0]!.elements = [fitted];
	const before = structuredClone(document);
	const bytes = await buildPresentationPptx(snapshotOf(document, new Map()));
	const xml = strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']!);
	expect(xml).toContain(`cx="${Math.round(fitted.width * 9525)}"`);
	expect(xml).toContain(`cy="${Math.round(fitted.height * 9525)}"`);
	expect(xml).toContain(`sz="${Math.round(fitted.paragraphs[0]!.runs[0]!.size * 75)}"`);
	expect(document).toEqual(before);
});
```

If the PptxGenJS version emits a different legitimate rounding rule, inspect its installed XML writer and assert that rule precisely (do not loosen to “contains text”). Add the matching auto-grown-height case and preserve native text objects.

- [ ] **Step 2: Assert preflight stays honest at the page edge.** Use `collectExportWarnings` with a deterministic measure: fitted in-page text has no text-overflow warning; growth capped at the page edge still has one. Explicit shrink refusal leaves the original document byte-for-byte equal. Existing missing-font/missing-media failures must still pass.

- [ ] **Step 3: Add real-browser visual bounds checks for all five layouts and fitted text.** Use the existing raster browser test harness and `rasterizeSlidePage` after `ensurePresentationFonts`. Assert 1280 × 720 page dimensions and capture rasters of each layout. Compare normal canvas and exported raster for the same stored slide without editor chrome. Check overlay paragraph bounds at 100% and 200%, with 56/96-sized headings, multiline body, mixed runs, Vietnamese, bullets, and rotation. Do not use estimated Node widths as browser visual proof.

- [ ] **Step 4: Run final verification, not only the new tests.**

```bash
npm run check
npm run test:unit -- --run
npx playwright test e2e/presentation-editing.spec.ts e2e/presentation-text.spec.ts e2e/presentation-transform.spec.ts e2e/presentation-slides.spec.ts e2e/presentation-image.spec.ts e2e/presentation-exports.spec.ts e2e/presentation-offline.spec.ts e2e/presentation-responsive.spec.ts
npm run lint
npm run build
```

Inspect any failure instead of declaring it unrelated. Run Svelte autofixer on every changed `.svelte`/`.svelte.ts` source until findings are resolved. Run the existing catalog/template component tests as part of the full unit suite; check a local layout insertion in draft mode creates no version until explicit save.

- [ ] **Step 5: Record actual visual and reader evidence.** `proofs/presentation-editing-acceptance.md` must record the commit, commands/exits, browser/version, viewport/zoom, screenshot/raster paths, and a table of the tested input, observed geometry, and pass/fail. Include:

1. Heading and body insertion, first typing, clear/retype, save/reload.
2. Growth while typing/formatting/width-resizing, fixed mode, explicit shrink and refusal, locked text.
3. Caret-middle edits, IME, paste, undo/redo; no content loss after shrink/blur.
4. All five offline preview/insertion flows, double insertion with independent IDs, original slide unchanged, slide/element-cap refusal.
5. Image-area replacement success/failure/undo and template-mode upload restriction.
6. PDF/raster comparison and editable PPTX opened in an available supported reader. Mark a reader unavailable if it cannot be tested; attach OOXML checks separately, not as a substitute for reader proof.

- [ ] **Step 6: Commit verified acceptance coverage and evidence.**

```bash
git add src/lib/presentations/exports/{pptx.test.ts,snapshot.test.ts} src/lib/presentations/rendering/rasterizeSlide.svelte.test.ts e2e/presentation-editing.spec.ts proofs/presentation-editing-acceptance.md
git commit -m "test: verify text fitting and layout editing end to end"
```

## Self-review / coverage map

- Automatic growth, fixed mode, readable explicit shrink: Tasks 1–3.
- Legacy document compatibility and validation: Tasks 1–2.
- Headings, subheadings, body presets and theme styling: Task 4.
- Five layouts, fresh IDs, no overwrite, atomic history, offline availability: Tasks 5–6.
- Real previews, accessible modal, responsive cards: Task 6.
- Usable image area without orphaned bytes or fake asset metadata: Task 6.
- Caret/IME/safe paste, undo/save/reopen, export consistency: Tasks 3–4 and 7.
- No replacement editor/dependency/master-slide subsystem: all tasks.

### Execution handoff

Execute tasks in order. Tasks 1–2 establish shared contracts; do not dispatch conflicting edits to the store or editor page concurrently. Review each completed deliverable before moving on. This plan describes proposed code: its examples must be typechecked, autofixed, and tested against the execution checkout rather than pasted unquestioningly.
