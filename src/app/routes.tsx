import { Suspense, type ReactNode } from 'react'
import { Outlet, createBrowserRouter, type RouteObject } from 'react-router-dom'
import { PresentationRepositoryProvider } from './presentationRepository'
import { WorkspaceProvider } from '@/features/auth/Workspace'
import { AuthCallback } from '@/features/auth/Account'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { PacksPage } from '@/features/packs/PacksPage'
import { TemplatesPage } from '@/features/templates/TemplatesPage'
import { CreateEditor, PresentationEditorPage, PresentationsPage, ProjectEditor } from './routeModules'
import { Shell } from './Shell'
import type { StickerLabRepository } from '@/lib/persistence/repository'
import type { PresentationRepository } from '@/lib/persistence/presentations/repository'

export type AppRouteOptions = {
  repository?: StickerLabRepository
  presentationRepository?: PresentationRepository
}

const editorFallback = <p className="muted" style={{ padding: 24 }}>Opening sticker…</p>
const presentationFallback = <p className="muted route-fallback">Opening presentations…</p>

function EditorLayout({ children, fallback = editorFallback }: { children: ReactNode; fallback?: ReactNode }) {
  return <Shell editor><Suspense fallback={fallback}>{children}</Suspense></Shell>
}

function AppProviders({ repository, presentationRepository }: AppRouteOptions) {
  return (
    <PresentationRepositoryProvider repository={presentationRepository}>
      <WorkspaceProvider repository={repository}>
        <Outlet />
      </WorkspaceProvider>
    </PresentationRepositoryProvider>
  )
}

export function createAppRoutes({ repository, presentationRepository }: AppRouteOptions = {}): RouteObject[] {
  return [
    {
      element: <AppProviders repository={repository} presentationRepository={presentationRepository} />,
      children: [
        { path: '/auth/callback', element: <AuthCallback /> },
        { path: '/', element: <DashboardPage /> },
        { path: '/create', element: <EditorLayout><CreateEditor /></EditorLayout> },
        { path: '/editor/:projectId', element: <EditorLayout><ProjectEditor /></EditorLayout> },
        { path: '/presentations', element: <Shell><Suspense fallback={presentationFallback}><PresentationsPage /></Suspense></Shell> },
        { path: '/presentations/:presentationId', element: <EditorLayout fallback={presentationFallback}><PresentationEditorPage /></EditorLayout> },
        { path: '/templates', element: <TemplatesPage /> },
        { path: '/my-stickers', element: <PacksPage /> },
        { path: '*', element: <DashboardPage /> },
      ],
    },
  ]
}

export function createAppRouter(options: AppRouteOptions = {}) {
  return createBrowserRouter(createAppRoutes(options))
}
