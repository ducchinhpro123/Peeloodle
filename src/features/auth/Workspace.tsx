import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createClient, type Session } from '@supabase/supabase-js'
import type { Database } from '../../types/database'
import { useNavigate } from 'react-router-dom'
import { RepositoryProvider } from '../../app/repository'
import { getLocalRepository, type StickerLabRepository } from '../../lib/persistence/repository'
import { CloudRepository, type CloudStatus } from '../../lib/persistence/cloud'
import { SupabaseRemote } from '../../lib/persistence/cloudRemote'
import { useEditorStore } from '../editor/store'
import { getAuthClient, readCloudConfig } from './client'
import { Button } from '../../components/ui'

const guestStatus: CloudStatus = { state: 'synced', pending: 0, error: null, notices: [], version: 0, conflicts: {} }
const noopSubscribe = () => () => undefined
const guestSnapshot = () => guestStatus
export type Workspace = { session: Session | null; repository: StickerLabRepository; cloud: CloudRepository | null; epoch: number }
const WorkspaceContext = createContext<Workspace | null>(null)
export function useWorkspace() { return useContext(WorkspaceContext) }
export function useCloudStatus() {
  const cloud = useWorkspace()?.cloud
  return useSyncExternalStore(cloud?.subscribe ?? noopSubscribe, cloud?.getStatus ?? guestSnapshot)
}

export async function flushWorkspace(repository: StickerLabRepository) {
  if (useEditorStore.getState().document) {
    const { flushEditor } = await import('../editor/EditorPage')
    await flushEditor(repository)
  }
}

export function WorkspaceProvider({ repository, children }: { repository?: StickerLabRepository; children: ReactNode }) {
  const auth = repository ? null : getAuthClient()
  const initial = useRef<Workspace>({ session: null, repository: repository ?? getLocalRepository(), cloud: null, epoch: 0 })
  const current = useRef(initial.current)
  const [workspace, setWorkspace] = useState<Workspace | null>(auth ? null : initial.current)
  const ready = useRef(!auth)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    if (!auth) return
    let live = true
    let sequence = 0
    let tail = Promise.resolve()
    const switchTo = (session: Session | null) => {
      if (current.current.session?.user.id === session?.user.id && ready.current) {
        current.current = { ...current.current, session }
        setWorkspace(current.current)
        return
      }
      const request = ++sequence
      const previous = current.current
      previous.cloud?.dispose()
      // Stop rendering the old account before any new workspace can mount.
      ready.current = false
      setWorkspace(null)
      tail = tail.then(async () => {
        if (!live || request !== sequence) return
        await flushWorkspace(previous.repository)
        if (!live || request !== sequence) return
        useEditorStore.getState().reset()
        const config = readCloudConfig()
        let cloud: CloudRepository | null = null
        if (session && config) {
          const ownerId = session.user.id
          const scoped = createClient<Database>(config.url, config.key, {
            accessToken: async () => {
              const { data } = await auth.auth.getSession()
              if (current.current.cloud !== cloud || current.current.session?.user.id !== ownerId || data.session?.user.id !== ownerId) throw new Error('Session changed. Sign in to the originating account to retry.')
              return data.session.access_token
            },
          })
          cloud = new CloudRepository(`stickerlab-account-${ownerId}`, new SupabaseRemote(scoped, ownerId))
        }
        const next: Workspace = { session, repository: cloud ?? getLocalRepository(), cloud, epoch: previous.epoch + 1 }
        current.current = next
        setError(null)
        ready.current = true
        setWorkspace(next)
        if (previous.epoch > 0 && previous.session?.user.id !== session?.user.id && !window.location.pathname.startsWith('/auth/')) {
          const path = window.location.pathname
          // Keep the editor open when switching sessions or restoring within an account.
          if (!path.startsWith('/editor/')) navigate('/my-stickers', { replace: true })
        }
        void cloud?.refresh()
      }).catch(() => { if (live) setError('Your draft could not be saved locally. The workspace is locked and the draft is retained in memory. Free device storage, then retry; do not close this tab.') })
    }
    const { data: listener } = auth.auth.onAuthStateChange((_event, session) => { if (live) switchTo(session) })
    void auth.auth.getSession().then(({ data, error: sessionError }) => {
      if (!live || sequence) return
      if (sessionError) setError('Session restoration failed. Reconnect and retry.')
      else switchTo(data.session)
    })
    const online = () => { void current.current.cloud?.refresh() }
    window.addEventListener('online', online)
    return () => { live = false; listener.subscription.unsubscribe(); window.removeEventListener('online', online) }
    // Workspace switches are serialized from Auth events, not from React renders.
  }, [auth, navigate, retry])

  if (!workspace) return <section className="empty"><h1>Opening private workspace</h1><p role={error ? 'alert' : 'status'}>{error ?? 'Preserving local work and restoring your session…'}</p>{error ? <Button onClick={() => setRetry((value) => value + 1)}>Retry local save and session</Button> : null}</section>
  return <WorkspaceContext.Provider value={workspace}><RepositoryProvider repository={workspace.repository}><div key={workspace.epoch}>{children}</div></RepositoryProvider></WorkspaceContext.Provider>
}
