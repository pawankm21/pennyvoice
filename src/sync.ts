import { acknowledge, appendEntries, entryFromUnknown, readEntries } from './storage.ts'
import { accessToken } from './auth.ts'
import type { Entry } from './ledger.ts'
const runs = new Map<string, Promise<void>>()
async function request(owner: string, path: string, entry?: Entry) {
  const token = await accessToken(owner)
  const response = await fetch(`/api/entries${path}`, {
    method: entry ? 'PUT' : 'GET', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${token}`, ...(entry ? { 'Content-Type': 'application/json' } : {}) },
    body: entry ? JSON.stringify(entry) : undefined,
  })
  if (!response.ok) {
    if (response.status === 401) throw new Error('Sign in again to sync. Local entries are safe.')
    if (response.status === 409) throw new Error('Sync conflict. Local entries are safe; export a backup before resolving.')
    throw new Error(`Sync unavailable (${response.status}). Local entries are safe.`)
  }
  return await response.json() as unknown
}
export function syncEntries(owner: string): Promise<void> {
  if (owner === 'guest') return Promise.reject(new Error('Sign in to sync device-only entries.'))
  const existing = runs.get(owner)
  if (existing) return existing
  const run = (async () => {
    for (const local of await readEntries(owner)) {
      if (local.synced) continue
      const entry = entryFromUnknown(local)
      const saved = entryFromUnknown(await request(owner, `/${entry.id}`, entry))
      await acknowledge(saved, owner)
    }
    // shortcut: restore full history; add pagination together with safe cache pruning.
    const remote = await request(owner, '')
    if (!Array.isArray(remote)) throw new Error('Invalid server history response.')
    await appendEntries(remote.map(entryFromUnknown), true, owner)
  })().finally(() => { runs.delete(owner) })
  runs.set(owner, run)
  return run
}
