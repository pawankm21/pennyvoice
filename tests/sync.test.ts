import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { appendEntries, readEntries } from '../src/storage.ts'
import { syncEntries } from '../src/sync.ts'
import { signIn, accessToken, cachedUser, signOut, restoreSession, forgetAccessSession } from '../src/auth.ts'
import type { Entry } from '../src/ledger.ts'
const values = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } })
const owner = crypto.randomUUID(), other = crypto.randomUUID()
const token = 'mock.jwt.signature'
const entry: Entry = { id: crypto.randomUUID(), kind: 'expense', amountPaise: 5000, date: '2026-11-16', description: 'Lunch', person: '' }
await appendEntries([entry], false, owner)
const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async url => String(url).endsWith('/csrf') ? Response.json({ token: 'csrf', headerName: 'X-XSRF-TOKEN' }) : Response.json({ user: { id: owner, email: 'one@example.com' }, accessToken: token, expiresAt: new Date(Date.now() + 900000).toISOString() })
  await signIn('login', 'one@example.com', 'a-strong-password-123')
  assert.equal(await accessToken(owner), token)
  assert.ok(!JSON.stringify([...values.values()]).includes(token), 'JWTs must not be persisted')
  await assert.rejects(accessToken(other), /Sign in again/)
  globalThis.fetch = async () => { throw new TypeError('Network unavailable') }
  await assert.rejects(syncEntries(owner))
  assert.equal((await readEntries(owner))[0].synced, false)
  let savedOnServer: Entry | undefined, attempts = 0, downloads = 0
  globalThis.fetch = async (_url, options) => {
    if (options?.method === 'PUT') {
      attempts++
      assert.equal((options.headers as Record<string, string>).Authorization, `Bearer ${token}`)
      assert.equal(options.credentials, 'omit')
      assert.equal(options.cache, 'no-store')
      const body = JSON.parse(options.body as string)
      savedOnServer ??= body
      assert.deepEqual(body, savedOnServer)
      if (attempts === 1) throw new TypeError('Server committed; response lost')
      return Response.json(savedOnServer)
    }
    downloads++; return Response.json([savedOnServer])
  }
  await assert.rejects(syncEntries(owner))
  assert.equal((await readEntries(owner))[0].synced, false)
  await Promise.all([syncEntries(owner), syncEntries(owner)])
  assert.equal(attempts, 2); assert.equal(downloads, 1)
  assert.equal((await readEntries(owner)).length, 1)
  assert.equal((await readEntries(owner))[0].synced, true)
  assert.equal((await readEntries(other)).length, 0)
  assert.equal((await readEntries()).length, 0, 'Guest data must stay separate')
  await appendEntries([{ ...entry, id: crypto.randomUUID() }], false, owner)
  globalThis.fetch = async () => new Response('', { status: 401 })
  await assert.rejects(syncEntries(owner), /Sign in again/)
  assert.equal((await readEntries(owner)).filter(item => !item.synced).length, 1)
  globalThis.fetch = async () => { throw new TypeError('Offline') }
  forgetAccessSession()
  assert.equal((await restoreSession())?.id, owner, 'Cached identity keeps offline records available')
  await assert.rejects(accessToken(owner), /Sign in again/, 'Cached identity never grants server access')
  await assert.rejects(signOut(), /Signed out locally/)
  assert.equal(cachedUser(), null)
  assert.equal(await restoreSession(), null, 'Offline logout must suppress auto sign-in')
  assert.equal((await readEntries(owner)).length, 2, 'Signing out must not delete unsynced entries')
  values.clear()
  const result = { user: { id: owner, email: 'one@example.com' }, accessToken: token, expiresAt: new Date(Date.now() + 900000).toISOString() }
  globalThis.fetch = async url => String(url).endsWith('/csrf') ? Response.json({ token: 'csrf', headerName: 'X-XSRF-TOKEN' }) : Response.json(result)
  await signIn('login', 'one@example.com', 'a-strong-password-123')
  forgetAccessSession()
  let release: (value: Response) => void = () => {}
  let notify: () => void = () => {}
  const started = new Promise<void>(resolve => { notify = resolve })
  let firstCsrf = true
  globalThis.fetch = async url => {
    if (String(url).endsWith('/csrf')) {
      if (firstCsrf) { firstCsrf = false; return new Promise<Response>(resolve => { release = resolve; notify() }) }
      return Response.json({ token: 'csrf', headerName: 'X-XSRF-TOKEN' })
    }
    return Response.json(result)
  }
  const stale = restoreSession()
  await started
  const reconnected = restoreSession(true)
  release(new Response('', { status: 503 }))
  await Promise.all([stale, reconnected])
  assert.equal(await accessToken(owner), token, 'Reconnection must perform a fresh refresh after an in-flight offline failure')
  console.log('PASS: JWT memory-only storage, account-bound requests, isolated caches, offline/lost-ack retries, serialized sync, offline logout and preserved pending entries')
} finally { globalThis.fetch = originalFetch }
