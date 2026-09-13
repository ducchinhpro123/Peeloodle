# P38/P39 — editable PPTX export

**Date:** 2026-09-13
**Plan rows:** P38 (text paragraphs/runs/bullets/hyperlinks) and P39 (shapes and image transforms/crops).
**Acceptance:** native text objects preserve content/styles; shape stays editable; each image separately
movable; transparency and placement preserved.
**Scope:** new `exports/pptx.ts`, `exports/pptx.test.ts`. Uses the `pptxgenjs` dependency evaluated in the
P03 proof; no new dependency.

## What was built

| Mapping | Detail |
| --- | --- |
| Page | `LAYOUT_WIDE` 13⅓×7.5 in; document units are 1/96 in through `unitsToInches`/`unitsToPoints`. |
| Text | One native text box per element: runs keep font face, point size, colour, bold/italic and hyperlinks; paragraphs carry alignment, bullet character or `buAutoNum` with explicit start values, indent level and line-spacing multiple. |
| Rotation | OOXML rotates around the frame centre while the document rotates around the element's top-left, so `pptxFrame` shifts the frame origin by the rotated-centre difference. |
| Shapes | Native `rect`/`roundRect`/`ellipse`/`line`; fill/stroke colours, stroke width, transparency, rounded-rect radius and arrow end. |
| Images | Embedded per element from the snapshot's original bytes, so each picture is separately movable; `srcRect` carries the non-destructive crop (normalized crop mapped through the full-image/crop-box sizing), plus flip and rotation. |

## Acceptance, as verified

| Criterion | Evidence |
| --- | --- |
| Native text content/styles | OOXML test reads `slide1.xml`: run text, `b="1"`, `i="1"`, centre alignment, `hlinkClick` and the relationship URL. |
| Bullets | Second slide contains `buChar`, `buAutoNum` and `lvl="1"` for a numbered level-1 paragraph. |
| Shapes editable | `prst="rect"` with the fill and stroke colour values present. |
| Images separately movable | Each image is its own media entry; the test finds the embedded PNG and asserts it is byte-identical to the source. |
| Crop/placement | `srcRect l="25000" r="25000"` for a 25%/50% crop; `flipH="1"`; `rot="2700000"` (45°); helper tests assert the frame math and the full-image/crop-box numbers. |
| Order | `slide1.xml`/`slide2.xml` exist and no third slide is written. |

## Checks run

`npx vitest run exports/pptx.test.ts` 7 passed; full suite at the end of the increment.

## Known gaps

- The deck was not opened in a real presentation app in this increment (deferred with P44); editability is
  asserted from the generated OOXML package, not from an app round-trip.
- Crop is mapped through PptxGenJS's `sizing: 'crop'`; the exact reader rendering of rotated cropped
  pictures still needs the P44 reader pass.
