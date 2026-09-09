import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ChangeEvent, type MutableRefObject } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Check, ChevronLeft, Circle, CloudUpload, Copy, Crop, Download, Eye, EyeOff, FlipHorizontal2, FlipVertical2, Hand, Layers, Lightbulb, Lock, Maximize2, Paintbrush, Pencil, RotateCw, Scissors, Search, Smile, Sparkles, Trash2, Type, Undo2, Unlock, Upload, Redo2 } from 'lucide-react'
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
import { downloadBlob } from '../exports/download'
import { renderDocument, type ExportSize } from '../exports/renderDocument'
import type { ImageLayer, Layer, ProjectDocument } from '../../types/domain'
import { saveStatusLabel, useEditorStore, type TextStyle } from './store'
import { cssFontFamily, TEXT_FONTS } from '../../lib/fonts'
import { STICKER_CATALOG, TEXT_PRESETS } from './catalog'
import {
  applyToolIntent,
  editorPathWithIntent,
  isReusableOpenDocument,
  parseToolIntent,
  subscribeToolIntent,
  toolEmptyCopy,
  TOOL_INTENT_LABELS,
  type ToolIntent,
} from './toolIntent'

import { ProjectThumb } from './ProjectThumb'

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
  const [params] = useSearchParams()
  const intent = parseToolIntent(params.get('tool'))
  const [choice, setChoice] = useState<ProjectDocument[] | null>(null)
  const [choiceError, setChoiceError] = useState<string | null>(null)

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
          navigate(editorPathWithIntent(existing.id, intent), { replace: true })
          return
        }
      }
      if (cancelled) return
      const state = useEditorStore.getState()
      if (intent && isReusableOpenDocument(state.document, state) && state.document) {
        navigate(editorPathWithIntent(state.document.id, intent), { replace: true })
        return
      }
      if (intent) {
        try {
          const projects = await repo.listProjects()
          if (cancelled) return
          if (projects.length > 0) {
            setChoice(projects)
            setChoiceError(null)
            return
          }
        } catch {
          if (cancelled) return
          setChoice([])
          setChoiceError('Could not load saved stickers. You can still create a new one.')
          return
        }
      }
      if (cancelled) return
      navigate(editorPathWithIntent(takeCreateDraftId(), intent), { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [navigate, repo, intent])

  if (choice && intent) {
    return (
      <ToolDocumentChoice
        intent={intent}
        projects={choice}
        error={choiceError}
        onCreate={() => navigate(editorPathWithIntent(takeCreateDraftId(), intent), { replace: true })}
        onOpen={(id) => navigate(editorPathWithIntent(id, intent), { replace: true })}
      />
    )
  }

  return <p className="muted" style={{ padding: 24 }}>Opening sticker…</p>
}

function ToolDocumentChoice({
  intent,
  projects,
  error,
  onCreate,
  onOpen,
}: {
  intent: ToolIntent
  projects: ProjectDocument[]
  error: string | null
  onCreate: () => void
  onOpen: (id: string) => void
}) {
  const repo = useRepository()
  return (
    <section className="tool-choice" data-testid="tool-document-choice">
      <header className="tool-choice-header">
        <div>
          <span className="tool-choice-eyebrow">YOUR NEXT LITTLE MASTERPIECE</span>
          <h1>{TOOL_INTENT_LABELS[intent]}</h1>
          <p>Pick a sticker to keep creating, or start with something new. Your saved work stays yours.</p>
        </div>
        <Button className="primary" onClick={onCreate}><Upload size={18} />Create new sticker</Button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {projects.length > 0 ? (
        <>
          <div className="tool-choice-heading"><h2>Pick up where you left off</h2><span>{projects.length} saved {projects.length === 1 ? 'sticker' : 'stickers'}</span></div>
          <ul className="tool-choice-grid">
            {projects.map((project) => (
              <li key={project.id}>
                <button className="tool-choice-card" onClick={() => onOpen(project.id)} aria-label={`Open ${project.title}`}>
                  <ProjectThumb project={project} repo={repo} />
                  <span className="tool-choice-card-body">
                    <strong>{project.title}</strong>
                    <span>{project.layers.length} {project.layers.length === 1 ? 'layer' : 'layers'}<span className="tool-choice-open">Open sticker <ChevronLeft size={16} /></span></span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

export function ProjectEditor() {
  const { projectId } = useParams()
  const [params] = useSearchParams()
  return <EditorWorkspace projectId={projectId} intent={parseToolIntent(params.get('tool'))} />
}

function EditorWorkspace({ projectId, intent = null }: { projectId?: string; intent?: ToolIntent | null }) {
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

  return <EditorChrome document={document} urls={urls} intent={intent} />
}

function EditorChrome({ document, urls, intent }: { document: ProjectDocument; urls: Record<string, string>; intent: ToolIntent | null }) {
  const cloud = useWorkspace()?.cloud
  const cloudStatus = useCloudStatus()
  const fileRef = useRef<HTMLInputElement>(null)
  const [inspectorTab, updateInspectorTab] = useState(intent === 'effects' ? 'effects' : 'adjust')
  const setInspectorTab = (tab: string) => {
    // Radix can unmount a focused field before its blur handler runs.
    const state = useEditorStore.getState()
    if (!state.finishMaskStroke) state.commitGesture()
    updateInspectorTab(tab)
  }
  const [assetTab, setAssetTab] = useState(intent === 'text' ? 'stickers' : 'uploads')
  const [exportOpen, setExportOpen] = useState(intent === 'export')
  const [railFocus, setRailFocus] = useState<'erase' | 'rotate' | 'restore' | 'outline' | 'text' | 'stickers' | 'effects' | 'layers' | null>(
    intent === 'erase' ? 'erase' : intent === 'text' ? 'text' : intent === 'effects' ? 'effects' : null,
  )
  const [tipOpen, setTipOpen] = useState(true)
  useEffect(() => {
    const ui = { setInspectorTab: updateInspectorTab, setAssetTab, setExportOpen, setRailFocus }
    applyToolIntent(intent, ui)
    return subscribeToolIntent((requested) => applyToolIntent(requested, ui))
  }, [intent, document.id])
  const titleRef = useRef<HTMLInputElement>(null)
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

  const saveLabel = maskBusy && saveStatus !== 'save-failed'
    ? 'Mask edit pending'
    : cloud && !dirty && saveStatus === 'saved-locally'
      ? cloudStatus.state === 'synced' ? 'Saved to cloud' : cloudStatus.state === 'syncing' ? 'Saved locally · syncing' : 'Saved locally · cloud pending'
      : saveStatusLabel(saveStatus, dirty)
  const savedOk = saveStatus === 'saved-locally' && !dirty && !maskBusy

  return (
    <div className="editor-workspace" data-tool-intent={intent ?? undefined} data-active-tool={activeTool}>
      <aside className="tool-rail">
        <Link className="back-home" to="/"><ChevronLeft size={16} />Back to Home</Link>
        <button
          type="button"
          aria-pressed={activeTool === 'erase'}
          onClick={() => {
            setRailFocus('erase')
            useEditorStore.getState().setTool('erase')
            setInspectorTab('adjust')
          }}
        >
          <Scissors size={18} />Background Eraser
        </button>
        <button
          type="button"
          aria-pressed={activeTool === 'rotate'}
          onClick={() => {
            setRailFocus('rotate')
            useEditorStore.getState().setTool('rotate')
            setInspectorTab('adjust')
          }}
        >
          <Crop size={18} />Crop &amp; Rotate
        </button>
        <button
          type="button"
          aria-pressed={activeTool === 'restore'}
          onClick={() => {
            setRailFocus('restore')
            useEditorStore.getState().setTool('restore')
            setInspectorTab('adjust')
          }}
        >
          <Paintbrush size={18} />Brush / Restore
        </button>
        <button
          type="button"
          aria-pressed={railFocus === 'outline' && inspectorTab === 'adjust' && activeTool === 'select'}
          onClick={() => {
            setRailFocus('outline')
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
            setRailFocus('text')
            useEditorStore.getState().addTextLayer()
            setInspectorTab('adjust')
          }}
        >
          <Type size={18} />Text
        </button>
        <button
          type="button"
          aria-label="Stickers & decorations"
          aria-pressed={railFocus === 'stickers'}
          onClick={() => {
            setRailFocus('stickers')
            setAssetTab('stickers')
            trayRef.current?.scrollIntoView({ block: 'nearest' })
            trayRef.current?.focus({ preventScroll: true })
          }}
        >
          <Smile size={18} />Emoji &amp; Stickers
        </button>
        <button
          type="button"
          aria-pressed={inspectorTab === 'effects'}
          onClick={() => {
            setRailFocus('effects')
            useEditorStore.getState().setTool('select')
            setInspectorTab('effects')
          }}
        >
          <Sparkles size={18} />Filters &amp; Effects
        </button>
        <button
          type="button"
          aria-pressed={inspectorTab === 'layers'}
          onClick={() => {
            setRailFocus('layers')
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
        <div className="tool-rail-footer">
          {tipOpen ? (
            <div className="tool-tip-card">
              <strong><Lightbulb size={14} aria-hidden="true" /> Pro Tip</strong>
              <p>Use the brush tool to fine-tune edges for a cleaner sticker!</p>
              <button type="button" onClick={() => setTipOpen(false)}>Got it!</button>
            </div>
          ) : null}
          <div className="tool-mascot" aria-hidden="true">
            <img src="/art/stickers/04-winking-smiley.webp" alt="" width={52} height={52} />
            <p>Good stickers make a brighter day!</p>
          </div>
        </div>
      </aside>
      <div className="editor-stage">
        <section className="editor-top">
          <div className="editor-identity">
            <h1>
              <input
                ref={titleRef}
                className="title-input"
                aria-label="Sticker title"
                size={Math.max(document.title.length + 1, 8)}
                value={document.title}
                onFocus={() => useEditorStore.getState().beginGesture()}
                onChange={(event) => useEditorStore.getState().updateTitle(event.target.value)}
                onBlur={() => useEditorStore.getState().commitGesture()}
              />
              <Pencil size={16} aria-hidden="true" onClick={() => titleRef.current?.focus()} />
            </h1>
            <small className="save-status" data-state={saveStatus} role="status">
              {savedOk ? <Check size={14} aria-hidden="true" /> : null}
              {saveLabel}
              {saveStatus === 'save-failed' && saveError ? ` — ${saveError}` : ''}
            </small>
          </div>
          <div className="canvas-controls">
            <button type="button" aria-label="Zoom out" onClick={() => useEditorStore.getState().setViewport({ zoom: Math.max(0.25, Math.round((zoom - 0.1) * 10) / 10) })}>−</button>
            <b>{Math.round(zoom * 100)}%</b>
            <button type="button" aria-label="Zoom in" onClick={() => useEditorStore.getState().setViewport({ zoom: Math.min(4, Math.round((zoom + 0.1) * 10) / 10) })}>+</button>
            <button type="button" aria-pressed={activeTool === 'pan'} aria-label="Pan canvas" onClick={() => useEditorStore.getState().setTool(activeTool === 'pan' ? 'select' : 'pan')}>
              <Hand size={16} />
            </button>
            <button type="button" aria-label="Reset view" onClick={() => useEditorStore.getState().setViewport({ zoom: 1, panX: 0, panY: 0 })}>
              <Maximize2 size={16} />
            </button>
          </div>
          <div className="editor-actions">
            <Button onClick={saveNow} aria-label="Save to My Stickers">
              <CloudUpload size={16} />Save to My Stickers
            </Button>
            <ExportDialog document={document} open={exportOpen} onOpenChange={setExportOpen} />
          </div>
        </section>
        <div className="editor">
          <section className="canvas-area">
            <div className="canvas-workspace">
              <EditorArtboard urls={urls} />
              {document.layers.length === 0 ? (
                <div className="editor-welcome">
                  <img src="/art/stickers/04-winking-smiley.webp" alt="" width={72} height={72} />
                  {(() => {
                    const empty = toolEmptyCopy(intent, false, false)
                    return (
                      <>
                        <h2>{empty?.title ?? 'A blank canvas. Endless you.'}</h2>
                        <p>{empty?.body ?? 'Drop in a little personality. Start with a photo, then make it your own.'}</p>
                      </>
                    )
                  })()}
                  <Button className="primary" onClick={() => fileRef.current?.click()}><Upload size={16} />Upload a photo</Button>
                  {intent === 'text' ? (
                    <Button onClick={() => { useEditorStore.getState().addTextLayer(); setInspectorTab('adjust') }}>
                      <Type size={16} />Add text
                    </Button>
                  ) : null}
                  <small>PNG, JPEG or WebP · up to 15 MB</small>
                </div>
              ) : null}
            </div>
          </section>
          <Inspector document={document} selected={selected} urls={urls} tab={inspectorTab} onTabChange={setInspectorTab} />
        </div>
        <AssetTray urls={urls} fileRef={fileRef} onUpload={onUpload} uploadError={uploadError} document={document}
          tab={assetTab} onTabChange={setAssetTab} trayRef={trayRef}
          onAddText={(style) => { useEditorStore.getState().addTextLayer(style); setInspectorTab('adjust') }} />
      </div>
      <PropertiesDialog document={document} selected={selected} urls={urls} tab={inspectorTab} onTabChange={setInspectorTab} />
    </div>
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
  urls,
  tab,
  onTabChange,
}: {
  document: ProjectDocument
  selected: Layer | undefined
  urls: Record<string, string>
  tab?: string
  onTabChange?: (tab: string) => void
}) {
  return (
    <Dialog onOpenChange={(open) => { if (!open) useEditorStore.getState().commitGesture() }}>
      <DialogTrigger asChild>
        <Button className="properties-toggle">Sticker properties</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Sticker properties</DialogTitle>
        <DialogDescription>Fine-tune your selected layer.</DialogDescription>
        <Inspector document={document} selected={selected} urls={urls} tab={tab} onTabChange={onTabChange} />
      </DialogContent>
    </Dialog>
  )
}

function Inspector({
  document,
  selected,
  urls,
  tab = 'adjust',
  onTabChange,
}: {
  document: ProjectDocument
  selected: Layer | undefined
  urls: Record<string, string>
  tab?: string
  onTabChange?: (tab: string) => void
}) {
  const activeTool = useEditorStore((state) => state.activeTool)
  return (
    <aside className="inspector">
      <h2>Sticker Properties</h2>
      {selected?.kind === 'image' ? <ImageLayerCard layer={selected} urls={urls} /> : null}
      <Tabs.Root value={tab} onValueChange={onTabChange}>
        <Tabs.List>
          <Tabs.Trigger value="adjust">Adjust</Tabs.Trigger>
          <Tabs.Trigger value="effects">Effects</Tabs.Trigger>
          <Tabs.Trigger value="position">Position</Tabs.Trigger>
          <Tabs.Trigger value="layers">Layers</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="adjust">
          {(activeTool === 'erase' || activeTool === 'restore') && selected?.kind !== 'image' ? (
            <p className="muted">Upload or select a photo to erase its background. Automatic removal is not available and nothing has been changed yet.</p>
          ) : null}
          {!selected && activeTool !== 'erase' && activeTool !== 'restore' ? <p className="muted">Select a layer to edit its properties.</p> : null}
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
            <p className="muted">Select an image layer to adjust brightness, contrast, saturation, and grayscale filters. No effect has been applied yet.</p>
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

function ImageLayerCard({ layer, urls }: { layer: Extract<Layer, { kind: 'image' }>; urls: Record<string, string> }) {
  const replacementInput = useRef<HTMLInputElement>(null)
  const [replacing, setReplacing] = useState(false)
  const asset = useEditorStore((state) => state.assets[layer.assetId]?.asset)
  const store = useEditorStore.getState
  return (
    <div className="layer-card">
      <img className="layer-card-thumb" alt="" src={urls[layer.assetId]} />
      <div className="layer-card-meta">
        <strong>{layer.name}</strong>
        <small>{asset ? `${asset.width} × ${asset.height}` : 'Image layer'}</small>
      </div>
      <div className="layer-card-actions">
        <Button title="Keeps position, rotation, and effects; resets crop and erasure. Backgrounds are not removed automatically." disabled={layer.locked || replacing} onClick={() => replacementInput.current?.click()}>{replacing ? 'Replacing…' : 'Replace photo'}</Button>
        <Button className="layer-delete" aria-label={`Delete ${layer.name}`} onClick={() => { store().selectLayer(layer.id); store().removeSelected() }}><Trash2 size={14} />Delete</Button>
      </div>
      <input ref={replacementInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Replacement photo" hidden onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setReplacing(true)
        void ingestIntoCurrentProject(() => ingestImageFile(file), undefined, layer.id).finally(() => setReplacing(false))
      }} />
    </div>
  )
}

function ImageInspector({ layer }: { layer: Extract<Layer, { kind: 'image' }> }) {
  const outline = layer.outline ?? { enabled: false, color: '#ffffff', width: 12 }
  const brushSize = useEditorStore((state) => state.brushSize)
  const activeTool = useEditorStore((state) => state.activeTool)
  const store = useEditorStore.getState
  return (
    <div className="inspector-fields">
      <label className="inspector-toggle">
        Outline
        <input
          className="inspector-switch"
          type="checkbox"
          aria-label="Toggle silhouette outline"
          checked={outline.enabled}
          onChange={(e) => store().updateOutline(layer.id, { enabled: e.target.checked })}
        />
      </label>
      <label className="inspector-color">
        <span>Color</span>
        <span className="inspector-color-value">
          <input
            type="color"
            aria-label="Outline color"
            value={outline.color}
            disabled={!outline.enabled}
            onChange={(e) => store().updateOutline(layer.id, { color: e.target.value })}
          />
          <code>{outline.color.toUpperCase()}</code>
        </span>
      </label>
      <label>
        <span>Thickness</span>
        <span className="inspector-slider-value">
          <Slider
            aria-label="Outline thickness"
            min={2}
            max={40}
            value={[outline.width]}
            disabled={!outline.enabled}
            onPointerDown={(e) => {
              if (e.button === 0) store().beginGesture()
            }}
            onPointerUp={() => store().commitGesture()}
            onPointerCancel={() => store().commitGesture()}
            onLostPointerCapture={() => store().commitGesture()}
            onValueCommit={() => store().commitGesture()}
            onValueChange={(val) => store().updateOutline(layer.id, { width: val[0] ?? 12 })}
          />
          <small>{outline.width} px</small>
        </span>
      </label>
      <p className="muted inspector-help">
        The outline follows visible pixels. An opaque photo outlines its rectangle; use Erase to make a cutout.
      </p>

      <div className="inspector-section">
        <b>Flip &amp; Rotate</b>
        <div className="button-row flip-row">
          <Button onClick={() => store().flipSelected('horizontal')}><FlipHorizontal2 size={14} />Flip H</Button>
          <Button onClick={() => store().flipSelected('vertical')}><FlipVertical2 size={14} />Flip V</Button>
          <Button onClick={() => store().rotateSelected90()}><RotateCw size={14} />Rotate 90°</Button>
        </div>
      </div>

      <div className="inspector-section">
        <b>Background</b>
        <p className="muted" style={{ fontSize: 12 }}>Automatic background removal is not available. Erase and Restore edit a mask; the original photo stays unchanged.</p>
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
      </div>

      {(activeTool === 'erase' || activeTool === 'restore') && (
        <label>
          <span>Brush size</span>
          <span className="inspector-slider-value">
            <Slider
              aria-label="Brush size"
              min={4}
              max={120}
              value={[brushSize]}
              onValueChange={(val) => store().setBrushSize(val[0] ?? 30)}
            />
            <small>{brushSize} px</small>
          </span>
        </label>
      )}
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
        Adjust photo tone on this image layer. Compose order: crop → mask → filters → silhouette outline → opacity → position. Zoom and pan do not change the sticker. Preview, save, PNG, and ZIP use this same order.
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
        <div className="asset-tray-head">
          <Tabs.List aria-label="Asset types">
            <Tabs.Trigger value="uploads">Recent Uploads</Tabs.Trigger>
            <Tabs.Trigger value="stickers">Stickers</Tabs.Trigger>
            <Tabs.Trigger value="text">Text styles</Tabs.Trigger>
          </Tabs.List>
          <button type="button" className="asset-view-all" onClick={() => onTabChange('stickers')}>View All</button>
        </div>
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
          <p className="muted asset-note">These are image layers, not editable text and not an OS emoji font. Lettering in a cutout stays part of the picture; use Text styles for words you can type.</p>
          <StickerCatalog />
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

function StickerCatalog() {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const matches = needle ? STICKER_CATALOG.filter((asset) => asset.name.toLowerCase().includes(needle)) : STICKER_CATALOG
  return (
    <>
      <label className="filter-search asset-search">
        <Search size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search stickers and decorations"
          placeholder="Search stickers…"
        />
      </label>
      {matches.length === 0 ? (
        <p className="muted asset-note" role="status">No stickers match that search. Try another word — nothing was added.</p>
      ) : (
        <div className="asset-items">
          {matches.map((asset) => <SampleButton key={asset.src} {...asset} />)}
        </div>
      )}
    </>
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

function ExportDialog({
  document,
  open,
  onOpenChange,
}: {
  document: ProjectDocument
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [size, setSize] = useState<ExportSize>(1024)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [canShare, setCanShare] = useState(false)
  useEffect(() => {
    setCanShare(typeof navigator.share === 'function')
  }, [])
  const exportPng = async (share: boolean) => {
    setBusy(true)
    setMessage('Exporting…')
    try {
      await useEditorStore.getState().finishMaskStroke?.()
      const state = useEditorStore.getState()
      if (state.document?.id !== document.id) throw new Error('The open project changed. Reopen export to continue.')
      const blob = await renderDocument(state.document, state.assets, { size, masks: state.masks, bounds: 'artwork' })
      if (useEditorStore.getState().workspaceEpoch !== state.workspaceEpoch) throw new Error('Export canceled because the workspace changed.')
      const safeTitle = document.title.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'sticker'
      const filename = `${safeTitle}-${size}.png`
      if (share && typeof navigator.share === 'function') {
        try {
          const file = new File([blob], filename, { type: 'image/png' })
          const payload = { files: [file], title: document.title, text: 'StickerLab PNG. This is not a WhatsApp or Telegram sticker pack.' }
          if (!navigator.canShare || navigator.canShare(payload)) {
            await navigator.share(payload)
            setMessage('Share sheet opened. This is not a WhatsApp or Telegram install. You can still download a PNG if you cancel.')
            return
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            setMessage('Share cancelled. Download a PNG if you still want the file.')
            return
          }
        }
      }
      downloadBlob(blob, filename)
      setMessage('Download started. Check your browser downloads to confirm the file was saved. This is not a WhatsApp or Telegram sticker pack.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="primary" aria-label="Export and share">
          <Download />Export &amp; Share
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Export sticker</DialogTitle>
        <DialogDescription>
          Download a transparent PNG cropped to the outermost visible artwork, including outlines. The selected size caps the longest edge; aspect ratio is preserved. Hidden layers, checkerboard, selection handles, and zoom are not included. This is not a WhatsApp or Telegram sticker pack.
        </DialogDescription>
        <div className="export-sizes">
          <label>
            <input type="radio" name="export-size" checked={size === 512} onChange={() => setSize(512)} />
            Up to 512 px longest edge
          </label>
          <label>
            <input type="radio" name="export-size" checked={size === 1024} onChange={() => setSize(1024)} />
            Up to 1024 px longest edge
          </label>
        </div>
        <DialogFooter>
          <NoticeDialog title="Messenger packs are not available" trigger={<Button>WhatsApp / Telegram</Button>}>
            Native WhatsApp and Telegram installation is not implemented. Download a PNG and add it in those apps manually if they accept image stickers.
          </NoticeDialog>
          {canShare ? (
            <Button disabled={busy} onClick={() => void exportPng(true)}>Share PNG</Button>
          ) : null}
          <Button className="primary" disabled={busy} onClick={() => void exportPng(false)}>
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
