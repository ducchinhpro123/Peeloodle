import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { getLocalRepository } from '../../lib/persistence/repository'
import { getAuthClient, readCloudConfig, safeReturnPath } from './client'
import { flushWorkspace, useCloudStatus, useWorkspace } from './Workspace'

export function Account() {
  const workspace = useWorkspace()
  const status = useCloudStatus()
  const cloudReady = !!readCloudConfig()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guestCount, setGuestCount] = useState(0)
  const session = workspace?.session
  useEffect(() => {
    if (sessionStorage.getItem('stickerlab-session-expired')) {
      sessionStorage.removeItem('stickerlab-session-expired')
      setError('Session expired. Your local edits are kept on this device. Sign in again to sync.')
      setOpen(true)
    }
  }, [])
  useEffect(() => {
    let live = true
    if (session) void Promise.all([getLocalRepository().listProjects(), getLocalRepository().listPacks()]).then(([projects, packs]) => {
      if (!live) return
      setGuestCount(projects.length + packs.length)
      if ((projects.length || packs.length) && localStorage.getItem(`stickerlab-import-choice:${session.user.id}`) !== 'later') setOpen(true)
    }).catch(() => { if (live) setError('Could not inspect guest work. It has not been uploaded.') })
    return () => { live = false }
  }, [session?.user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null)
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : 'The request failed. Please retry.') } finally { setBusy(false) }
  }
  const requestLink = async () => {
    if (!workspace) return
    const auth = await getAuthClient()
    if (!auth) throw new Error('Cloud sign-in is not configured for this origin.')
    await flushWorkspace(workspace.repository)
    sessionStorage.setItem('stickerlab-auth-return', safeReturnPath(location.pathname))
    const { error } = await auth.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
    if (error) throw new Error(error.status === 429 ? 'Too many requests. Wait before requesting another link.' : `Could not request a link: ${error.message}`)
    setMessage('Sign-in email requested. Check your inbox and spam folder; delivery is not guaranteed. Open the newest link in this browser. You can retry if it does not arrive.')
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button className="profile" aria-label={session ? `Account: ${session.user.email}` : 'Guest account'}><span aria-hidden="true">{session?.user.email?.slice(0, 1).toUpperCase() ?? 'G'}</span><b>{session ? 'Account' : 'Guest'}</b><ChevronDown size={15} aria-hidden="true" /></Button></DialogTrigger>
    <DialogContent>
      <DialogTitle>{session ? 'Your private workspace' : 'Sign in to StickerLab'}</DialogTitle>
      <DialogDescription>{session ? session.user.email : 'Guest editing stays on this device. Sign in by email to save a private cloud copy.'}</DialogDescription>
      {!cloudReady ? <p>Cloud saving is not configured for this site. Local editing, saving, and export still work. See the cloud setup guide for public configuration and approved callback origins.</p> : session ? <>
        <p>Account caches are kept separately on this browser. Signing out hides them in the app; they are not encrypted against someone controlling this device.</p>
        <p role="status">{status.error ?? (status.state === 'synced' ? 'Saved to cloud' : status.state === 'syncing' ? 'Syncing saved work…' : 'Saved locally · cloud pending')}</p>
        {status.notices.map((notice) => <p key={notice}>{notice} <Link to="/my-stickers" onClick={() => setOpen(false)}>Review stickers and packs</Link></p>)}
        <Button disabled={busy} onClick={() => void run(async () => { await workspace?.cloud?.refresh() })}>Refresh cloud / retry sync</Button>
        {guestCount > 0 ? <section>
          <h3>Import guest work?</h3><p>{guestCount} guest stickers and packs are on this device. Copy stickers, required photos, masks, and ordered packs to this account only if you choose. Originals are kept; retries resume safely.</p>
          <div className="button-row">
            <Button disabled={busy} onClick={() => { localStorage.setItem(`stickerlab-import-choice:${session.user.id}`, 'later'); setOpen(false) }}>Not now</Button>
            <Button className="primary" disabled={busy} onClick={() => void run(async () => {
              await workspace?.cloud?.importGuest(getLocalRepository(), session.user.id, setMessage)
              localStorage.setItem(`stickerlab-import-choice:${session.user.id}`, 'later')
            })}>Import guest collection / retry</Button>
          </div>
        </section> : null}
        <p className="muted">Favorites remain browser-local and do not synchronize. Public sharing is not available.</p>
        <DialogFooter><DialogClose asChild><Button>Close</Button></DialogClose><Button disabled={busy} onClick={() => void run(async () => {
          if (workspace) await flushWorkspace(workspace.repository)
          setOpen(false)
          sessionStorage.setItem('stickerlab-signing-out', '1')
          const auth = await getAuthClient()
          if (!auth) return
          const { error } = await auth.auth.signOut({ scope: 'local' })
          if (error) {
            sessionStorage.removeItem('stickerlab-signing-out')
            throw error
          }
        })}>Sign out</Button></DialogFooter>
      </> : <form onSubmit={(event) => { event.preventDefault(); void run(requestLink) }}>
        <div className="dialog-field"><label htmlFor="account-email">Email address</label><input id="account-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
        <p className="muted">Signing in will not upload your guest photos. You choose whether to import them afterward.</p>
        <DialogFooter><DialogClose asChild><Button>Keep editing locally</Button></DialogClose><Button type="submit" className="primary" disabled={busy}>{busy ? 'Requesting…' : 'Request sign-in link'}</Button></DialogFooter>
      </form>}
      {message ? <p role="status">{message}</p> : null}{error ? <p role="alert">{error}</p> : null}
    </DialogContent>
  </Dialog>
}

export function CloudBanner() {
  const workspace = useWorkspace()
  const status = useCloudStatus()
  if (!workspace?.cloud) return null
  return <section className="cloud-banner" aria-label="Cloud synchronization">
    <span role="status">{status.error ?? (status.state === 'syncing' ? 'Syncing saved work…' : status.state === 'pending' ? 'Saved locally · cloud pending' : 'Saved work is backed up to your private account.')}</span>
    {status.notices.length ? <Link to="/my-stickers">{status.notices.at(-1)} Review copies</Link> : null}
    <Button onClick={() => void workspace.cloud?.refresh()}>Refresh / retry cloud</Button>
  </section>
}

export function AuthCallback() {
  const navigate = useNavigate()
  const [code] = useState(() => new URLSearchParams(window.location.search).get('code'))
  const [badLink] = useState(() => new URLSearchParams(window.location.hash.slice(1)).has('error') || new URLSearchParams(window.location.search).has('error'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { window.history.replaceState(window.history.state, '', '/auth/callback') }, [])
  return <section className="empty"><h1>Finish signing in</h1>
    <p>Continue only if you requested a StickerLab sign-in link in this browser. Guest work is kept locally.</p>
    {!code || badLink ? <p role="alert">This sign-in link is missing, expired, invalid, or already used. Request a fresh link from Account.</p> : <Button disabled={busy} className="primary" onClick={async () => {
      setBusy(true)
      try {
        const auth = await getAuthClient()
        if (!auth) throw new Error('Cloud sign-in is not configured for this origin.')
        const { error } = await auth.auth.exchangeCodeForSession(code)
        if (error) throw new Error('This link could not be used. It may be expired, already used, or opened in another browser. Request a fresh link.')
        const destination = safeReturnPath(sessionStorage.getItem('stickerlab-auth-return'))
        sessionStorage.removeItem('stickerlab-auth-return')
        // Guest IDs are intentionally not opened in an account before explicit import.
        navigate(destination.startsWith('/editor/') ? '/my-stickers' : destination, { replace: true })
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed. Request a new link.') } finally { setBusy(false) }
    }}>Continue sign-in</Button>}
    {error ? <p role="alert">{error}</p> : null}<Account /><Link to="/">Return to local editing</Link>
  </section>
}
