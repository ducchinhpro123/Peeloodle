import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ChangeEvent, type MutableRefObject } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Copy, Download, Eye, EyeOff, Lock, Trash2, Unlock, Upload } from 'lucide-react'
import { useRepository } from '../../app/repository'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  NoticeDialog,
  Slider,
  Tabs,
} from '../../components/ui'
import { isPersistenceError, serializeProjectDocument, type AssetRecord, type StickerLabRepository } from '../../lib/persistence/repository'
import { ingestImageFile, AssetObjectUrlCache } from '../assets/assetLoader'
import { UploadValidationError } from '../assets/validateUpload'
import { downloadBlob, renderDocument, type ExportSize } from '../exports/renderDocument'
import type { Layer, ProjectDocument } from '../../types/domain'
import { saveStatusLabel, TEXT_FONTS, useEditorStore } from './store'

const KonvaCanvas = lazy(() => import('./KonvaCanvas'))

const deferredTools = [
  ['Background Eraser', 'Automatic background removal is not available. Manual erase arrives in a later milestone.'],
  ['Brush / Restore', 'Mask erase and restore arrives in a later milestone.'],
  ['Outline & Border', 'Silhouette outlines arrive in a later milestone.'],
  ['Emoji & Stickers', 'Curated emoji and sticker decorations arrive in a later milestone.'],
  ['Filters & Effects', 'Image filters arrive in a later milestone.'],
] as const

function takeCreateDraftId(): string {
  const current = useEditorStore.getState().document
  // ponytail: reuse an empty revision-0 draft so StrictMode's double effect does not mint a second id.
  if (current && current.revision === 0 && current.layers.length === 0) return current.id
  return useEditorStore.getState().createDraft()
}

export function CreateEditor() {
  const navigate = useNavigate()
  const repo = useRepository()
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const current = useEditorStore.getState()
      const existing = current.document
      if (existing && current.dirty) {
        await persistDocument(repo, 'manual')
        if (cancelled) return
        const after = useEditorStore.getState()
        if (after.document?.id === existing.id && after.dirty) {
          navigate(`/editor/${existing.id}`, { replace: true })
          return
        }
      }
      if (cancelled) return
      navigate(`/editor/${takeCreateDraftId()}`, { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [navigate, repo])
  return <p className="muted" style={{ padding: 24 }}>Opening sticker…</p>
}

export function ProjectEditor() {
  const { projectId } = useParams()
  return <EditorWorkspace projectId={projectId} />
}

function EditorWorkspace({ projectId }: { projectId?: string }) {
  const repo = useRepository()
  const navigate = useNavigate()
  const document = useEditorStore((state) => state.document)
  const assets = useEditorStore((state) => state.assets)
  const loadError = useEditorStore((state) => state.loadError)
  const loading = useEditorStore((state) => state.loading)
  const urls = useAssetUrls(assets)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    const flush = () => {
      const snap = useEditorStore.getState()
      if (snap.document?.id === projectId && (snap.dirty || snap.gestureActive)) {
        void persistDocument(repo, 'manual').catch(() => undefined)
      }
    }
    const current = useEditorStore.getState()
    if (current.document?.id === projectId) {
      if (current.loading) useEditorStore.getState().setLoading(false)
      return flush
    }
    void (async () => {
      const previous = useEditorStore.getState()
      if (previous.document && previous.dirty) {
        await persistDocument(repo, 'manual')
        if (cancelled) return
        const after = useEditorStore.getState()
        if (after.document?.id === previous.document.id && after.dirty) {
          after.setSaveStatus('save-failed', after.saveError ?? 'Save failed')
          navigate(`/editor/${previous.document.id}`, { replace: true })
          return
        }
      }
      if (cancelled) return
      useEditorStore.getState().setLoading(true)
      try {
        const loaded = await repo.getProject(projectId)
        const records = await Promise.all(loaded.assetIds.map((id) => repo.getAsset(id)))
        if (cancelled) return
        useEditorStore.getState().hydrate(loaded, records)
      } catch (error) {
        if (cancelled) return
        const message = isPersistenceError(error)
          ? error.code === 'not_found'
            ? 'This sticker was not found locally.'
            : error.message
          : 'This sticker could not be opened.'
        useEditorStore.getState().setLoadError(message)
      }
    })()
    return () => {
      cancelled = true
      flush()
    }
  }, [projectId, repo, navigate])

  useAutosave(repo)
  useEditorShortcuts()

  if (loadError && document?.id !== projectId) {
    return (
      <section className="empty" style={{ marginTop: 24 }}>
        <h1>Sticker not found</h1>
        <p>{loadError}</p>
        <Link className="button primary" to="/create">Create a sticker</Link>
      </section>
    )
  }

  if (!document || loading || (projectId && document.id !== projectId)) {
    return <p className="muted" style={{ padding: 24 }}>Opening sticker…</p>
  }

  return <EditorChrome document={document} urls={urls} />
}

function EditorChrome({ document, urls }: { document: ProjectDocument; urls: Record<string, string> }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [inspectorTab, setInspectorTab] = useState('adjust')
  const saveStatus = useEditorStore((state) => state.saveStatus)
  const saveError = useEditorStore((state) => state.saveError)
  const dirty = useEditorStore((state) => state.dirty)
  const uploadError = useEditorStore((state) => state.uploadError)
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId)
  const activeTool = useEditorStore((state) => state.activeTool)
  const viewport = useEditorStore((state) => state.viewport)
  const past = useEditorStore((state) => state.past)
  const future = useEditorStore((state) => state.future)
  const repo = useRepository()
  const selected = document.layers.find((layer) => layer.id === selectedLayerId)

  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    void ingestIntoCurrentProject(() => ingestImageFile(file))
  }

  const saveNow = () => {
    void persistDocument(repo, 'manual')
  }

  return (
    <>
      <section className="editor-top">
        <div>
          <h1>
            <input
              className="title-input"
              aria-label="Sticker title"
              value={document.title}
              onFocus={() => useEditorStore.getState().beginGesture()}
              onChange={(event) => useEditorStore.getState().updateTitle(event.target.value)}
              onBlur={() => useEditorStore.getState().commitGesture()}
            />
          </h1>
          <small className="save-status" data-state={saveStatus} role="status">
            {saveStatusLabel(saveStatus, dirty)}
            {saveStatus === 'save-failed' && saveError ? ` — ${saveError}` : ''}
          </small>
        </div>
        <div className="editor-actions">
          <Button className="primary" onClick={saveNow} aria-label="Save to My Stickers">
            <Upload />Save to My Stickers
          </Button>
          <ExportDialog document={document} />
        </div>
      </section>
      <div className="editor">
        <aside className="tool-rail">
          <b>Tools</b>
          <span className="tool-note">Upload a photo, then move, resize, rotate, and add text. Other tools are listed with honest availability.</span>
          {deferredTools.slice(0, 1).map(([label, detail]) => (
            <NoticeDialog key={label} title={`${label} is not available`} trigger={<button type="button">{label}</button>}>
              {detail}
            </NoticeDialog>
          ))}
          <button
            type="button"
            aria-pressed={activeTool === 'rotate'}
            onClick={() => {
              useEditorStore.getState().setTool('rotate')
              setInspectorTab('adjust')
            }}
          >
            Crop &amp; Rotate
          </button>
          {deferredTools.slice(1, 3).map(([label, detail]) => (
            <NoticeDialog key={label} title={`${label} is not available`} trigger={<button type="button">{label}</button>}>
              {detail}
            </NoticeDialog>
          ))}
          <button
            type="button"
            aria-pressed={activeTool === 'text'}
            onClick={() => {
              useEditorStore.getState().addTextLayer()
              setInspectorTab('adjust')
            }}
          >
            Text
          </button>
          {deferredTools.slice(3, 4).map(([label, detail]) => (
            <NoticeDialog key={label} title={`${label} is not available`} trigger={<button type="button">{label}</button>}>
              {detail}
            </NoticeDialog>
          ))}
          <button
            type="button"
            aria-pressed={activeTool === 'select' && inspectorTab === 'effects'}
            onClick={() => {
              useEditorStore.getState().setTool('select')
              setInspectorTab('effects')
            }}
          >
            Filters &amp; Effects
          </button>
          <button
            type="button"
            aria-pressed={activeTool === 'select' && inspectorTab === 'layers'}
            onClick={() => {
              useEditorStore.getState().setTool('select')
              setInspectorTab('layers')
            }}
          >
            Layers
          </button>
          <div className="tool-history">
            <button type="button" disabled={past.length === 0} onClick={() => useEditorStore.getState().undo()}>
              Undo
            </button>
            <button type="button" disabled={future.length === 0} onClick={() => useEditorStore.getState().redo()}>
              Redo
            </button>
          </div>
        </aside>
        <section className="canvas-area">
          <div className="canvas-controls">
            <button type="button" aria-label="Zoom out" onClick={() => useEditorStore.getState().setViewport({ zoom: Math.max(0.25, Math.round((viewport.zoom - 0.1) * 10) / 10) })}>
              −
            </button>
            <b>{Math.round(viewport.zoom * 100)}%</b>
            <button type="button" aria-label="Zoom in" onClick={() => useEditorStore.getState().setViewport({ zoom: Math.min(4, Math.round((viewport.zoom + 0.1) * 10) / 10) })}>
              +
            </button>
            <button type="button" aria-pressed={activeTool === 'pan'} aria-label="Pan canvas" onClick={() => useEditorStore.getState().setTool(activeTool === 'pan' ? 'select' : 'pan')}>
              ✋
            </button>
          </div>
          <div className="checkerboard">
            <EditorArtboard urls={urls} />
          </div>
        </section>
        <Inspector document={document} selected={selected} tab={inspectorTab} onTabChange={setInspectorTab} />
      </div>
      <PropertiesDialog document={document} selected={selected} tab={inspectorTab} onTabChange={setInspectorTab} />
      <AssetTray urls={urls} fileRef={fileRef} onUpload={onUpload} uploadError={uploadError} document={document} />
    </>
  )
}

function EditorArtboard({ urls }: { urls: Record<string, string> }) {
  if (import.meta.env.MODE === 'test') return <DomArtboard urls={urls} />
  return (
    <Suspense fallback={<div className="canvas-placeholder">Loading canvas…</div>}>
      <KonvaCanvas urls={urls} />
    </Suspense>
  )
}

function DomArtboard({ urls }: { urls: Record<string, string> }) {
  const document = useEditorStore((state) => state.document)
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId)
  if (!document) return null
  return (
    <div className="dom-artboard" data-testid="editor-canvas">
      {document.layers.filter((layer) => layer.visible).map((layer) => {
        const selected = layer.id === selectedLayerId
        if (layer.kind === 'text') {
          return (
            <p key={layer.id} data-selected={selected || undefined}>
              {layer.content}
            </p>
          )
        }
        if (layer.kind === 'image') {
          return (
            <button
              type="button"
              key={layer.id}
              className="dom-layer"
              data-selected={selected || undefined}
              onClick={() => useEditorStore.getState().selectLayer(layer.id)}
            >
              <img alt={layer.name} src={urls[layer.assetId]} />
            </button>
          )
        }
        return (
          <span key={layer.id} data-selected={selected || undefined}>
            {layer.shape}
          </span>
        )
      })}
      {document.layers.length === 0 ? (
        <div className="canvas-placeholder">
          <strong>Your sticker canvas</strong>
          <small>Upload a photo or add text to start editing.</small>
        </div>
      ) : null}
    </div>
  )
}

function PropertiesDialog({
  document,
  selected,
  tab,
  onTabChange,
}: {
  document: ProjectDocument
  selected: Layer | undefined
  tab?: string
  onTabChange?: (tab: string) => void
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="properties-toggle">Sticker properties</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Sticker properties</DialogTitle>
        <Inspector document={document} selected={selected} tab={tab} onTabChange={onTabChange} />
      </DialogContent>
    </Dialog>
  )
}

function Inspector({
  document,
  selected,
  tab = 'adjust',
  onTabChange,
}: {
  document: ProjectDocument
  selected: Layer | undefined
  tab?: string
  onTabChange?: (tab: string) => void
}) {
  return (
    <aside className="inspector">
      <h2>Sticker Properties</h2>
      <Tabs.Root value={tab} onValueChange={onTabChange}>
        <Tabs.List>
          <Tabs.Trigger value="adjust">Adjust</Tabs.Trigger>
          <Tabs.Trigger value="layers">Layers</Tabs.Trigger>
          <Tabs.Trigger value="effects">Effects</Tabs.Trigger>
          <Tabs.Trigger value="position">Position</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="adjust">
          {!selected ? <p className="muted">Select a layer to edit its properties.</p> : null}
          {selected?.kind === 'text' ? <TextInspector layer={selected} /> : null}
          {selected?.kind === 'image' ? <ImageInspector /> : null}
          {selected?.kind === 'shape' ? <p className="muted">Shape style editing arrives later.</p> : null}
        </Tabs.Content>
        <Tabs.Content value="layers">
          <LayersInspector document={document} selected={selected} />
        </Tabs.Content>
        <Tabs.Content value="effects">
          {selected?.kind === 'image' ? (
            <EffectsInspector layer={selected} />
          ) : (
            <p className="muted">Select an image layer to adjust brightness, contrast, saturation, and grayscale filters.</p>
          )}
        </Tabs.Content>
        <Tabs.Content value="position">
          {selected ? <PositionInspector layer={selected} /> : <p className="muted">Select a layer to change position.</p>}
          <h3>Layers</h3>
          <ul className="layer-list">
            {document.layers.map((layer) => (
              <li key={layer.id}>
                <button type="button" className={layer.id === selected?.id ? 'active' : undefined} onClick={() => useEditorStore.getState().selectLayer(layer.id)}>
                  {layer.name}
                  {layer.kind === 'text' ? ` — ${layer.content}` : ''}
                </button>
              </li>
            ))}
          </ul>
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  )
}

function LayersInspector({ document, selected }: { document: ProjectDocument; selected: Layer | undefined }) {
  return (
    <div className="inspector-fields">
      <h3>Layers ({document.layers.length})</h3>
      <p className="muted" style={{ fontSize: 12 }}>
        Top is front. Reorder, hide, lock, or rename layers.
      </p>
      {document.layers.length === 0 ? (
        <p className="muted">No layers yet. Upload a photo or add text to start.</p>
      ) : (
        <div className="layer-stack">
          {document.layers
            .slice()
            .reverse()
            .map((layer, reversedIndex) => {
              const originalIndex = document.layers.length - 1 - reversedIndex
              const isSelected = layer.id === selected?.id
              const isTop = originalIndex === document.layers.length - 1
              const isBottom = originalIndex === 0
              return (
                <div
                  key={layer.id}
                  className={`layer-row ${isSelected ? 'active' : ''}`}
                  onClick={() => useEditorStore.getState().selectLayer(layer.id)}
                >
                  <span className="layer-kind-tag">{layer.kind}</span>
                  <input
                    className="layer-row-title"
                    value={layer.name}
                    aria-label={`Layer name: ${layer.name}`}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => useEditorStore.getState().beginGesture()}
                    onChange={(e) => useEditorStore.getState().renameLayer(layer.id, e.target.value)}
                    onBlur={() => useEditorStore.getState().commitGesture()}
                  />
                  <div className="layer-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={`layer-action-btn ${!layer.visible ? 'dimmed' : ''}`}
                      title={layer.visible ? 'Hide layer' : 'Show layer'}
                      aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                      onClick={() => useEditorStore.getState().toggleLayerVisibility(layer.id)}
                    >
                      {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button
                      type="button"
                      className={`layer-action-btn ${layer.locked ? 'active' : ''}`}
                      title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                      aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                      onClick={() => useEditorStore.getState().toggleLayerLock(layer.id)}
                    >
                      {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
                    </button>
                    <button
                      type="button"
                      className="layer-action-btn"
                      disabled={isTop}
                      title="Bring forward"
                      aria-label={`Bring ${layer.name} forward`}
                      onClick={() => useEditorStore.getState().reorderLayer(layer.id, 'up')}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="layer-action-btn"
                      disabled={isBottom}
                      title="Send backward"
                      aria-label={`Send ${layer.name} backward`}
                      onClick={() => useEditorStore.getState().reorderLayer(layer.id, 'down')}
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      className="layer-action-btn"
                      title="Duplicate"
                      aria-label={`Duplicate ${layer.name}`}
                      onClick={() => {
                        useEditorStore.getState().selectLayer(layer.id)
                        useEditorStore.getState().duplicateSelected()
                      }}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      className="layer-action-btn"
                      title="Delete"
                      aria-label={`Delete ${layer.name}`}
                      onClick={() => {
                        useEditorStore.getState().selectLayer(layer.id)
                        useEditorStore.getState().removeSelected()
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}

function TextInspector({ layer }: { layer: Extract<Layer, { kind: 'text' }> }) {
  return (
    <div className="inspector-fields">
      <h3>Text layer</h3>
      <label>
        Content
        <textarea
          aria-label="Text content"
          value={layer.content}
          onFocus={() => useEditorStore.getState().beginGesture()}
          onChange={(event) => useEditorStore.getState().updateText(layer.id, { content: event.target.value })}
          onBlur={() => useEditorStore.getState().commitGesture()}
        />
      </label>
      <label>
        Font
        <select
          aria-label="Font family"
          value={layer.fontFamily}
          onChange={(event) => useEditorStore.getState().updateText(layer.id, { fontFamily: event.target.value })}
        >
          {TEXT_FONTS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Size <small>{layer.fontSize}px</small></span>
        <Slider
          aria-label="Font size"
          min={12}
          max={160}
          value={[layer.fontSize]}
          onPointerDown={(event) => {
            if (event.button === 0) useEditorStore.getState().beginGesture()
          }}
          onPointerUp={() => useEditorStore.getState().commitGesture()}
          onPointerCancel={() => useEditorStore.getState().commitGesture()}
          onLostPointerCapture={() => useEditorStore.getState().commitGesture()}
          onValueChange={(value) => {
            useEditorStore.getState().updateText(layer.id, { fontSize: value[0] ?? layer.fontSize })
          }}
        />
      </label>
      <label>
        Color
        <input
          aria-label="Text color"
          type="color"
          value={layer.color}
          onChange={(event) => useEditorStore.getState().updateText(layer.id, { color: event.target.value })}
        />
      </label>
    </div>
  )
}

function ImageInspector() {
  return (
    <div className="inspector-fields">
      <h3>Image layer</h3>
      <p className="muted">Move, resize, and rotate on the canvas. Crop and masks arrive later.</p>
      <div className="button-row">
        <Button onClick={() => useEditorStore.getState().flipSelected('horizontal')}>Flip H</Button>
        <Button onClick={() => useEditorStore.getState().flipSelected('vertical')}>Flip V</Button>
        <Button onClick={() => useEditorStore.getState().rotateSelected90()}>Rotate 90°</Button>
      </div>
      <label>
        Outline <input type="checkbox" disabled aria-label="Outline (unavailable)" />
      </label>
      <label>
        <span>Thickness <small>Later</small></span>
        <Slider aria-label="Outline thickness placeholder" defaultValue={[24]} max={40} disabled />
      </label>
    </div>
  )
}

function EffectsInspector({ layer }: { layer: Extract<Layer, { kind: 'image' }> }) {
  const filters = layer.filters ?? { brightness: 0, contrast: 0, saturation: 0, grayscale: 0 }
  const store = useEditorStore.getState
  return (
    <div className="inspector-fields">
      <h3>Filters &amp; Effects</h3>
      <p className="muted" style={{ fontSize: 12 }}>
        Adjust photo tone. Applied to canvas preview and PNG exports.
      </p>
      <label>
        <span>Brightness <small>{filters.brightness}%</small></span>
        <Slider
          aria-label="Filter brightness"
          min={-100}
          max={100}
          value={[filters.brightness]}
          onPointerDown={(e) => { if (e.button === 0) store().beginGesture() }}
          onPointerUp={() => store().commitGesture()}
          onPointerCancel={() => store().commitGesture()}
          onValueChange={(val) => store().updateFilters(layer.id, { brightness: val[0] ?? 0 })}
        />
      </label>
      <label>
        <span>Contrast <small>{filters.contrast}%</small></span>
        <Slider
          aria-label="Filter contrast"
          min={-100}
          max={100}
          value={[filters.contrast]}
          onPointerDown={(e) => { if (e.button === 0) store().beginGesture() }}
          onPointerUp={() => store().commitGesture()}
          onPointerCancel={() => store().commitGesture()}
          onValueChange={(val) => store().updateFilters(layer.id, { contrast: val[0] ?? 0 })}
        />
      </label>
      <label>
        <span>Saturation <small>{filters.saturation}%</small></span>
        <Slider
          aria-label="Filter saturation"
          min={-100}
          max={100}
          value={[filters.saturation]}
          onPointerDown={(e) => { if (e.button === 0) store().beginGesture() }}
          onPointerUp={() => store().commitGesture()}
          onPointerCancel={() => store().commitGesture()}
          onValueChange={(val) => store().updateFilters(layer.id, { saturation: val[0] ?? 0 })}
        />
      </label>
      <label>
        <span>Grayscale <small>{filters.grayscale}%</small></span>
        <Slider
          aria-label="Filter grayscale"
          min={0}
          max={100}
          value={[filters.grayscale]}
          onPointerDown={(e) => { if (e.button === 0) store().beginGesture() }}
          onPointerUp={() => store().commitGesture()}
          onPointerCancel={() => store().commitGesture()}
          onValueChange={(val) => store().updateFilters(layer.id, { grayscale: val[0] ?? 0 })}
        />
      </label>
      <div className="button-row" style={{ marginTop: 12 }}>
        <Button onClick={() => store().resetFilters(layer.id)}>Reset Filters</Button>
      </div>
    </div>
  )
}

function PositionInspector({ layer }: { layer: Layer }) {
  const t = layer.transform
  return (
    <div className="inspector-fields">
      <div className="button-row">
        <Button aria-label="Nudge left" onClick={() => useEditorStore.getState().nudgeSelected(-8, 0)}>←</Button>
        <Button aria-label="Nudge right" onClick={() => useEditorStore.getState().nudgeSelected(8, 0)}>→</Button>
        <Button aria-label="Nudge up" onClick={() => useEditorStore.getState().nudgeSelected(0, -8)}>↑</Button>
        <Button aria-label="Nudge down" onClick={() => useEditorStore.getState().nudgeSelected(0, 8)}>↓</Button>
        <Button onClick={() => useEditorStore.getState().rotateSelected90()}>Rotate 90°</Button>
      </div>
      <p className="muted">X {Math.round(t.x)}, Y {Math.round(t.y)}, {Math.round(t.rotation)}°</p>
      <div className="button-row">
        <Button onClick={() => useEditorStore.getState().duplicateSelected()}>Duplicate</Button>
        <Button onClick={() => useEditorStore.getState().removeSelected()}>Delete</Button>
      </div>
    </div>
  )
}

function AssetTray({
  urls,
  fileRef,
  onUpload,
  uploadError,
  document,
}: {
  urls: Record<string, string>
  fileRef: MutableRefObject<HTMLInputElement | null>
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  uploadError: string | null
  document: ProjectDocument
}) {
  const [tab, setTab] = useState('uploads')
  const imageLayers = document.layers.filter((layer) => layer.kind === 'image')
  return (
    <section className="asset-tray">
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Choose photo file"
        data-testid="photo-file-input"
        onChange={onUpload}
      />
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List>
          {['uploads', 'stickers', 'emojis', 'shapes', 'text'].map((item) => (
            <Tabs.Trigger key={item} value={item}>
              {item === 'uploads' ? 'Recent Uploads' : item}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="uploads">
          {uploadError ? <p role="alert">{uploadError}</p> : null}
          <div className="asset-items">
            <button type="button" className="asset-upload" onClick={() => fileRef.current?.click()}>
              <Upload />Upload Photo
            </button>
            {imageLayers.map((layer) => (
              <button type="button" key={layer.id} className="asset-thumb" onClick={() => useEditorStore.getState().selectLayer(layer.id)}>
                <img alt={layer.name} src={layer.kind === 'image' ? urls[layer.assetId] : undefined} />
              </button>
            ))}
            <SampleButton name="Cat in console" src="/samples/cat-in-console.png" />
            <SampleButton name="Cuban solenodon" src="/samples/solenodon.png" />
          </div>
        </Tabs.Content>
        {['stickers', 'emojis', 'shapes', 'text'].map((item) => (
          <Tabs.Content value={item} key={item}>
            <p className="muted asset-note">{item} assets are not available yet. Upload a photo or use the sample decorations in Recent Uploads.</p>
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </section>
  )
}

function SampleButton({ name, src }: { name: string; src: string }) {
  return (
    <button
      type="button"
      className="asset-thumb"
      onClick={() => {
        void ingestIntoCurrentProject(async () => {
          const response = await fetch(src)
          if (!response.ok) throw new Error('Sample is unavailable')
          const blob = await response.blob()
          const file = new File([blob], `${name}.png`, { type: blob.type || 'image/png' })
          return ingestImageFile(file)
        })
      }}
    >
      <img alt={`${name} sample`} src={src} />
    </button>
  )
}

function ExportDialog({ document }: { document: ProjectDocument }) {
  const [size, setSize] = useState<ExportSize>(512)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const assets = useEditorStore((state) => state.assets)

  const exportPng = async () => {
    setBusy(true)
    setMessage('Exporting…')
    try {
      const blob = await renderDocument(document, assets, { size })
      const safeTitle = document.title.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'sticker'
      downloadBlob(blob, `${safeTitle}-${size}.png`)
      setMessage('Download started. Check your browser downloads to confirm the file was saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button aria-label="Export and share">
          <Download />Export &amp; Share
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Export sticker</DialogTitle>
        <DialogDescription>
          Download a transparent PNG of the 1024×1024 artboard. Checkerboard, selection handles, and zoom are not included. This is not a WhatsApp or Telegram sticker pack.
        </DialogDescription>
        <div className="export-sizes">
          <label>
            <input type="radio" name="export-size" checked={size === 512} onChange={() => setSize(512)} />
            512 × 512
          </label>
          <label>
            <input type="radio" name="export-size" checked={size === 1024} onChange={() => setSize(1024)} />
            1024 × 1024
          </label>
        </div>
        <div className="button-row">
          <Button className="primary" disabled={busy} onClick={() => void exportPng()}>
            Download PNG
          </Button>
          <NoticeDialog title="Messenger packs are not available" trigger={<Button>WhatsApp / Telegram</Button>}>
            Native WhatsApp and Telegram installation is not implemented. Download a PNG and add it in those apps manually if they accept image stickers.
          </NoticeDialog>
        </div>
        {message ? <p role="status">{message}</p> : null}
      </DialogContent>
    </Dialog>
  )
}

function useAssetUrls(assets: Record<string, AssetRecord>) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const cache = new AssetObjectUrlCache()
    const next: Record<string, string> = {}
    for (const [id, record] of Object.entries(assets)) {
      try {
        next[id] = cache.urlFor(id, record.blob)
      } catch {
        next[id] = ''
      }
    }
    setUrls(next)
    return () => {
      try {
        cache.revokeAll()
      } catch {
        // jsdom may not implement revokeObjectURL.
      }
    }
  }, [assets])
  return urls
}

function useAutosave(repo: StickerLabRepository) {
  const dirty = useEditorStore((state) => state.dirty)
  const gestureActive = useEditorStore((state) => state.gestureActive)
  const revision = useEditorStore((state) => state.document?.revision)
  const documentId = useEditorStore((state) => state.document?.id)

  const save = useCallback(() => persistDocument(repo, 'auto'), [repo])

  useEffect(() => {
    if (!dirty || gestureActive || !documentId) return
    const timer = window.setTimeout(() => {
      void save()
    }, 800)
    return () => window.clearTimeout(timer)
  }, [dirty, gestureActive, revision, documentId, save])

  useEffect(() => {
    const onHide = () => {
      void persistDocument(repo, 'manual')
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [repo])
}

let persistTail: Promise<void> = Promise.resolve()

function referencedRecords(document: ProjectDocument, assets: Record<string, AssetRecord>): AssetRecord[] {
  const ids = new Set(document.assetIds)
  for (const layer of document.layers) {
    if (layer.kind === 'image') ids.add(layer.assetId)
  }
  const records: AssetRecord[] = []
  for (const id of ids) {
    const record = assets[id]
    if (record) records.push(record)
  }
  return records
}

function captureSave(reason: 'auto' | 'manual') {
  const store = useEditorStore.getState()
  if (store.gestureActive) store.commitGesture()
  const state = useEditorStore.getState()
  if (!state.document) return null
  if (reason === 'auto' && !state.dirty) return null
  return {
    document: serializeProjectDocument(state.document),
    records: referencedRecords(state.document, state.assets),
  }
}

function persistDocument(repo: StickerLabRepository, reason: 'auto' | 'manual') {
  const payload = captureSave(reason)
  if (!payload) return persistTail
  persistTail = persistTail.then(
    () => persistCaptured(repo, payload),
    () => persistCaptured(repo, payload),
  )
  return persistTail
}

async function persistCaptured(
  repo: StickerLabRepository,
  payload: { document: ProjectDocument; records: AssetRecord[] },
) {
  const matches = () => useEditorStore.getState().document?.id === payload.document.id
  if (matches()) useEditorStore.getState().setSaveStatus('saving')
  try {
    await repo.saveProjectWithAssets(payload.document, payload.records)
    if (matches()) useEditorStore.getState().markSaved(payload.document.revision)
  } catch (error) {
    if (!matches()) return
    const message = error instanceof Error ? error.message : 'Save failed'
    useEditorStore.getState().setSaveStatus('save-failed', message)
  }
}

async function ingestIntoCurrentProject(load: () => Promise<AssetRecord>) {
  const originId = useEditorStore.getState().document?.id
  try {
    const record = await load()
    if (useEditorStore.getState().document?.id !== originId) return
    useEditorStore.getState().addImageLayer(record)
  } catch (error) {
    if (useEditorStore.getState().document?.id !== originId) return
    const message = error instanceof UploadValidationError ? error.message : 'The image could not be added'
    useEditorStore.getState().setUploadError(message)
  }
}

function useEditorShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [data-slot="slider"]')
      ) {
        return
      }
      const meta = event.metaKey || event.ctrlKey
      const store = useEditorStore.getState()
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        store.redo()
        return
      }
      if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        store.duplicateSelected()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        store.removeSelected()
        return
      }
      if (event.key === 'Escape') {
        store.selectLayer(null)
        return
      }
      const step = event.shiftKey ? 10 : 1
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        store.nudgeSelected(-step, 0)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        store.nudgeSelected(step, 0)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        store.nudgeSelected(0, -step)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        store.nudgeSelected(0, step)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
