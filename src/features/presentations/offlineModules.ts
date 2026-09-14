/**
 * The modules the presentation flow needs to keep working after the connection drops.
 *
 * A static host serves each of these as its own chunk and cannot serve it again once
 * the network is gone, so readiness fetches them while the connection is there. The
 * list is explicit because the canvas is a lazy child of the editor route: opening
 * the editor is not enough to have it in memory.
 */
import { EXPORT_BUILDER_LOADERS } from './exports/loaders'

export const PRESENTATION_OFFLINE_MODULES = [
  () => import('./library/PresentationsPage'),
  () => import('./editor/PresentationEditorPage'),
  () => import('./editor/PresentationCanvas'),
  ...EXPORT_BUILDER_LOADERS,
] as const
