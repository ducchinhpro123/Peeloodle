# P28 — rectangle, rounded rectangle, ellipse, line and arrow

**Date:** 2026-09-13
**Plan row:** P28.
**Acceptance:** fill/stroke/geometry persist and undo correctly; supported kinds match the export adapter.
**Scope:** new `editor/shapeTools.ts` and `editor/ShapeStyleInspector.tsx`, an Add shape control in
`editor/PresentationEditorPage.tsx`, the shape controls mounted by `editor/ElementGeometryInspector.tsx`,
and `.presentation-add-shape` / `.presentation-shape-fields` in `src/styles.css`. No schema change, no new
dependency. `renderSlide` already drew every `ShapeKind`, so the renderer is untouched.

## What was built

| File | Change |
| --- | --- |
| `editor/shapeTools.ts` | `createSlideShape(kind, pageSize, options?)` builds a centred element through `createShapeElement`: 480×270 blocks and 480×160 diagonals, accent fill for blocks, text-coloured 4-unit stroke and no fill for line/arrow. |
| `editor/ShapeStyleInspector.tsx` | Fill colour + "No fill", stroke colour + "No stroke", and stroke width; linear kinds show only line colour/width. Every change is grouped under `shape-style:<id>` so a picker drag is one undo entry. |
| `editor/PresentationEditorPage.tsx` | An accessible "Add shape" select inserts the chosen kind into the active slide. |
| `editor/ElementGeometryInspector.tsx` | Mounts the shape controls wherever the geometry inspector appears (wide pane and properties dialog). |

## Acceptance, as verified

| Criterion | Evidence |
| --- | --- |
| All five kinds insert | UI test inserts rectangle, ellipse, rounded rectangle, line and arrow and reads the shape kinds back from the document in order. |
| Geometry defaults | UI test asserts the centred 400/225 position; the module's unit tests cover centring and per-kind sizes for every kind. |
| Fill/stroke defaults | Unit tests cover block fill/stroke and line/arrow stroke/no-fill; UI test asserts the inserted line is `fill: null`, `stroke: #08152f`, `strokeWidth: 4`. |
| Persists | UI test waits for the stored row to carry the edited fill before asserting undo. |
| Undo correctly | UI test undoes an insertion and then the grouped style session (one entry for two controls) and reads the accent fill back. |
| Kinds match the export adapter | The model's `ShapeKind` union is the single source: `renderSlide` and the future PPTX adapter consume the same kinds; no parallel list was introduced. |

## Checks run

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 4 pre-existing warnings (verified for the new files by the module handoff) |
| `npx vitest run --environment jsdom ... shapeTools.test.ts` | 24 passed |
| `npx vitest run --environment jsdom ... presentations.test.tsx -t "shape kind"` | 1 passed |
| `npm test` | full suite run at the end of the milestone increment |

## Known gaps and deliberate ceilings

- Lines and arrows are diagonal presets (`(0,0) → (width,height)`); there is no endpoint editing beyond
  moving/resizing/rotating the element.
- Rounded-rectangle corner radius is fixed by the renderer (min(24, width/4, height/4)); it is not a
  document property.
- The Add shape control is a labelled select rather than an icon dropdown; the shared dropdown primitive
  does not exist in `src/components/ui/` yet.
- No Playwright run for this task (owner requested fast jsdom checks); the renderer for shapes was already
  exercised by the P15/P16 browser evidence.
