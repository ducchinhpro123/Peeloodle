<script>
	import { getSlideEditor } from '#lib/presentations/editor/context.js';
	import { Konva } from '#lib/presentations/rendering/konvaText.js';
	import { renderSlide, renderText } from '#lib/presentations/rendering/renderSlide.js';
	import {
		clampPresentationPan,
		clampPresentationZoom,
		presentationViewport
	} from '#lib/presentations/editor/viewGeometry.js';
	import { snapToAlignment } from '#lib/presentations/editor/alignmentGuides.js';
	import {
		documentPointFromView,
		elementGeometry,
		elementWorldCenter,
		moveTransform,
		nextRotationStep,
		resizeTransform,
		rotateTransform,
		rotationFromPoint
	} from '#lib/presentations/editor/transformGeometry.js';
	import PresentationSelectionFrame from './PresentationSelectionFrame.svelte';
	import TextEditOverlay from './TextEditOverlay.svelte';

	/**
	 * @typedef {import('#lib/presentations/editor/transformGeometry.js').TransformGeometry} TransformGeometry
	 * @typedef {import('#lib/presentations/editor/transformGeometry.js').ViewPoint} ViewPoint
	 * @typedef {import('#lib/presentations/editor/transformGeometry.js').ResizeHandle} ResizeHandle
	 * @typedef {import('#lib/presentations/editor/alignmentGuides.js').AlignmentGuide} AlignmentGuide
	 * @typedef {import('#lib/presentations/model/types.js').Element} Element
	 *
	 * @typedef {{
	 *   pointerId: number,
	 *   x: number,
	 *   y: number,
	 *   capture: HTMLElement | null
	 * }} PanGesture
	 *
	 * @typedef {{
	 *   kind: 'move' | 'resize' | 'rotate',
	 *   pointerId: number,
	 *   elementId: string,
	 *   handle: ResizeHandle | null,
	 *   origin: ViewPoint,
	 *   start: TransformGeometry,
	 *   current: TransformGeometry | null,
	 *   pointerAngle: number,
	 *   rotationTurn: number,
	 *   capture: HTMLElement | null,
	 *   companions: { id: string, start: TransformGeometry }[]
	 * }} TransformGesture
	 */

	/** @type {{
	 *   images: import('#lib/presentations/rendering/renderSlide.js').PresentationImageSources,
	 *   session: import('#lib/presentations/editor/textEditSession.svelte.js').TextEditSession
	 * }} */
	let { images, session } = $props();
	const { doc, selection, viewport: view, interaction } = getSlideEditor();

	/** @type {HTMLDivElement | null} */
	let hostEl = null;
	/** @type {Konva.Stage | null} */
	let stage = null;
	/** @type {Konva.Layer | null} */
	let layer = null;
	/** @type {PanGesture | null} */
	let panGesture = null;
	/**
	 * A selection box being drawn from empty canvas, in host pixels.
	 * @type {{ pointerId: number, origin: { x: number, y: number }, additive: boolean, base: string[], capture: HTMLElement | null } | null}
	 */
	let marqueeGesture = null;
	/** @type {{ x: number, y: number, width: number, height: number } | null} */
	let marquee = $state.raw(null);
	/** @type {TransformGesture | null} */
	let transformGesture = null;
	/** The group a live preview was applied to, so it can be put back on cancel. @type {string | null} */
	let previewedNodeId = null;
	let wasEditing = false;
	/** Set while the click that ends a transform gesture is still on its way. */
	let ignoreTrailingClick = false;

	let ready = $state(false);
	let size = $state.raw({ width: 0, height: 0 });
	let renderError = $state(false);
	let panning = $state(false);
	/** Space held over the editor turns a drag into a pan, as in PowerPoint. */
	let spaceHeld = $state(false);

	const editorState = $derived(doc.snapshot());
	const presentation = $derived(editorState.document);
	const activeSlide = $derived(
		presentation?.slides.find((slide) => slide.id === selection.activeSlideId) ??
			presentation?.slides[0]
	);
	const selectedElementId = $derived(selection.ids[0] ?? null);
	/**
	 * Prompts for empty text boxes, drawn by the editor over the canvas only: they
	 * are never part of the document, the thumbnails or an export.
	 */
	const placeholders = $derived(
		(activeSlide?.elements ?? []).flatMap((element) => {
			if (element.kind !== 'text' || !element.visible || element.id === selection.editingId)
				return [];
			const empty = element.paragraphs.every((paragraph) =>
				paragraph.runs.every((run) => run.text.trim() === '')
			);
			if (!empty) return [];
			const size = element.paragraphs[0]?.runs[0]?.size ?? 28;
			return [
				{
					id: element.id,
					box: elementGeometry(element, null),
					padding: element.padding,
					size: Math.min(size, 44),
					label: size >= 40 ? 'Click to add title' : 'Click to add text'
				}
			];
		})
	);
	const selectedElement = $derived(
		activeSlide?.elements.find((element) => element.id === selectedElementId)
	);
	const editingElementId = $derived(selection.editingId);
	const editingElement = $derived(
		activeSlide?.elements.find((element) => element.id === editingElementId)
	);
	// The two view numbers are read through their own deriveds: a selection change
	// replaces the store object, and an effect reading `editorState` directly would
	// re-render the layer for it, destroying the hit graph mid-click.
	const viewZoom = $derived(view.zoom);
	const viewPan = $derived(view.pan);
	const viewport = $derived(
		presentationViewport(
			size,
			presentation?.pageSize ?? { width: 0, height: 0 },
			view.zoom,
			view.pan
		)
	);
	// While a gesture runs, the frame and its handles describe the previewed
	// geometry; the document only changes when the gesture is committed.
	const selectedGeometry = $derived(
		selectedElement ? elementGeometry(selectedElement, interaction.preview ?? null) : null
	);

	// The stage's size, scale and position follow the viewport alone, so panning and
	// zooming never rebuild the painted children.
	$effect(() => {
		const konvaStage = stage;
		const doc = presentation;
		const canvasSize = size;
		const zoom = viewZoom;
		const pan = viewPan;
		if (!konvaStage || !doc) return;
		const currentViewport = presentationViewport(canvasSize, doc.pageSize, zoom, pan);
		konvaStage.size({
			width: Math.max(1, canvasSize.width),
			height: Math.max(1, canvasSize.height)
		});
		konvaStage.scale({ x: currentViewport.scale, y: currentViewport.scale });
		konvaStage.position({ x: currentViewport.x, y: currentViewport.y });
		konvaStage.batchDraw();
	});

	// The painted slide is rebuilt only when the document, the visible slide, the
	// decoded images or the edited element change. The source's React effect had
	// the same dependency list, and keeping it that narrow is what lets a click
	// that follows a selection still hit the element it pressed.
	$effect(() => {
		const konvaLayer = layer;
		const doc = presentation;
		const slide = activeSlide;
		const editingId = editingElementId;
		// The stage and its layer belong to the attachment; `ready` flips with them,
		// so reading it repaints as soon as the canvas exists.
		const mounted = ready;
		if (!mounted || !konvaLayer || !doc || !slide) return;
		konvaLayer.destroyChildren();
		try {
			const page = renderSlide({ slide, pageSize: doc.pageSize, images, listening: true });
			if (editingId) {
				// The DOM overlay draws the text being edited; hide the canvas copy.
				for (const child of page.getChildren()) {
					if (child.id() === editingId) {
						child.visible(false);
						break;
					}
				}
			}
			konvaLayer.add(page);
			renderError = false;
		} catch {
			// A missing decoded asset must not unmount the whole editor: the
			// preview reports the problem and the rest keeps working.
			renderError = true;
		}
		konvaLayer.batchDraw();
	});

	// Live gesture feedback on the rendering layer only: the group follows the
	// pointer, and the committed document redraws it at its real geometry. A
	// cancelled gesture puts the node back where the document says it is.
	$effect(() => {
		const konvaLayer = layer;
		const preview = interaction.preview;
		const id = preview?.elementId ?? previewedNodeId;
		if (!konvaLayer || !id) return;
		const element = activeSlide?.elements.find((candidate) => candidate.id === id);
		const node = /** @type {Konva.Group | undefined} */ (konvaLayer.findOne(`#${id}`));
		if (element && node) {
			const geometry = elementGeometry(element, preview ?? null);
			if (element.kind === 'text') {
				// A text box resize changes wrapping space, never glyph size. Replace only
				// this group when its painted dimensions differ, using the same renderer
				// as the committed slide. Moving/rotating keeps the existing glyphs.
				const hitArea = /** @type {Konva.Rect | undefined} */ (node.getChildren()[0]);
				if (hitArea?.width() !== geometry.width || hitArea.height() !== geometry.height) {
					const parent = node.getParent();
					const index = node.zIndex();
					const replacement = renderText({ ...element, ...geometry }, true);
					node.destroy();
					parent?.add(replacement);
					replacement.zIndex(index);
					konvaLayer.batchDraw();
				} else {
					node.position({ x: geometry.x, y: geometry.y });
					node.rotation(geometry.rotation);
					konvaLayer.batchDraw();
				}
			} else {
				node.setAttrs({
					x: geometry.x,
					y: geometry.y,
					rotation: geometry.rotation,
					// Shapes and images track the pointer by scaling their group until
					// the document redraws them at their committed dimensions.
					scaleX: geometry.width / element.width,
					scaleY: geometry.height / element.height
				});
				konvaLayer.batchDraw();
			}
		}
		previewedNodeId = preview?.elementId ?? null;
	});

	// Keep focus in the editor when the text overlay closes, but never steal it.
	$effect(() => {
		const editingId = selection.editingId;
		if (editingId) {
			wasEditing = true;
			return;
		}
		if (!wasEditing || !hostEl) return;
		wasEditing = false;
		const active = window.document.activeElement;
		if (active === null || active === window.document.body) hostEl.focus();
	});

	/**
	 * One pointer position in document units, through the shared viewport mapping.
	 * @param {number} clientX
	 * @param {number} clientY
	 */
	function pointFromClient(clientX, clientY) {
		if (!hostEl) return null;
		const rect = hostEl.getBoundingClientRect();
		const current = doc.snapshot();
		const pageSize = current.document?.pageSize ?? { width: 0, height: 0 };
		const currentViewport = presentationViewport(
			size,
			pageSize,
			current.view.zoom,
			current.view.pan
		);
		return documentPointFromView(
			{ x: clientX - rect.left, y: clientY - rect.top },
			currentViewport
		);
	}

	/**
	 * The visible element under the pointer, or null over the slide background.
	 * @param {number} clientX
	 * @param {number} clientY
	 */
	function elementAtPointer(clientX, clientY) {
		const current = doc.snapshot();
		const slide =
			current.document?.slides.find((item) => item.id === current.view.activeSlideId) ??
			current.document?.slides[0];
		if (!stage || !hostEl || !slide) return null;
		const rect = hostEl.getBoundingClientRect();
		const hit = stage.getIntersection({ x: clientX - rect.left, y: clientY - rect.top });
		if (!hit) return null;
		const group = /** @type {Konva.Group | undefined} */ (
			hit.findAncestor('.presentation-element', true)
		);
		const id = group?.id();
		return id ? (slide.elements.find((element) => element.id === id) ?? null) : null;
	}

	/** @returns {HTMLElement | null} */
	function captureTarget() {
		return /** @type {HTMLElement | null} */ (hostEl?.querySelector('.konvajs-content') ?? hostEl);
	}

	/**
	 * @param {Element} element
	 * @param {TransformGesture['kind']} kind
	 * @param {ResizeHandle | null} handle
	 * @param {PointerEvent} event
	 */
	function beginTransform(element, kind, handle, event) {
		const origin = pointFromClient(event.clientX, event.clientY);
		if (!origin) return;
		const start = elementGeometry(element, null);
		// Capture on the Konva container for every transform gesture, so move/up
		// arrive through the same host handlers as panning.
		const capture = captureTarget();
		transformGesture = {
			kind,
			pointerId: event.pointerId,
			elementId: element.id,
			handle,
			origin,
			start,
			current: null,
			// Rotation measures the pointer angle around the element's visual centre.
			pointerAngle: kind === 'rotate' ? rotationFromPoint(elementWorldCenter(start), origin) : 0,
			rotationTurn: 0,
			capture,
			// Moving one element of a multi-selection carries the other unlocked ones.
			companions:
				kind === 'move' && selection.ids.length > 1 && selection.ids.includes(element.id)
					? selection.elements
							.filter((other) => other.id !== element.id && !other.locked)
							.map((other) => ({ id: other.id, start: elementGeometry(other, null) }))
					: []
		};
		try {
			capture?.setPointerCapture(event.pointerId);
		} catch {
			// Window-level pointer events still reach the host.
		}
	}

	/**
	 * The candidate geometry for one pointer position. Move and resize measure
	 * from the gesture's start; rotation walks the pointer angle step by step,
	 * updating the gesture, so a continuous turn accumulates instead of jumping at
	 * the ±180° branch cut.
	 *
	 * @param {TransformGesture} gesture
	 * @param {ViewPoint} point
	 */
	function previewGeometry(gesture, point) {
		if (gesture.kind === 'move')
			return moveTransform(gesture.start, {
				x: point.x - gesture.origin.x,
				y: point.y - gesture.origin.y
			});
		if (gesture.kind === 'resize')
			return resizeTransform(gesture.start, /** @type {ResizeHandle} */ (gesture.handle), point);
		const step = nextRotationStep(
			gesture.pointerAngle,
			rotationFromPoint(elementWorldCenter(gesture.start), point),
			gesture.rotationTurn
		);
		gesture.pointerAngle = step.angle;
		gesture.rotationTurn = step.accumulated;
		return rotateTransform(gesture.start, step.accumulated);
	}

	/**
	 * Applies pointer movement to the live gesture; returns whether one is running.
	 * @param {PointerEvent} event
	 */
	function applyGestureMove(event) {
		const gesture = transformGesture;
		if (!gesture || gesture.pointerId !== event.pointerId) return false;
		// A mouse drag whose button was released outside the window must not keep
		// transforming on plain hover movement.
		if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
			endTransform(event.pointerId, false);
			return true;
		}
		const point = pointFromClient(event.clientX, event.clientY);
		if (!point) return true;
		let current = previewGeometry(gesture, point);
		/** @type {AlignmentGuide[]} */
		let nextGuides = [];
		// Move gestures snap to other visible elements and the page axes, and show
		// the matched lines. Resize and rotate keep exact pointer geometry.
		const state = doc.snapshot();
		const slide =
			state.document?.slides.find((item) => item.id === state.view.activeSlideId) ??
			state.document?.slides[0];
		if (gesture.kind === 'move' && slide && state.document) {
			const others = slide.elements
				.filter((element) => element.id !== gesture.elementId && element.visible)
				.map((element) => elementGeometry(element, null));
			// Keep the magnetic distance roughly constant on screen at any zoom.
			const scale = presentationViewport(
				size,
				state.document.pageSize,
				state.view.zoom,
				state.view.pan
			).scale;
			const snapped = snapToAlignment(current, others, state.document.pageSize, 8 / scale);
			current = { ...current, x: snapped.x, y: snapped.y };
			nextGuides = snapped.guides;
		}
		gesture.current = current;
		moveCompanions(gesture, current);
		state.setTransformPreview({ elementId: gesture.elementId, ...current });
		state.setGuides(nextGuides);
		return true;
	}

	/**
	 * Shows the rest of a multi-selection following the dragged element, on the
	 * rendering layer only; the document changes once, when the gesture commits.
	 * @param {TransformGesture} gesture
	 * @param {TransformGeometry | null} current
	 */
	function moveCompanions(gesture, current) {
		if (!layer || gesture.companions.length === 0) return;
		const dx = current ? current.x - gesture.start.x : 0;
		const dy = current ? current.y - gesture.start.y : 0;
		for (const companion of gesture.companions) {
			layer
				.findOne(`#${companion.id}`)
				?.position({ x: companion.start.x + dx, y: companion.start.y + dy });
		}
		layer.batchDraw();
	}

	/**
	 * Drops the compatibility click that closes this pointer gesture. Konva
	 * reports its click from the `mouseup`/`touchend` event, which the browser
	 * dispatches after this component's `pointerup`; by then the layer may be
	 * mid-repaint, so the click's hit test can answer "the background" and clear
	 * the selection the pointerdown just made. The pointerdown already selected
	 * the element, so the trailing click is the end of a gesture, not a click on
	 * empty canvas.
	 */
	function dropTrailingClick() {
		ignoreTrailingClick = true;
		setTimeout(() => (ignoreTrailingClick = false), 0);
	}

	/** @param {number} pointerId @param {boolean} commit */
	function endTransform(pointerId, commit) {
		const gesture = transformGesture;
		if (gesture?.pointerId !== pointerId) return;
		transformGesture = null;
		dropTrailingClick();
		if (gesture.capture?.hasPointerCapture(pointerId)) {
			try {
				gesture.capture.releasePointerCapture(pointerId);
			} catch {
				// Pointer capture already ended.
			}
		}
		// A click without movement on one element of a multi-selection selects just it.
		if (!gesture.current && selection.ids.length > 1) selection.select([gesture.elementId]);
		const state = doc.snapshot();
		// A click without movement leaves no undo entry and no revision behind.
		if (commit && gesture.current && gesture.companions.length > 0) {
			const { current } = gesture;
			const dx = current.x - gesture.start.x;
			const dy = current.y - gesture.start.y;
			state.commitTransforms({
				[gesture.elementId]: current,
				...Object.fromEntries(
					gesture.companions.map((companion) => [
						companion.id,
						{ ...companion.start, x: companion.start.x + dx, y: companion.start.y + dy }
					])
				)
			});
		} else if (commit && gesture.current) state.commitTransform(gesture.elementId, gesture.current);
		else if (gesture.current) {
			moveCompanions(gesture, null);
			state.setTransformPreview(null);
		}
		state.setGuides([]);
	}

	/** @param {number} pointerId */
	function endPan(pointerId) {
		const gesture = panGesture;
		if (gesture?.pointerId !== pointerId) return;
		panGesture = null;
		panning = false;
		if (gesture.capture?.hasPointerCapture(pointerId)) {
			try {
				gesture.capture.releasePointerCapture(pointerId);
			} catch {
				// Pointer capture already ended.
			}
		}
	}

	/** @param {PointerEvent} event */
	function handlePointerDown(event) {
		// Space+drag or a middle-button drag pans; a plain drag never moves the view.
		if (event.button === 1 || (event.button === 0 && spaceHeld)) {
			event.preventDefault();
			startPan(event);
			return;
		}
		if (event.button !== 0) return;
		const element = elementAtPointer(event.clientX, event.clientY);
		const additive = event.shiftKey || event.ctrlKey || event.metaKey;
		if (element && additive) {
			// Shift/Ctrl-click adds or removes one element, as in PowerPoint.
			hostEl?.focus();
			selection.toggle(element.id, true);
			dropTrailingClick();
			return;
		}
		if (element) {
			hostEl?.focus();
			// Pressing on an element of a multi-selection keeps the selection so the
			// gesture can move it; a click without movement narrows it afterwards.
			if (!selection.ids.includes(element.id)) selection.select([element.id]);
			// A locked element stays selectable so its properties are reachable,
			// but no gesture may move, resize, or rotate it.
			if (!element.locked) beginTransform(element, 'move', null, event);
			return;
		}
		if (!hostEl) return;
		const rect = hostEl.getBoundingClientRect();
		const capture = captureTarget();
		marqueeGesture = {
			pointerId: event.pointerId,
			origin: { x: event.clientX - rect.left, y: event.clientY - rect.top },
			additive,
			base: additive ? [...selection.ids] : [],
			capture
		};
		try {
			capture?.setPointerCapture(event.pointerId);
		} catch {
			// Window-level pointer events still reach the host.
		}
	}

	/** @param {PointerEvent} event */
	function startPan(event) {
		// Capture on the Konva container so move/up arrive through the host handlers.
		const capture = captureTarget();
		panGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, capture };
		panning = true;
		try {
			capture?.setPointerCapture(event.pointerId);
		} catch {
			// Window-level pointer events still update the view.
		}
	}

	/** @param {PointerEvent} event */
	function handlePointerMove(event) {
		if (applyGestureMove(event)) return;
		if (marqueeGesture && marqueeGesture.pointerId === event.pointerId && hostEl) {
			const rect = hostEl.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			const { origin } = marqueeGesture;
			marquee = {
				x: Math.min(origin.x, x),
				y: Math.min(origin.y, y),
				width: Math.abs(x - origin.x),
				height: Math.abs(y - origin.y)
			};
			return;
		}
		const gesture = panGesture;
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		// A mouse drag whose button was released outside the window must not keep
		// panning on plain hover movement.
		if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
			endPan(event.pointerId);
			return;
		}
		const dx = event.clientX - gesture.x;
		const dy = event.clientY - gesture.y;
		gesture.x = event.clientX;
		gesture.y = event.clientY;
		const state = doc.snapshot();
		const pageSize = state.document?.pageSize ?? { width: 0, height: 0 };
		state.setPan(
			clampPresentationPan(size, pageSize, state.view.zoom, {
				x: state.view.pan.x + dx,
				y: state.view.pan.y + dy
			})
		);
	}

	/** @param {WheelEvent} event */
	function handleWheel(event) {
		if (event.deltaY === 0) return;
		event.preventDefault();
		const current = view.zoom;
		// Wheel events vary from tiny trackpad pixels to full mouse notches. Scale
		// with their magnitude instead of applying 10% for every event.
		const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1);
		const step = Math.max(-120, Math.min(120, pixels));
		view.setZoom(clampPresentationZoom(current * Math.exp(-step * 0.0008)));
	}

	/** @type {import('svelte/attachments').Attachment<HTMLDivElement>} */
	const mountCanvas = (node) => {
		hostEl = node;
		const konvaStage = new Konva.Stage({
			container: node,
			width: Math.max(1, node.clientWidth),
			height: Math.max(1, node.clientHeight)
		});
		const konvaLayer = new Konva.Layer();
		konvaStage.add(konvaLayer);
		stage = konvaStage;
		layer = konvaLayer;
		ready = true;

		const resize = () => {
			size = { width: node.clientWidth, height: node.clientHeight };
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(node);

		const elementIdFor = (/** @type {Konva.Node} */ target) => {
			if (target === konvaStage) return null;
			return (
				/** @type {Konva.Group | undefined} */ (
					target.findAncestor('.presentation-element', true)
				)?.id() || null
			);
		};
		const select = (/** @type {any} */ event) => {
			// A click that only ends a transform gesture is not a click on the
			// background: see `ignoreTrailingClick`.
			if (ignoreTrailingClick) return;
			if (event.evt?.shiftKey || event.evt?.ctrlKey || event.evt?.metaKey) return;
			const id = elementIdFor(event.target);
			selection.select(id ? [id] : []);
		};
		const edit = (/** @type {any} */ event) => {
			const id = elementIdFor(event.target);
			if (id) selection.startTextEdit(id);
		};
		konvaStage.on('click tap', select);
		konvaStage.on('dblclick dbltap', edit);

		// Space is a pan modifier only outside fields, buttons and dialogs, where it
		// keeps its own meaning.
		const spaceExempt =
			'input, textarea, select, button, a, [contenteditable="true"], [role="slider"], dialog, [role="dialog"]';
		const onKeyDown = (/** @type {KeyboardEvent} */ event) => {
			if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
			if (event.target instanceof HTMLElement && event.target.closest(spaceExempt)) return;
			event.preventDefault();
			spaceHeld = true;
		};
		const onKeyUp = (/** @type {KeyboardEvent} */ event) => {
			if (event.code === 'Space') spaceHeld = false;
		};
		const onBlur = () => (spaceHeld = false);
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener('blur', onBlur);
		// Tab and Shift+Tab walk the slide's elements while the canvas has focus;
		// everywhere else Tab keeps moving focus between controls.
		const onCanvasKeyDown = (/** @type {KeyboardEvent} */ event) => {
			if (event.key !== 'Tab' || event.target !== node || event.ctrlKey || event.altKey) return;
			const elements = (activeSlide?.elements ?? []).filter((element) => element.visible);
			if (elements.length === 0) return;
			event.preventDefault();
			const current = elements.findIndex((element) => element.id === selection.ids[0]);
			const step = event.shiftKey ? -1 : 1;
			const next =
				current === -1
					? event.shiftKey
						? elements.length - 1
						: 0
					: (current + step + elements.length) % elements.length;
			selection.select([elements[next].id]);
		};
		node.addEventListener('keydown', onCanvasKeyDown);
		node.addEventListener('wheel', handleWheel, { passive: false });
		node.addEventListener('pointerdown', handlePointerDown);
		node.addEventListener('pointermove', handlePointerMove);
		node.addEventListener('pointerup', handlePointerUp);
		node.addEventListener('pointercancel', handlePointerCancel);

		return () => {
			observer.disconnect();
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', onBlur);
			node.removeEventListener('keydown', onCanvasKeyDown);
			node.removeEventListener('wheel', handleWheel);
			node.removeEventListener('pointerdown', handlePointerDown);
			node.removeEventListener('pointermove', handlePointerMove);
			node.removeEventListener('pointerup', handlePointerUp);
			node.removeEventListener('pointercancel', handlePointerCancel);
			konvaStage.destroy();
			stage = null;
			layer = null;
			hostEl = null;
			ready = false;
		};
	};

	/**
	 * Ends a selection box: every visible element whose box lies fully inside it
	 * is selected (added to the earlier selection when Shift/Ctrl was held). A
	 * press without a real drag is left to the click handler, which clears.
	 * @param {number} pointerId
	 * @param {boolean} commit
	 */
	function endMarquee(pointerId, commit) {
		const gesture = marqueeGesture;
		if (gesture?.pointerId !== pointerId) return;
		marqueeGesture = null;
		const box = marquee;
		marquee = null;
		try {
			gesture.capture?.releasePointerCapture(pointerId);
		} catch {
			// Pointer capture already ended.
		}
		const dragged = box !== null && (box.width > 4 || box.height > 4);
		if (gesture.additive || dragged) dropTrailingClick();
		if (!commit || !dragged || !box || !presentation || !activeSlide) return;
		const from = documentPointFromView({ x: box.x, y: box.y }, viewport);
		const to = documentPointFromView({ x: box.x + box.width, y: box.y + box.height }, viewport);
		const inside = activeSlide.elements
			.filter((element) => element.visible)
			.filter(
				(element) =>
					element.x >= from.x &&
					element.y >= from.y &&
					element.x + element.width <= to.x &&
					element.y + element.height <= to.y
			)
			.map((element) => element.id);
		selection.select([...new Set([...gesture.base, ...inside])]);
	}

	/** @param {PointerEvent} event */
	function handlePointerUp(event) {
		endMarquee(event.pointerId, true);
		endTransform(event.pointerId, true);
		endPan(event.pointerId);
	}

	/** @param {PointerEvent} event */
	function handlePointerCancel(event) {
		endMarquee(event.pointerId, false);
		endTransform(event.pointerId, false);
		endPan(event.pointerId);
	}
</script>

{#if presentation && activeSlide}
	<section class="presentation-canvas-panel" aria-label="Slide canvas">
		<div
			class="presentation-canvas [position:absolute] [inset:0] [cursor:default] [touch-action:none]"
			class:is-panning={panning}
			class:is-space-pan={spaceHeld}
			data-ready={ready}
			data-testid="presentation-canvas"
			data-document-width={presentation.pageSize.width}
			data-document-height={presentation.pageSize.height}
			data-view-zoom={view.zoom}
			data-view-pan-x={view.pan.x}
			data-view-pan-y={view.pan.y}
			data-selected-element={selectedElementId ?? ''}
			data-selected-count={selection.ids.length}
			data-editing-element={selection.editingId ?? ''}
			tabindex="-1"
			{@attach mountCanvas}
		></div>
		{#each placeholders as item (item.id)}
			<div
				class="text-placeholder"
				aria-hidden="true"
				style:left="{viewport.x + item.box.x * viewport.scale}px"
				style:top="{viewport.y + item.box.y * viewport.scale}px"
				style:width="{item.box.width * viewport.scale}px"
				style:height="{item.box.height * viewport.scale}px"
				style:transform="rotate({item.box.rotation}deg)"
				style:padding="{item.padding * viewport.scale}px"
				style:font-size="{item.size * viewport.scale}px"
			>
				{item.label}
			</div>
		{/each}
		{#if marquee}<div
				class="selection-marquee"
				data-testid="selection-marquee"
				style:left="{marquee.x}px"
				style:top="{marquee.y}px"
				style:width="{marquee.width}px"
				style:height="{marquee.height}px"
			></div>{/if}
		{#if selection.ids.length > 1}
			{#each selection.elements as element (element.id)}
				{@const box = elementGeometry(element, null)}
				<div
					class="multi-outline"
					style:left="{viewport.x + box.x * viewport.scale}px"
					style:top="{viewport.y + box.y * viewport.scale}px"
					style:width="{box.width * viewport.scale}px"
					style:height="{box.height * viewport.scale}px"
					style:transform="rotate({box.rotation}deg)"
				></div>
			{/each}
		{:else if selectedElement && selectedGeometry && !editingElement}
			<PresentationSelectionFrame
				geometry={selectedGeometry}
				{viewport}
				locked={selectedElement.locked}
				ongesturestart={(kind, handle, event) => {
					// The handle gesture must not also start a pan or a move on the host.
					event.preventDefault();
					event.stopPropagation();
					beginTransform(selectedElement, kind, handle, event);
				}}
			/>
		{/if}
		{#if editingElement?.kind === 'text'}
			<TextEditOverlay
				element={editingElement}
				scale={viewport.scale}
				offsetX={viewport.x}
				offsetY={viewport.y}
				theme={presentation.theme}
				{session}
			/>
		{/if}
		{#if renderError}<p class="presentation-canvas-error" role="alert">
				Some artwork on this slide could not be drawn. Your saved presentation is unchanged.
			</p>{/if}
		{#if activeSlide.elements.length === 0 && !renderError}<p
				class="presentation-blank-slide"
				aria-hidden="true"
			>
				Blank slide
			</p>{/if}
		{#each interaction.guides as guide, index (`${guide.axis}-${guide.position}-${index}`)}
			<div
				class="presentation-guide is-{guide.axis}"
				data-testid="presentation-guide-{guide.axis}"
				aria-hidden="true"
				style:left={guide.axis === 'x'
					? `${viewport.x + guide.position * viewport.scale}px`
					: undefined}
				style:top={guide.axis === 'y'
					? `${viewport.y + guide.position * viewport.scale}px`
					: undefined}
				style:height={guide.axis === 'x'
					? `${presentation.pageSize.height * viewport.scale}px`
					: undefined}
				style:width={guide.axis === 'y'
					? `${presentation.pageSize.width * viewport.scale}px`
					: undefined}
			></div>
		{/each}
	</section>
{/if}

<style>
	/* Migrated from the former global layout stylesheet; scoped to this owner. */
	.empty {
		display: flex;
		min-height: 208px;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-5);
		border: 1px dashed oklch(0.833566 0.047737 168.8711);
		border-radius: var(--radius);
		background: radial-gradient(
			ellipse at bottom,
			oklch(0.966239 0.018933 157.8754),
			oklch(1 0 none) 75%
		);
		color: oklch(0.535034 0.054407 249.7873);
		text-align: center;
	}
	:global(.empty h2) {
		color: var(--ink);
	}
	:global(.empty p) {
		max-width: 480px;
		font-size: 14px;
	}
	:global(.empty > svg) {
		padding: 12px;
		width: 56px;
		height: 56px;
		border-radius: 18px;
		background: var(--pale);
		color: oklch(0.551582 0.11869 163.307);
		transform: rotate(-8deg);
	}
	.empty {
		min-height: 250px;
		margin-block-start: 20px;
	}
	.presentation-guide {
		position: absolute;
		z-index: 3;
		background: var(--icon-purple);
		box-shadow: 0 0 0 1px color-mix(in oklch, oklch(1 0 none) 66.6667%, transparent);
		pointer-events: none;
	}
	.presentation-guide.is-x {
		width: 1px;
	}
	.presentation-guide.is-y {
		height: 1px;
	}
	.presentation-canvas-panel {
		position: relative;
		min-width: 0;
		min-height: 0;
		overflow: clip;
		background: oklch(0.923614 0.009985 181.3932);
	}
	.presentation-canvas-error {
		position: absolute;
		z-index: 2;
		inset-block-start: auto;
		inset-block-end: var(--space-7);
		inset-inline-start: var(--space-4);
		inset-inline-end: var(--space-4);
		margin: 0;
		padding-block-start: var(--space-3);
		padding-block-end: var(--space-3);
		padding-inline-start: var(--space-4);
		padding-inline-end: var(--space-4);
		border: 1px solid var(--warning-line);
		border-radius: var(--radius-sm);
		background: var(--warning-bg);
		color: var(--warning-ink);
		font-size: 12px;
		font-weight: 600;
	}
	.text-placeholder {
		position: absolute;
		z-index: 1;
		display: flex;
		align-items: center;
		overflow: hidden;
		border: 1px dashed oklch(0.75 0.01 264);
		color: oklch(0.6 0.01 264);
		line-height: 1.2;
		transform-origin: top left;
		white-space: nowrap;
		pointer-events: none;
	}
	.selection-marquee {
		position: absolute;
		z-index: 3;
		border: 1px solid var(--primary);
		background: color-mix(in oklch, var(--primary) 10%, transparent);
		pointer-events: none;
	}
	.multi-outline {
		position: absolute;
		z-index: 2;
		outline: 1.5px solid var(--primary);
		transform-origin: top left;
		pointer-events: none;
	}
	.presentation-canvas.is-space-pan {
		cursor: grab;
	}
	.presentation-canvas.is-panning {
		cursor: grabbing;
	}
	:global(.presentation-canvas canvas) {
		filter: drop-shadow(
			0 12px 28px color-mix(in oklch, oklch(0.201186 0.055198 262.3998) 16.8627%, transparent)
		);
	}
	.presentation-blank-slide {
		position: absolute;
		z-index: 1;
		inset-block-start: 50%;
		inset-block-end: auto;
		inset-inline-start: 50%;
		inset-inline-end: auto;
		margin: 0;
		color: oklch(0.723315 0.027523 253.6235);
		font-size: 12px;
		pointer-events: none;
		transform: translate(-50%, -50%);
	}
	@media (max-width: 720px) {
		.presentation-canvas-panel {
			min-height: min(62dvh, 560px);
			height: 100%;
		}
	}
</style>
