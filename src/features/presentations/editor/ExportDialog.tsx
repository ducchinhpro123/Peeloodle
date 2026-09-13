/**
 * Export dialog (P40). The page owns the export controller; this shows the two
 * formats, live progress, cancellation while work is running, and any preflight
 * warnings that should be read before relying on the file.
 */

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import type { PresentationExportFormat, PresentationExportState } from './usePresentationExport'

export function ExportDialog({
  state,
  onExport,
  onCancel,
}: {
  state: PresentationExportState
  onExport: (format: PresentationExportFormat) => void
  onCancel: () => void
}) {
  const busy = state.phase === 'preparing' || state.phase === 'rendering'

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button><Download size={16} aria-hidden="true" /> Export</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Export presentation</DialogTitle>
        <DialogDescription>PDF keeps the exact slide visuals as fixed pages; PPTX keeps text, shapes and pictures editable. Both include every slide in order.</DialogDescription>
        <div className="presentation-export-actions">
          <Button disabled={busy} onClick={() => onExport('pdf')}>Export PDF</Button>
          <Button disabled={busy} onClick={() => onExport('pptx')}>Export PPTX</Button>
          <Button disabled={busy} onClick={() => onExport('backup')}>Download backup (.zip)</Button>
          {busy ? <Button onClick={onCancel}>Cancel export</Button> : null}
        </div>
        <p className="muted">The backup is a .stickerlab.zip with the document and every image, restorable from the presentation library on any device.</p>
        {busy ? (
          <p role="status">
            {state.phase === 'preparing'
              ? 'Preparing artwork and fonts…'
              : `Rendering slides… ${state.completed}/${state.total}`}
          </p>
        ) : null}
        {state.phase === 'done' ? <p role="status">Export ready. Check your browser’s downloads for the file.</p> : null}
        {state.phase === 'cancelled' ? <p role="status">The export was cancelled. No file was produced.</p> : null}
        {state.phase === 'failed' && state.message ? <p role="alert">{state.message}</p> : null}
        {state.warnings.length > 0 ? (
          <div className="presentation-export-warnings">
            <p>Before you rely on this export:</p>
            <ul>
              {state.warnings.map((warning) => (
                <li key={`${warning.code}-${warning.elementId}`}>{warning.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
