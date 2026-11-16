export interface User { id: string; email: string }
interface Session { user: User; accessToken: string; expiresAt: string }
const hintKey = 'pennyvoice-account'
const logoutKey = 'pennyvoice-signed-out'
let session: Session | null = null
let refreshing: Promise<User | null> | undefined
let generation = 0
export function cachedUser(): User | null {
  try {
    if (localStorage.getItem(logoutKey) === 'true') return null
    const value = JSON.parse(localStorage.getItem(hintKey) ?? 'null')
    return value && typeof value.email === 'string' && typeof value.id === 'string' && /^[0-9a-f-]{36}$/i.test(value.id) ? value : null
  } catch { return null }
}
function remember(user: User | null) {
  try { if (user) { localStorage.removeItem(logoutKey); localStorage.setItem(hintKey, JSON.stringify(user)) } else localStorage.removeItem(hintKey) } catch { /* Local ledger still works if profile hints cannot persist. */ }
}
export async function authRequest(path: string, body?: object): Promise<unknown> {
  const options: RequestInit = { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) }
  if (body !== undefined) {
    const response = await fetch('/api/auth/csrf', options)
    if (!response.ok) throw new Error('Sign-in service is unavailable.')
    const csrf = await response.json()
    if (typeof csrf.token !== 'string' || csrf.headerName !== 'X-XSRF-TOKEN') throw new Error('Invalid sign-in response.')
    options.method = 'POST'; options.headers = { 'Content-Type': 'application/json', [csrf.headerName]: csrf.token }; options.body = JSON.stringify(body)
    options.signal = AbortSignal.timeout(8000)
  }
  const response = await fetch(`/api/auth/${path}`, options)
  if (!response.ok) {
    if (response.status === 401) throw new Error(path === 'login' ? 'Email or password is incorrect.' : 'Sign in again to sync. Local entries are safe.')
    if (response.status === 409) throw new Error('Account could not be created. Try signing in instead.')
    if (response.status === 429) throw new Error('Too many attempts. Try again in a minute.')
    throw new Error(response.status === 400 ? 'Check your email and password. Passwords need 12 characters and at most 72 UTF-8 bytes.' : 'Account service unavailable. Local entries are safe.')
  }
  return response.status === 204 ? null : await response.json()
}
function accept(value: unknown): Session {
  if (!value || typeof value !== 'object') throw new Error('Invalid account response.')
  const data = value as Session
  if (!data.user || typeof data.user.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.user.id) || typeof data.user.email !== 'string' || typeof data.accessToken !== 'string' || data.accessToken.split('.').length !== 3 || !Number.isFinite(Date.parse(data.expiresAt))) throw new Error('Invalid account response.')
  return data
}
function authLock<T>(action: () => Promise<T>): Promise<T> {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('pennyvoice-auth', action) : action()
}
export function forgetAccessSession() { generation++; session = null }
export async function signIn(mode: 'login' | 'register', email: string, password: string): Promise<User> {
  const current = ++generation
  const result = await authLock(async () => {
    if (localStorage.getItem(logoutKey) === 'true') await authRequest('logout', {})
    return accept(await authRequest(mode, { email: email.trim(), password }))
  })
  if (current !== generation) throw new Error('Account changed. Please try again.')
  session = result; remember(result.user)
  return result.user
}
export function restoreSession(fresh = false): Promise<User | null> {
  if (refreshing) return fresh ? refreshing.then(() => restoreSession()) : refreshing
  const current = generation
  refreshing = authLock(async () => {
    try {
      if (localStorage.getItem(logoutKey) === 'true') {
        await authRequest('logout', {}); localStorage.removeItem(logoutKey); return null
      }
      const result = accept(await authRequest('refresh', {}))
      if (current !== generation) return cachedUser()
      session = result; remember(result.user); return result.user
    } catch (error) {
      if (current !== generation) return cachedUser()
      session = null
      if (error instanceof Error && error.message.startsWith('Sign in again')) { remember(null); return null }
      // Cached identity selects offline data only; it never authorizes a server request.
      return cachedUser()
    }
  }).finally(() => { refreshing = undefined })
  return refreshing
}
export async function accessToken(owner: string): Promise<string> {
  if (!session || Date.parse(session.expiresAt) < Date.now() + 30000) await restoreSession()
  if (!session || session.user.id !== owner) throw new Error('Sign in again to sync. Local entries are safe.')
  return session.accessToken
}
export async function signOut(): Promise<void> {
  generation++; session = null
  try { localStorage.setItem(logoutKey, 'true') } catch { /* Session is still cleared in memory. */ }
  remember(null)
  try { await authLock(() => authRequest('logout', {})); localStorage.removeItem(logoutKey) }
  catch { throw new Error('Signed out locally. Server sign-out will retry when online.') }
}
