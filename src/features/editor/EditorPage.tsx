import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ChangeEvent, type MutableRefObject } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Copy, Download, Eye, EyeOff, Lock, Trash2, Unlock, Upload, Eraser, Paintbrush, Crop, Circle, Type, Smile, Sparkles, Layers, Undo2, Redo2 } from 'lucide-react'
import { useRepository } from '../../app/repository'
import { useCloudStatus, useWorkspace } from '../auth/Workspace'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { NoticeDialog } from '@/components/ui/notice-dialog'
import { Slider } from '@/components/ui/slider'
import { Tabs } from '@/components/ui/tabs'
import { isPersistenceError, serializeProjectDocument, type AssetRecord, type MaskRecord, type StickerLabRepository } from '../../lib/persistence/repository'
import { ingestImageFile, ingestBundledImage, AssetObjectUrlCache } from '../assets/assetLoader'
import { UploadValidationError } from '../assets/validateUpload'
import { downloadBlob, renderDocument, type ExportSize } from '../exports/renderDocument'
import type { ImageLayer, Layer, ProjectDocument } from '../../types/domain'
import { saveStatusLabel, useEditorStore, type TextStyle } from './store'
import { cssFontFamily, TEXT_FONTS } from '../../lib/fonts'
import { STICKER_CATALOG, TEXT_PRESETS } from './catalog'

const KonvaCanvas = lazy(() => import('./KonvaCanvas'))

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
      if (existing && (current.dirty || current.gestureActive || current.finishMaskStroke)) {
        await persistDocument(repo, 'manual').catch(() => undefined)
        if (cancelled) return
        const after = useEditorStore.getState()
        if (after.document?.id === existing.id && (after.dirty || after.finishMaskStroke || after.saveStatus === 'save-failed')) {
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
  const cloud = useWorkspace()?.cloud
  const cloudStatus = useCloudStatus()
  const conflict = projectId ? cloudStatus.conflicts[projectId] : undefined
  useEffect(() => {
    if (!conflict || !projectId) return
    let live = true
    void (async () => {
      await useEditorStore.getState().finishMaskStroke?.()
      if (!live) return
      const state = useEditorStore.getState()
      if (state.document?.id !== projectId) return
      state.commitGesture()
      const latest = useEditorStore.getState()
      if (!latest.document) return
      const newer = latest.dirty || latest.document.revision !== conflict.revision
      latest.hydrate({ ...latest.document, id: conflict.id, title: `${latest.document.title} (conflict copy)` }, Object.values(latest.assets), Object.entries(latest.masks).map(([key, blob]) => ({ key, blob })))
      if (newer) useEditorStore.setState({ dirty: true, saveStatus: 'unsaved' })
      navigate(`/editor/${conflict.id}`, { replace: true })
      cloud?.dismissConflict(projectId)
    })().catch(() => useEditorStore.getState().setSaveStatus('save-failed', 'Finish the mask edit to open the conflict copy.'))
    return () => { live = false }
  }, [conflict, projectId, navigate, cloud])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    const flush = () => {
      const snap = useEditorStore.getState()
      if (snap.document?.id === projectId && (snap.dirty || snap.gestureActive || snap.finishMaskStroke)) {
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
      if (previous.document && (previous.dirty || previous.gestureActive || previous.finishMaskStroke)) {
        await persistDocument(repo, 'manual').catch(() => undefined)
        if (cancelled) return
        const after = useEditorStore.getState()
        if (after.document?.id === previous.document.id && (after.dirty || after.finishMaskStroke || after.saveStatus === 'save-failed')) {
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
        const maskKeys = loaded.layers
          .filter((l): l is ImageLayer => l.kind === 'image' && !!l.maskKey)
          .map((l) => l.maskKey!)
        const masks = await Promise.all(
          maskKeys.map(async (key) => ({ key, blob: await repo.getMask(key) })),
        )
        if (cancelled) return
        useEditorStore.getState().hydrate(loaded, records, masks)
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
  const cloud = useWorkspace()?.cloud
  const cloudStatus = useCloudStatus()
  const fileRef = useRef<HTMLInputElement>(null)
  const [inspectorTab, updateInspectorTab] = useState('adjust')
  const setInspectorTab = (tab: string) => {
    // Radix can unmount a focused field before its blur handler runs.
    const state = useEditorStore.getState()
    if (!state.finishMaskStroke) state.commitGesture()
    updateInspectorTab(tab)
  }
  const [assetTab, setAssetTab] = useState('uploads')
  const trayRef = useRef<HTMLElement>(null)
  const saveStatus = useEditorStore((state) => state.saveStatus)
  const saveError = useEditorStore((state) => state.saveError)
  const dirty = useEditorStore((state) => state.dirty)
  const maskBusy = useEditorStore((state) => !!state.finishMaskStroke)
  const uploadError = useEditorStore((state) => state.uploadError)
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId)
  const activeTool = useEditorStore((state) => state.activeTool)
  const zoom = useEditorStore((state) => state.viewport.zoom)
  const canUndo = useEditorStore((state) => state.past.length > 0)
  const canRedo = useEditorStore((state) => state.future.length > 0)
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
            {maskBusy && saveStatus !== 'save-failed' ? 'Mask edit pending' : cloud && !dirty && saveStatus === 'saved-locally' ? cloudStatus.state === 'synced' ? 'Saved to cloud' : cloudStatus.state === 'syncing' ? 'Saved locally · syncing' : 'Saved locally · cloud pending' : saveStatusLabel(saveStatus, dirty)}
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
          <span className="tool-note">A little crop, a little color, a whole lot of personality.</span>
          <button
            type="button"
            aria-pressed={activeTool === 'erase'}
            onClick={() => {
              useEditorStore.getState().setTool('erase')
              setInspectorTab('adjust')
            }}
          >
            <Eraser size={18} />Erase
          </button>
          <button
            type="button"
            aria-pressed={activeTool === 'restore'}
            onClick={() => {
              useEditorStore.getState().setTool('restore')
              setInspectorTab('adjust')
            }}
          >
            <Paintbrush size={18} />Brush / Restore
          </button>
          <button
            type="button"
            aria-pressed={activeTool === 'rotate'}
            onClick={() => {
              useEditorStore.getState().setTool('rotate')
              setInspectorTab('adjust')
            }}
          >
            <Crop size={18} />Crop &amp; Rotate
          </button>
          <button
            type="button"
            aria-pressed={activeTool === 'select' && inspectorTab === 'adjust'}
            onClick={() => {
              useEditorStore.getState().setTool('select')
              setInspectorTab('adjust')
            }}
          >
            <Circle size={18} />Outline &amp; Border
          </button>
          <button
            type="button"
            aria-pressed={activeTool === 'text'}
            onClick={() => {
              useEditorStore.getState().addTextLayer()
              setInspectorTab('adjust')
            }}
          >
            <Type size={18} />Text
          </button>
          <button type="button" onClick={() => {
            setAssetTab('stickers')
            trayRef.current?.scrollIntoView({ block: 'nearest' })
            trayRef.current?.focus({ preventScroll: true })
          }}><Smile size={18} />Stickers &amp; decorations</button>
          <button
            type="button"
            aria-pressed={activeTool === 'select' && inspectorTab === 'effects'}
            onClick={() => {
              useEditorStore.getState().setTool('select')
              setInspectorTab('effects')
            }}
          >
            <Sparkles size={18} />Filters &amp; Effects
          </button>
          <button
            type="button"
            aria-pressed={activeTool === 'select' && inspectorTab === 'layers'}
            onClick={() => {
              useEditorStore.getState().setTool('select')
              setInspectorTab('layers')
            }}
          >
            <Layers size={18} />Layers
          </button>
          <div className="tool-history">
            <button type="button" disabled={!canUndo || maskBusy} onClick={() => useEditorStore.getState().undo()}>
              <Undo2 size={16} />Undo
            </button>
            <button type="button" disabled={!canRedo || maskBusy} onClick={() => useEditorStore.getState().redo()}>
              <Redo2 size={16} />Redo
            </button>
          </div>
        </aside>
        <section className="canvas-area">
          <div className="canvas-controls">
            <button type="button" aria-label="Zoom out" onClick={() => useEditorStore.getState().setViewport({ zoom: Math.max(0.25, Math.round((zoom - 0.1) * 10) / 10) })}>
              −
            </button>
            <b>{Math.round(zoom * 100)}%</b>
            <button type="button" aria-label="Zoom in" onClick={() => useEditorStore.getState().setViewport({ zoom: Math.min(4, Math.round((zoom + 0.1) * 10) / 10) })}>
              +
            </button>
            <button type="button" aria-pressed={activeTool === 'pan'} aria-label="Pan canvas" onClick={() => useEditorStore.getState().setTool(activeTool === 'pan' ? 'select' : 'pan')}>
              ✋
            </button>
          </div>
          <div className="checkerboard">
            <EditorArtboard urls={urls} />
            {document.layers.length === 0 ? (
              <div className="editor-welcome">
                <img src="/art/stickers/04-winking-smiley.webp" alt="" width={72} height={72} />
                <h2>A blank canvas. Endless you.</h2>
                <p>Drop in a little personality. Start with a photo, then make it your own.</p>
                <Button className="primary" onClick={() => fileRef.current?.click()}><Upload size={16} />Upload a photo</Button>
                <small>PNG, JPEG or WebP · up to 15 MB</small>
              </div>
            ) : null}
          </div>
        </section>
        <Inspector document={document} selected={selected} tab={inspectorTab} onTabChange={setInspectorTab} />
      </div>
      <PropertiesDialog document={document} selected={selected} tab={inspectorTab} onTabChange={setInspectorTab} />
      <AssetTray urls={urls} fileRef={fileRef} onUpload={onUpload} uploadError={uploadError} document={document}
        tab={assetTab} onTabChange={setAssetTab} trayRef={trayRef}
        onAddText={(style) => { useEditorStore.getState().addTextLayer(style); setInspectorTab('adjust') }} />
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
            <p
              key={layer.id}
              data-selected={selected || undefined}
              onDoubleClick={() => {
                useEditorStore.getState().selectLayer(layer.id)
                useEditorStore.getState().beginGesture()
                globalThis.document.querySelector<HTMLTextAreaElement>('[aria-label="Text content"]')?.focus()
              }}
            >
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
              data-mask-key={layer.maskKey || undefined}
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
        <DialogDescription>Fine-tune your selected layer.</DialogDescription>
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
          {selected?.kind === 'image' ? <ImageInspector layer={selected} /> : null}
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
                  <button type="button" className="layer-kind-tag" aria-label={`Select ${layer.name}`} aria-pressed={isSelected} onClick={(event) => { event.stopPropagation(); useEditorStore.getState().selectLayer(layer.id) }}>{layer.kind}</button>
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
          onChange={(event) => {
            useEditorStore.getState().setUploadError(null)
            useEditorStore.getState().updateText(layer.id, { fontFamily: event.target.value })
          }}
        >
          {TEXT_FONTS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </label>
      <div className="font-preview" aria-hidden="true" style={{ fontFamily: cssFontFamily(layer.fontFamily) }}>{layer.content || 'Aa'}</div>
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

function ImageInspector({ layer }: { layer: Extract<Layer, { kind: 'image' }> }) {
  const replacementInput = useRef<HTMLInputElement>(null)
  const [replacing, setReplacing] = useState(false)
  const outline = layer.outline ?? { enabled: false, color: '#ffffff', width: 12 }
  const brushSize = useEditorStore((state) => state.brushSize)
  const activeTool = useEditorStore((state) => state.activeTool)
  const store = useEditorStore.getState
  return (
    <div className="inspector-fields">
      <h3>Image layer</h3>
      <Button title="Keeps position, rotation, and effects; resets crop and erasure. Backgrounds are not removed automatically." disabled={layer.locked || replacing} onClick={() => replacementInput.current?.click()}>{replacing ? 'Replacing…' : 'Replace photo'}</Button>
      <input ref={replacementInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Replacement photo" hidden onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setReplacing(true)
        void ingestIntoCurrentProject(() => ingestImageFile(file), undefined, layer.id).finally(() => setReplacing(false))
      }} />
      <p className="muted">Replacement resets crop and erasure. Use a transparent photo or erase its background.</p>
      <div className="button-row">
        <Button
          className={activeTool === 'erase' ? 'primary' : undefined}
          onClick={() => store().setTool(activeTool === 'erase' ? 'select' : 'erase')}
        >
          Erase
        </Button>
        <Button
          className={activeTool === 'restore' ? 'primary' : undefined}
          onClick={() => store().setTool(activeTool === 'restore' ? 'select' : 'restore')}
        >
          Restore
        </Button>
        {layer.maskKey && (
          <Button onClick={() => store().clearMask(layer.id)} title="Reset mask to show full image">
            Reset Mask
          </Button>
        )}
      </div>

      {(activeTool === 'erase' || activeTool === 'restore') && (
        <label>
          <span>Brush size <small>{brushSize}px</small></span>
          <Slider
            aria-label="Brush size"
            min={4}
            max={120}
            value={[brushSize]}
            onValueChange={(val) => store().setBrushSize(val[0] ?? 30)}
          />
        </label>
      )}

      <div className="button-row">
        <Button onClick={() => store().flipSelected('horizontal')}>Flip H</Button>
        <Button onClick={() => store().flipSelected('vertical')}>Flip V</Button>
        <Button onClick={() => store().rotateSelected90()}>Rotate 90°</Button>
      </div>
      <label>
        Outline
        <input
          type="checkbox"
          aria-label="Toggle silhouette outline"
          checked={outline.enabled}
          onChange={(e) => store().updateOutline(layer.id, { enabled: e.target.checked })}
        />
      </label>
      {outline.enabled ? (
        <>
          <label>
            Outline color
            <input
              type="color"
              aria-label="Outline color"
              value={outline.color}
              onChange={(e) => store().updateOutline(layer.id, { color: e.target.value })}
            />
          </label>
          <label>
            <span>Thickness <small>{outline.width}px</small></span>
            <Slider
              aria-label="Outline thickness"
              min={2}
              max={40}
              value={[outline.width]}
              onPointerDown={(e) => {
                if (e.button === 0) store().beginGesture()
              }}
              onPointerUp={() => store().commitGesture()}
              onPointerCancel={() => store().commitGesture()}
              onValueChange={(val) => store().updateOutline(layer.id, { width: val[0] ?? 12 })}
            />
          </label>
        </>
      ) : null}
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
  tab,
  onTabChange,
  trayRef,
  onAddText,
}: {
  tab: string
  onTabChange: (tab: string) => void
  trayRef: MutableRefObject<HTMLElement | null>
  onAddText: (style: TextStyle) => void
  urls: Record<string, string>
  fileRef: MutableRefObject<HTMLInputElement | null>
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  uploadError: string | null
  document: ProjectDocument
}) {
  const imageLayers = document.layers.filter((layer) => layer.kind === 'image')
  return (
    <section className="asset-tray" ref={trayRef} tabIndex={-1} aria-label="Sticker assets">
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Choose photo file"
        data-testid="photo-file-input"
        onChange={onUpload}
      />
      {uploadError ? <p role="alert" className="asset-error">{uploadError}</p> : null}
      <Tabs.Root value={tab} onValueChange={onTabChange}>
        <Tabs.List aria-label="Asset types">
          <Tabs.Trigger value="uploads">Recent Uploads</Tabs.Trigger>
          <Tabs.Trigger value="stickers">Stickers &amp; decorations</Tabs.Trigger>
          <Tabs.Trigger value="text">Text styles</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="uploads">
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
        <Tabs.Content value="stickers">
          <p className="muted asset-note">Pick a cutout, then move, resize, rotate, or add an outline. Lettering here is part of the image; use Text styles for editable words.</p>
          <div className="asset-items">
            {STICKER_CATALOG.map((asset) => <SampleButton key={asset.src} {...asset} />)}
          </div>
        </Tabs.Content>
        <Tabs.Content value="text">
          <p className="muted asset-note">Start with a style. Change the words, font, size, and color in Sticker Properties.</p>
          <div className="asset-items text-presets">
            {TEXT_PRESETS.map((preset) => (
              <Button className="text-preset" key={preset.fontFamily} onClick={() => onAddText(preset)} aria-label={`Add ${preset.fontFamily} text`}>
                <span className="text-preset-sample" style={{ fontFamily: cssFontFamily(preset.fontFamily), color: preset.color }}>{preset.content}</span>
                <strong>{preset.fontFamily}</strong><small>{preset.description}</small>
              </Button>
            ))}
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </section>
  )
}

function SampleButton({ name, src }: { name: string; src: string }) {
  const [adding, setAdding] = useState(false)
  return (
    <Button
      className="asset-thumb catalog-asset"
      aria-label={`Add ${name}`}
      title={name}
      disabled={adding}
      onClick={() => {
        setAdding(true)
        void ingestIntoCurrentProject(() => ingestBundledImage(src), name).finally(() => setAdding(false))
      }}
    >
      <img alt="" src={src} loading="lazy" />
      <span>{adding ? 'Adding…' : name}</span>
    </Button>
  )
}

function ExportDialog({ document }: { document: ProjectDocument }) {
  const [size, setSize] = useState<ExportSize>(1024)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const exportPng = async () => {
    setBusy(true)
    setMessage('Exporting…')
    try {
      await useEditorStore.getState().finishMaskStroke?.()
      const state = useEditorStore.getState()
      if (state.document?.id !== document.id) throw new Error('The open project changed. Reopen export to continue.')
      const blob = await renderDocument(state.document, state.assets, { size, masks: state.masks })
      if (useEditorStore.getState().workspaceEpoch !== state.workspaceEpoch) throw new Error('Export canceled because the workspace changed.')
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
        <DialogFooter>
          <NoticeDialog title="Messenger packs are not available" trigger={<Button>WhatsApp / Telegram</Button>}>
            Native WhatsApp and Telegram installation is not implemented. Download a PNG and add it in those apps manually if they accept image stickers.
          </NoticeDialog>
          <Button className="primary" disabled={busy} onClick={() => void exportPng()}>
            <Download size={16} />Download PNG
          </Button>
        </DialogFooter>
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
  const gestureActive = useEditorStore((state) => state.gestureActive || !!state.finishMaskStroke)
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
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const state = useEditorStore.getState()
      if (state.dirty || state.gestureActive || state.finishMaskStroke) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
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

function referencedMasks(document: ProjectDocument, masks: Record<string, Blob>): MaskRecord[] {
  const records: MaskRecord[] = []
  for (const layer of document.layers) {
    if (layer.kind === 'image' && layer.maskKey && masks[layer.maskKey]) {
      records.push({ key: layer.maskKey, blob: masks[layer.maskKey] })
    }
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
    workspaceEpoch: state.workspaceEpoch,
    document: serializeProjectDocument(state.document),
    records: referencedRecords(state.document, state.assets),
    masks: referencedMasks(state.document, state.masks),
  }
}

async function persistDocument(repo: StickerLabRepository, reason: 'auto' | 'manual') {
  const initial = useEditorStore.getState()
  if (initial.finishMaskStroke) {
    try { await initial.finishMaskStroke() } catch { return persistTail } // Stroke retains its recoverable error/work.
  }
  if (useEditorStore.getState().workspaceEpoch !== initial.workspaceEpoch || useEditorStore.getState().document?.id !== initial.document?.id) return persistTail
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
  payload: { workspaceEpoch: number; document: ProjectDocument; records: AssetRecord[]; masks: MaskRecord[] },
) {
  const matches = () => useEditorStore.getState().workspaceEpoch === payload.workspaceEpoch && useEditorStore.getState().document?.id === payload.document.id
  if (matches()) useEditorStore.getState().setSaveStatus('saving')
  try {
    await repo.saveProjectWithAssets(payload.document, payload.records, payload.masks)
    if (matches()) useEditorStore.getState().markSaved(payload.document.revision)
  } catch (error) {
    if (!matches()) return
    const message = error instanceof Error ? error.message : 'Save failed'
    useEditorStore.getState().setSaveStatus('save-failed', message)
  }
}

async function ingestIntoCurrentProject(load: () => Promise<AssetRecord>, name?: string, replaceLayerId?: string) {
  const originId = useEditorStore.getState().document?.id
  const epoch = useEditorStore.getState().workspaceEpoch
  const stale = () => useEditorStore.getState().workspaceEpoch !== epoch || useEditorStore.getState().document?.id !== originId
  try {
    const record = await load()
    if (stale()) return
    if (replaceLayerId) {
      await useEditorStore.getState().finishMaskStroke?.()
      const state = useEditorStore.getState()
      if (stale()) return
      if (state.gestureActive) { state.setUploadError('Finish the current edit, then try replacing the photo again.'); return }
      state.replaceImageLayer(replaceLayerId, record)
    } else useEditorStore.getState().addImageLayer(record, name)
  } catch (error) {
    if (stale()) return
    const message = error instanceof UploadValidationError ? error.message : 'The image could not be added'
    useEditorStore.getState().setUploadError(message)
  }
}

export async function flushEditor(repo: StickerLabRepository): Promise<void> {
  const state = useEditorStore.getState()
  if (!state.document || (!state.dirty && !state.gestureActive && !state.finishMaskStroke)) return
  await persistDocument(repo, 'manual')
  const after = useEditorStore.getState()
  if (after.dirty || after.finishMaskStroke || after.saveStatus === 'save-failed') throw new Error('Could not save the current draft locally. Retry before changing workspace.')
}

function useEditorShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [data-slot="slider"], [role="dialog"]')
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
