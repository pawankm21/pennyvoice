import { useEffect, useRef, useState } from 'react'
import { signIn } from './auth'
import type { User } from './auth'
import Icon from './Icon'
export default function AuthDialog({ open, onClose, onSignedIn }: { open: boolean; onClose: () => void; onSignedIn: (user: User) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  function close() { if (!busy) { setPassword(''); setError(''); onClose() } }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try { const user = await signIn(mode, email, password); setPassword(''); onSignedIn(user); onClose() }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to sign in.') }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="review-dialog auth-dialog" aria-labelledby="auth-title" onCancel={event => { event.preventDefault(); close() }}>
    <div className="review-heading"><span className="review-icon"><Icon name="wallet" size={24} /></span><button className="icon-button" aria-label="Close sign in" disabled={busy} onClick={close}><Icon name="close" /></button></div>
    <h2 id="auth-title">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
    <div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} disabled={busy} onClick={() => { setMode('login'); setError(''); setPassword('') }}>Sign in</button><button className={mode === 'register' ? 'active' : ''} disabled={busy} onClick={() => { setMode('register'); setError(''); setPassword('') }}>Sign up</button></div>
    {error && <p className="alert" role="alert">{error}</p>}
    <form onSubmit={submit}><label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label><label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={12} maxLength={72} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>{mode === 'register' && <p className="note">12+ characters. No bank details required.</p>}<button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}<Icon name="arrow" size={18} /></button></form>
  </dialog>
}
