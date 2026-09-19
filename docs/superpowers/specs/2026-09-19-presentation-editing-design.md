# Presentation editing: text fitting, presets, and built-in layouts

## Approved scope

The owner approved both styled text presets and reusable slide layouts, with automatic box growth, an explicit fixed-box shrink-to-fit option, visual/offline layout choices, consistent editing/export behavior, and insertion that never overwrites the current slide. This document records that chat approval and makes the execution details explicit.

## Global constraints

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

## Verified current implementation

- `PresentationEditorPage.svelte:addTextBox` inserts an empty 1000 × 160 text element at (140, 240), with no heading/subheading selection.
- `TextEditOverlay.svelte:commit` updates paragraphs, not box geometry. `TextOverflowNotice.svelte` offers manual height growth. `e2e/presentation-text.spec.ts` explicitly tests that manual workflow.
- The overlay sets an absolute width/height and outer viewport scale, but does not apply the element rotation. Its flex paragraph children have no explicit no-shrink rule.
- `textLayout.ts` measures and wraps paragraphs for canvas/raster rendering. Its paragraph base-size reduction floors small text at 18 units; its whitespace tokenizer can consume repeated newlines as a whitespace token. These need regression tests before fitting relies on them.
- `store.svelte.ts:commit` validates and records document changes; text and geometry currently have separate commands. Fitting belongs within those transactions, not a post-render effect.
- `renderSlide.ts` is shared by canvas, raster previews, and PDF rasterization. `pptx.ts` independently emits native text from stored paragraph sizes and geometry.
- `InsertTemplateDialog.svelte` needs a catalog repository and lists remote slide names. `shippedTemplates.js` already demonstrates ordinary editable text/shape layouts and image-area shapes; no new master-slide engine is required.
- The inspected source establishes these behaviors, not a browser reproduction of the owner's particular failing slide. Capture that reproduction during execution before changing rendering.

## Text sizing contract

Add optional `TextElement.autoGrow?: boolean`. Absence means fixed/manual, preserving old decks and shipped/catalog templates. New editor-created presets set it to true. Keep schema version 1; validate and preserve the optional boolean rather than rewriting absent fields.

An auto-growing box keeps its x/y, width, rotation, and authored font sizes. Content/format/width/padding/line-height changes can increase its height in the same undo transaction. Deleting text does not automatically shrink its height. A manual requested height remains a minimum while auto-grow is enabled; users select Fixed box to control it precisely. Growth is capped at the largest height whose rotated corners stay on the slide. If the existing box is already outside the page, do not grow it farther. Explain remaining overflow and provide grow, explicit shrink, or editing guidance; never discard text.

`Shrink text to fit` proportionally reduces all run sizes, preserving relative sizes and other formatting, and switches the box to fixed mode. Find the largest fitting factor with bounded search. Do not make any authored run smaller than min(12, its current size). If no fitting result exists at that floor, make no change and report: “This text cannot fit at a readable size. Enlarge the box or shorten the text.” The chosen sizes are stored, so all renderers consume the same result. No hidden export-time fitting.

Existing boxes can opt into automatic growth through the inspector. Locked text cannot be resized, reformatted, or fitted through the new controls.

## Text presets

Three visible insertion actions: Add heading, Add subheading, and Add body text. Retain Add text as the existing body insertion alias for compatibility.

- Heading: 56 document units, theme heading font, theme text color, (80, 64), width 1120, initial height 96.
- Subheading: 36 units, theme heading font, theme muted color (fallback text color), (80, 176), width 1120, initial height 72.
- Body: 28 units, theme body font, theme text color, (80, 272), width 1120, initial height 80.
- All use 8 units padding, 1.3 line height, top alignment, automatic growth, and an empty styled run rather than unstyled empty runs. Empty styles survive the first input, clearing the field, and save/reopen.
- Insertion enters editing immediately. Layout sample text is ordinary editable content, not a new semantic heading/master-slide type.

## Built-in layouts

Provide an always-available Add layout dialog with five preview cards. Use the active theme and ordinary editable elements, fresh IDs on each insertion, and no network assets.

| Layout          | Elements (x, y, width, height)                                                              |
| --------------- | ------------------------------------------------------------------------------------------- |
| Title slide     | Heading (80, 224, 1120, 104), subheading (80, 344, 1120, 80)                                |
| Title + body    | Heading (80, 56, 1120, 104), body (80, 200, 1120, 400)                                      |
| Two columns     | Heading (80, 56, 1120, 104), body left (80, 200, 536, 400), body right (664, 200, 536, 400) |
| Section header  | Heading (80, 264, 1120, 112), subheading (80, 400, 1120, 80)                                |
| Image + caption | Rectangle image area (160, 64, 960, 480), body caption (160, 568, 960, 88)                  |

Text samples: “Presentation title” / “Add a subtitle”; “Slide heading” / “Add your main points”; “Slide heading” / “Left column” / “Right column”; “Section heading” / “Introduce this section”; “Add a caption”. Image area is an ordinary rectangle named Image area, not an image asset or a fake image element. Selecting it offers Add image here, which replaces the rectangle with a real image at identical geometry via the existing atomic image replacement path. This action is available for rectangles/rounded rectangles generally, not detected through a magic element name. Local uploads remain unavailable in catalog-template editing mode.

Preview cards use the actual layout slide model and existing rasterizer, not unrelated decorative mockups. Generate previews only while the dialog is open; load fonts first. Guard stale async results. A failed preview shows a labeled fallback card, without disabling insertion. Reuse Modal for Escape, focus trapping, and focus restoration. Two columns on desktop, one on narrow screens; no horizontal scrolling.

Local asset-free insertion is one ordinary store command and autosaves like Add slide. In template editing mode it stays dirty until explicit save, rather than silently publishing a new draft version. Remote catalog template insertion remains separate and unchanged.

## Verification and boundaries

Tests must cover model/parser compatibility, pure fitting and rotation limits, grouped history, locked elements, real-browser metrics, multiline/large/Vietnamese text, caret/IME/paste regressions, offline layout insertion, independent IDs, layout limits, image write failure, and save/reopen. Exercise new and existing decks. Preserve existing catalog-template save semantics.

Canvas and raster/PDF share the stored geometry. PPTX tests inspect OOXML dimensions and font sizes; representative exports must also be opened in an available supported reader. Record unavailable reader checks rather than claiming they passed.

Not included: master-slide inheritance, theme editing redesign, custom layout authoring, collaborative editing, automatic slide splitting, replacing Konva, or a new rich-text dependency.
