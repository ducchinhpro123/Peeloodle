import { lazy } from 'react'

export const CreateEditor = lazy(() => import('../features/editor/EditorPage').then((module) => ({ default: module.CreateEditor })))
export const ProjectEditor = lazy(() => import('../features/editor/EditorPage').then((module) => ({ default: module.ProjectEditor })))
export const PresentationsPage = lazy(() => import('../features/presentations/library/PresentationsPage'))
export const PresentationEditorPage = lazy(() => import('../features/presentations/editor/PresentationEditorPage'))

export const preloadEditor = () => { void import('../features/editor/EditorPage') }
