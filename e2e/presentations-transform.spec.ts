import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openBlankEditor, seedFixturePresentation } from './presentations'

const OUT = join(process.cwd(), 'proofs', 'out')

/**
 * P24 browser evidence: move/resize/rotate happen in 1280×720 document units, so
 * the same gesture produces the same geometry at every zoom; the handles the
 * user grabs and the numbers in the inspector agree; and a locked element
 * cannot be manipulated. Pointer geometry cannot be proven in jsdom, so it is
 * proven here.
 */

type CanvasView = { origin: { x: number; y: number }; scale: number }

/** Where document units land on screen: the same mapping the canvas uses. */
async function canvasView(page: Page): Promise<CanvasView> {
  const host = page.getByTestId('presentation-canvas')
  const box = await host.boundingBox()
  if (!box) throw new Error('canvas host has no box')
  const zoom = Number(await host.getAttribute('data-view-zoom'))
  const pageWidth = Number(await host.getAttribute('data-document-width'))
  const pageHeight = Number(await host.getAttribute('data-document-height'))
  const scale = Math.min(box.width / pageWidth, box.height / pageHeight) * zoom
  return {
    origin: {
      x: box.x + (box.width - pageWidth * scale) / 2 + Number(await host.getAttribute('data-view-pan-x')),
      y: box.y + (box.height - pageHeight * scale) / 2 + Number(await host.getAttribute('data-view-pan-y')),
    },
    scale,
  }
}

/** Client point of one document-space point. */
function at(view: CanvasView, x: number, y: number): { x: number; y: number } {
  return { x: view.origin.x + x * view.scale, y: view.origin.y + y * view.scale }
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 4): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps)
  }
  await page.mouse.up()
}

async function clickAt(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.up()
}

type ElementSnapshot = {
  id: string
  kind: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  history: number
  preview: { elementId: string; x: number; y: number; width: number; height: number; rotation: number } | null
  pan: { x: number; y: number }
  zoom: number
}

async function readElement(page: Page, elementId?: string): Promise<ElementSnapshot> {
  return page.evaluate(async (id) => {
    const store = await import('/src/features/presentations/editor/store.ts')
    const state = store.usePresentationStore.getState()
    const element = state.document!.slides
      .flatMap((slide) => slide.elements)
      .find((candidate) => (id ? candidate.id === id : candidate.id === state.document!.slides[0]!.elements[0]!.id))!
    const preview = state.view.transformPreview
    return {
      id: element.id,
      kind: element.kind,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      history: state.past.length,
      preview: preview
        ? { elementId: preview.elementId, x: preview.x, y: preview.y, width: preview.width, height: preview.height, rotation: preview.rotation }
        : null,
      pan: state.view.pan,
      zoom: state.view.zoom,
    }
  }, elementId)
}

/** The rendered Konva group for one element: what is on screen, not what is stored. */
async function readRenderedNode(page: Page, elementId: string) {
  return page.evaluate(async (id) => {
    const { Konva } = await import('/src/features/presentations/rendering/konvaText.ts')
    const group = Konva.stages[0]?.findOne(`#${id}`)
    return group ? { x: group.x(), y: group.y(), rotation: group.rotation(), scaleX: group.scaleX(), scaleY: group.scaleY() } : null
  }, elementId)
}

async function setField(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label, { exact: true })
  await field.fill(value)
  await field.press('Enter')
  await expect(field).toHaveValue(value)
}

/** The centre of a client-pixel box, in client pixels. */
function centreOfBox(box: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** One point on the circle around `centre` through `point`, turned by `degrees`. */
function turnAround(centre: { x: number; y: number }, point: { x: number; y: number }, degrees: number) {
  const radians = (degrees * Math.PI) / 180
  const offset = { x: point.x - centre.x, y: point.y - centre.y }
  return {
    x: centre.x + offset.x * Math.cos(radians) - offset.y * Math.sin(radians),
    y: centre.y + offset.x * Math.sin(radians) + offset.y * Math.cos(radians),
  }
}

test('moves, resizes, and rotates in document units at two zoom levels', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 768 })
  await openBlankEditor(page)
  await page.getByRole('button', { name: 'Add text' }).click()
  await expect(page.getByRole('textbox', { name: 'Text content' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: 'Text content' })).toHaveCount(0)

  // A compact, known box, typed through the numeric inspector — which is also the
  // keyboard alternative to dragging.
  await setField(page, 'X position', '200')
  await setField(page, 'Y position', '200')
  await setField(page, 'Width', '320')
  await setField(page, 'Height', '160')
  const start = await readElement(page)
  expect({ x: start.x, y: start.y, width: start.width, height: start.height, rotation: start.rotation })
    .toEqual({ x: 200, y: 200, width: 320, height: 160, rotation: 0 })

  const canvasHost = page.getByTestId('presentation-canvas')
  const view = await canvasView(page)
  await clickAt(page, at(view, start.x + start.width / 2, start.y + start.height / 2))
  await expect(canvasHost).toHaveAttribute('data-selected-element', start.id)
  const handle = page.getByTestId('presentation-handle-se')
  await expect(handle).toBeVisible()
  // The handle the user grabs sits on the element's own document-space corner.
  const handleBox = (await handle.boundingBox())!
  const corner = at(view, start.x + start.width, start.y + start.height)
  expect(Math.abs(handleBox.x + handleBox.width / 2 - corner.x)).toBeLessThanOrEqual(3)
  expect(Math.abs(handleBox.y + handleBox.height / 2 - corner.y)).toBeLessThanOrEqual(3)
  await page.screenshot({ path: `${OUT}/p24-element-handles-1280x768.png`, fullPage: false })

  // Move: the document changes only when the gesture ends, and then exactly once.
  const from = at(view, start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 20, from.y + 8)
  await page.mouse.move(from.x + 40, from.y + 16)
  const during = await readElement(page)
  expect(during.preview?.elementId).toBe(start.id)
  expect({ x: during.x, y: during.y }).toEqual({ x: start.x, y: start.y })
  // The live preview reaches the rendering layer: the drawn group tracks the
  // pointer while the stored element has not moved a single unit.
  const duringNode = await readRenderedNode(page, start.id)
  expect(duringNode?.x).toBe(during.preview!.x)
  expect(duringNode?.x).not.toBe(during.x)
  // The numeric inspector describes the same live geometry as the frame.
  await expect(page.getByLabel('X position')).toHaveValue(String(during.preview!.x))
  await expect(page.getByLabel('Y position')).toHaveValue(String(during.preview!.y))
  await page.mouse.up()
  const moved = await readElement(page)
  expect(moved.preview).toBeNull()
  expect(moved.history).toBe(start.history + 1)
  expect(Math.abs(moved.x - Math.round(start.x + 40 / view.scale))).toBeLessThanOrEqual(1)
  expect(Math.abs(moved.y - Math.round(start.y + 16 / view.scale))).toBeLessThanOrEqual(1)

  // The same document-space move at 125% zoom: the view scale changed, the result did not.
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const zoomed = await canvasView(page)
  expect(zoomed.scale).toBeGreaterThan(view.scale)
  const beforeSecond = await readElement(page)
  const secondFrom = at(zoomed, beforeSecond.x + beforeSecond.width / 2, beforeSecond.y + beforeSecond.height / 2)
  await drag(page, secondFrom, {
    x: secondFrom.x + 40 * (zoomed.scale / view.scale),
    y: secondFrom.y + 16 * (zoomed.scale / view.scale),
  })
  const afterSecond = await readElement(page)
  expect(Math.abs((afterSecond.x - beforeSecond.x) - (moved.x - start.x))).toBeLessThanOrEqual(1)
  expect(Math.abs((afterSecond.y - beforeSecond.y) - (moved.y - start.y))).toBeLessThanOrEqual(1)
  expect(afterSecond.history).toBe(beforeSecond.history + 1)

  // Resize from the south-east handle: the opposite corner stays put, and the
  // numeric fields and the drawn frame keep agreeing with the document.
  await page.getByRole('button', { name: 'Fit slide to window' }).click()
  await expect(page.getByLabel('Canvas zoom')).toHaveText('100%')
  const fitted = await canvasView(page)
  const beforeResize = await readElement(page)
  await expect(page.getByLabel('X position')).toHaveValue(String(beforeResize.x))
  await expect(page.getByLabel('Width')).toHaveValue(String(beforeResize.width))
  const frame = page.getByTestId('presentation-selection-frame')
  const beforeFrame = (await frame.boundingBox())!
  const expectedFrame = at(fitted, beforeResize.x, beforeResize.y)
  expect(Math.abs(beforeFrame.x - expectedFrame.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(beforeFrame.y - expectedFrame.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(beforeFrame.width - beforeResize.width * fitted.scale)).toBeLessThanOrEqual(1.5)
  expect(Math.abs(beforeFrame.height - beforeResize.height * fitted.scale)).toBeLessThanOrEqual(1.5)

  const seBox = (await page.getByTestId('presentation-handle-se').boundingBox())!
  const seFrom = { x: seBox.x + seBox.width / 2, y: seBox.y + seBox.height / 2 }
  await page.mouse.move(seFrom.x, seFrom.y)
  await page.mouse.down()
  await page.mouse.move(seFrom.x + 30 * fitted.scale, seFrom.y + 15 * fitted.scale)
  await page.mouse.move(seFrom.x + 60 * fitted.scale, seFrom.y + 30 * fitted.scale)
  const duringResize = await readElement(page)
  expect(duringResize.preview).not.toBeNull()
  expect({ width: duringResize.width, height: duringResize.height })
    .toEqual({ width: beforeResize.width, height: beforeResize.height })
  const resizingNode = await readRenderedNode(page, beforeResize.id)
  expect(resizingNode?.scaleX).toBeCloseTo(duringResize.preview!.width / beforeResize.width, 5)
  await page.mouse.up()
  const resized = await readElement(page)
  expect({ x: resized.x, y: resized.y }).toEqual({ x: beforeResize.x, y: beforeResize.y })
  expect(Math.abs(resized.width - (beforeResize.width + 60))).toBeLessThanOrEqual(1)
  expect(Math.abs(resized.height - (beforeResize.height + 30))).toBeLessThanOrEqual(1)
  expect(resized.history).toBe(beforeResize.history + 1)
  await expect(page.getByLabel('Width')).toHaveValue(String(resized.width))
  await expect(page.getByLabel('Height')).toHaveValue(String(resized.height))
  const afterFrame = (await frame.boundingBox())!
  expect(Math.abs(afterFrame.width - resized.width * fitted.scale)).toBeLessThanOrEqual(1.5)
  expect(Math.abs(afterFrame.height - resized.height * fitted.scale)).toBeLessThanOrEqual(1.5)

  // Rotate a quarter turn around the element's centre: the round handle moves to
  // the right of the centre, and the centre itself stays where it was.
  const beforeRotate = await readElement(page)
  const centre = at(fitted, beforeRotate.x + beforeRotate.width / 2, beforeRotate.y + beforeRotate.height / 2)
  const rotateBox = (await page.getByTestId('presentation-handle-rotate').boundingBox())!
  const rotateFrom = { x: rotateBox.x + rotateBox.width / 2, y: rotateBox.y + rotateBox.height / 2 }
  const radius = Math.hypot(rotateFrom.x - centre.x, rotateFrom.y - centre.y)
  await drag(page, rotateFrom, { x: centre.x + radius, y: centre.y })
  const rotated = await readElement(page)
  expect(Math.abs(rotated.rotation - 90)).toBeLessThanOrEqual(1)
  expect(rotated.history).toBe(beforeRotate.history + 1)
  await expect(page.getByLabel('Rotation')).toHaveValue(String(rotated.rotation))
  const rotatedFrame = (await frame.boundingBox())!
  expect(Math.abs(rotatedFrame.x + rotatedFrame.width / 2 - centre.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(rotatedFrame.y + rotatedFrame.height / 2 - centre.y)).toBeLessThanOrEqual(2)
  await page.screenshot({ path: `${OUT}/p24-element-rotated-1280x768.png`, fullPage: false })

  // Zoom, pan, previews and handles are view state: the stored row carries the
  // document model only, and a reopen starts from a fit view.
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible({ timeout: 10_000 })
  const stored = await page.evaluate(async () => {
    const store = await import('/src/features/presentations/editor/store.ts')
    const persistence = await import('/src/lib/persistence/presentations/idb.ts')
    const live = store.usePresentationStore.getState().document!
    const row = await persistence.createIdbPresentationRepository().getPresentation(live.id)
    return {
      json: JSON.stringify(row),
      topLevelKeys: Object.keys(row).sort(),
      liveElementKeys: Object.keys(live.slides[0]!.elements[0]!).sort(),
      storedElementKeys: Object.keys(row.slides[0]!.elements[0]!).sort(),
    }
  })
  expect(stored.storedElementKeys).toEqual(stored.liveElementKeys)
  expect(stored.json).not.toContain('transformPreview')
  expect(stored.topLevelKeys).not.toContain('zoom')
  expect(stored.topLevelKeys).not.toContain('pan')

  await page.reload()
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  await page.goto('/presentations')
  await page.getByRole('link', { name: 'Open Untitled presentation' }).click()
  await expect(page.getByTestId('presentation-canvas')).toBeVisible()
  const reopened = await readElement(page)
  expect({ x: reopened.x, y: reopened.y, width: reopened.width, height: reopened.height, rotation: reopened.rotation })
    .toEqual({ x: rotated.x, y: rotated.y, width: rotated.width, height: rotated.height, rotation: rotated.rotation })
  expect(reopened.zoom).toBe(1)
  expect(reopened.pan).toEqual({ x: 0, y: 0 })
})

test('keeps the element centre when an already-rotated element turns again', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 768 })
  await openBlankEditor(page)
  await page.getByRole('button', { name: 'Add text' }).click()
  await expect(page.getByRole('textbox', { name: 'Text content' })).toBeFocused()
  await page.keyboard.press('Escape')
  await setField(page, 'X position', '200')
  await setField(page, 'Y position', '200')
  await setField(page, 'Width', '320')
  await setField(page, 'Height', '160')

  const canvasHost = page.getByTestId('presentation-canvas')
  const start = await readElement(page)
  const view = await canvasView(page)
  await clickAt(page, at(view, start.x + start.width / 2, start.y + start.height / 2))
  await expect(canvasHost).toHaveAttribute('data-selected-element', start.id)

  const frame = page.getByTestId('presentation-selection-frame')
  const centreBefore = centreOfBox((await frame.boundingBox())!)

  // The numeric field replaces the angle about the visual centre: the stored
  // origin moves so the frame stays exactly where it was.
  await setField(page, 'Rotation', '90')
  const quarter = await readElement(page)
  expect(quarter.rotation).toBe(90)
  expect({ x: quarter.x, y: quarter.y }).toEqual({ x: 440, y: 120 })
  const centreAfterField = centreOfBox((await frame.boundingBox())!)
  expect(Math.abs(centreAfterField.x - centreBefore.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(centreAfterField.y - centreBefore.y)).toBeLessThanOrEqual(2)

  // Dragging the round handle again turns the already-rotated element about the
  // same visual centre instead of around its stored origin.
  const handleBox = (await page.getByTestId('presentation-handle-rotate').boundingBox())!
  const from = centreOfBox(handleBox)
  await drag(page, from, turnAround(centreAfterField, from, 85), 6)
  const turned = await readElement(page)
  expect(Math.abs(turned.rotation - 175)).toBeLessThanOrEqual(2)
  expect(turned.history).toBe(quarter.history + 1)
  const centreAfterDrag = centreOfBox((await frame.boundingBox())!)
  expect(Math.abs(centreAfterDrag.x - centreBefore.x)).toBeLessThanOrEqual(3)
  expect(Math.abs(centreAfterDrag.y - centreBefore.y)).toBeLessThanOrEqual(3)
})

test('keeps the numeric geometry path and 44px handles when the inspector pane is hidden', async ({ page }) => {
  await openBlankEditor(page)
  await page.getByRole('button', { name: 'Add text' }).click()
  await expect(page.getByRole('textbox', { name: 'Text content' })).toBeFocused()
  await page.keyboard.press('Escape')
  await setField(page, 'X position', '200')
  await setField(page, 'Y position', '200')
  await setField(page, 'Width', '320')
  await setField(page, 'Height', '160')

  for (const [index, viewport] of [{ width: 1024, height: 768 }, { width: 390, height: 844 }].entries()) {
    await page.setViewportSize(viewport)
    const canvasHost = page.getByTestId('presentation-canvas')
    const before = await readElement(page)
    // Select by clicking the painted element: locator.click() scrolls the phone
    // layout's canvas into view, where the mouse alone would stay off screen.
    const view = await canvasView(page)
    const hostBox = (await canvasHost.boundingBox())!
    const elementCentre = at(view, before.x + before.width / 2, before.y + before.height / 2)
    await canvasHost.click({ position: { x: elementCentre.x - hostBox.x, y: elementCentre.y - hostBox.y } })
    await expect(canvasHost).toHaveAttribute('data-selected-element', before.id)

    // The wide pane is hidden at this width, so the numeric fields are reached
    // through the shared dialog instead of disappearing.
    await expect(page.getByLabel('X position').first()).toBeHidden()
    await page.getByRole('button', { name: 'Element properties' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const xField = dialog.getByLabel('X position')
    await expect(xField).toBeVisible()
    const targetX = 260 + index * 20
    await xField.fill(String(targetX))
    await xField.press('Enter')
    await page.screenshot({ path: `${OUT}/p24-element-properties-${viewport.width}x${viewport.height}.png`, fullPage: false, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    const moved = await readElement(page)
    expect(moved.x).toBe(targetX)
    expect(moved.history).toBe(before.history + 1)

    // The handle keeps its visual centre on the corner but offers a finger-sized
    // target: a press 16px outside the 14px square still starts the resize.
    const handle = page.getByTestId('presentation-handle-se')
    await handle.scrollIntoViewIfNeeded()
    const handleCentre = centreOfBox((await handle.boundingBox())!)
    const from = { x: handleCentre.x + 16, y: handleCentre.y + 16 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 20, from.y + 10)
    await page.mouse.move(from.x + 40, from.y + 20)
    await page.mouse.up()
    const resized = await readElement(page)
    expect(resized.width).toBeGreaterThan(moved.width)
    expect({ x: resized.x, y: resized.y }).toEqual({ x: moved.x, y: moved.y })
    expect(resized.history).toBe(moved.history + 1)
  }
})

test('selects every visible element kind and leaves a locked element alone', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 768 })
  const presentationId = await seedFixturePresentation(page)
  await page.goto(`/presentations/${presentationId}`)
  await expect(page.getByRole('heading', { name: 'Bài trình bày mẫu — Fixture' })).toBeVisible()
  const canvasHost = page.getByTestId('presentation-canvas')
  const view = await canvasView(page)

  // Image, shape, and text are all selectable by clicking what is painted.
  await clickAt(page, at(view, 880 + 128, 400 + 128))
  await expect(canvasHost).toHaveAttribute('data-selected-element', 'fixture-image-sticker')
  await expect(page.getByTestId('presentation-handle-se')).toBeVisible()
  await clickAt(page, at(view, 200, 500))
  await expect(canvasHost).toHaveAttribute('data-selected-element', 'fixture-shape-ellipse')
  await clickAt(page, at(view, 640, 216))
  await expect(canvasHost).toHaveAttribute('data-selected-element', 'fixture-text-title')

  // A locked element still selects and shows its frame, but has no handles and
  // no gesture can change it.
  await page.evaluate(async () => {
    const store = await import('/src/features/presentations/editor/store.ts')
    store.usePresentationStore.getState().toggleElementLocked('fixture-shape-ellipse')
  })
  const before = await readElement(page, 'fixture-shape-ellipse')
  await clickAt(page, at(view, 200, 500))
  await expect(canvasHost).toHaveAttribute('data-selected-element', 'fixture-shape-ellipse')
  await expect(page.getByTestId('presentation-handle-se')).toHaveCount(0)
  // The numeric path is disabled too, so nothing on screen offers a move it would refuse.
  await expect(page.getByLabel('Width')).toBeDisabled()
  await drag(page, at(view, 200, 500), at(view, 260, 540), 3)
  const after = await readElement(page, 'fixture-shape-ellipse')
  expect({ x: after.x, y: after.y, width: after.width, height: after.height, rotation: after.rotation })
    .toEqual({ x: before.x, y: before.y, width: before.width, height: before.height, rotation: before.rotation })
  expect(after.history).toBe(before.history)
  // The locked element swallowed the drag instead of panning the view.
  expect(after.pan).toEqual({ x: 0, y: 0 })
})
