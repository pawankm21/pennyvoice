import { validateEntry } from './ledger.ts'
import type { Entry } from './ledger.ts'
export interface LocalEntry extends Entry { synced: boolean; key?: number }
const connections = new Map<string, Promise<IDBDatabase>>()
function database(owner = 'guest') {
  if (owner !== 'guest' && !/^[0-9a-f-]{36}$/i.test(owner)) throw new Error('Invalid local account.')
  const name = owner === 'guest' ? 'pennyvoice' : `pennyvoice-user-${owner}`
  const existing = connections.get(name)
  if (existing) return existing
  const connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      const entries = request.result.createObjectStore('entries', { keyPath: 'key', autoIncrement: true })
      entries.createIndex('id', 'id', { unique: true })
      request.result.createObjectStore('settings')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { connections.delete(name); reject(request.error) }
    request.onblocked = () => { connections.delete(name); reject(new Error('Close other PennyVoice tabs to open storage.')) }
  })
  connections.set(name, connection)
  return connection
}
export async function readEntries(owner = 'guest'): Promise<LocalEntry[]> {
  const db = await database(owner)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('entries', 'readonly')
    const request = transaction.objectStore('entries').getAll()
    transaction.oncomplete = () => resolve(request.result)
    transaction.onabort = () => reject(transaction.error)
  })
}
export function sameEntry(a: Entry, b: Entry) {
  return a.id === b.id && a.kind === b.kind && a.amountPaise === b.amountPaise && a.date === b.date && a.description === b.description && a.person === b.person
}
export function entryFromUnknown(value: unknown): Entry {
  if (!value || typeof value !== 'object') throw new Error('Invalid entry data.')
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id) ||
      typeof item.kind !== 'string' || typeof item.amountPaise !== 'number' || typeof item.date !== 'string' ||
      typeof item.description !== 'string' || item.description.length > 500 || typeof item.person !== 'string' || item.person.length > 100) throw new Error('Invalid entry data.')
  const entry = { id: item.id, kind: item.kind, amountPaise: item.amountPaise, date: item.date, description: item.description, person: item.person } as Entry
  // A repayment's outstanding balance is validated against the ledger when appended, not in isolation.
  const basic = validateEntry({ ...entry, kind: entry.kind.startsWith('repayment-') ? (entry.kind === 'repayment-paid' ? 'borrowed' : 'lent') : entry.kind }, [])
  if (basic || !['expense', 'lent', 'borrowed', 'repayment-received', 'repayment-paid'].includes(entry.kind)) throw new Error(basic ?? 'Invalid entry type.')
  return entry
}
export async function appendEntries(incoming: Entry[], synced = false, owner = 'guest'): Promise<void> {
  incoming = incoming.map(entryFromUnknown)
  const db = await database(owner)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('entries', 'readwrite')
    const store = transaction.objectStore('entries')
    let failure: Error | undefined
    const request = store.getAll()
    request.onsuccess = () => {
      const existing: LocalEntry[] = request.result
      for (const entry of incoming) {
        const duplicate = existing.find(item => item.id === entry.id)
        if (duplicate) {
          if (!sameEntry(duplicate, entry)) { failure = new Error('An entry ID has different content. Nothing was imported.'); transaction.abort(); return }
          if (synced) store.put({ ...duplicate, synced: true })
          continue
        }
        // Server history may interleave with this device's unsynced entries. Server validates repayments.
        const error = synced ? null : validateEntry(entry, existing)
        if (error) { failure = new Error(error); transaction.abort(); return }
        const local: LocalEntry = { ...entry, synced }
        store.add(local)
        existing.push(local)
      }
    }
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Local save failed.'))
  })
}
export async function acknowledge(entry: Entry, owner = 'guest'): Promise<void> {
  const db = await database(owner)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('entries', 'readwrite')
    const store = transaction.objectStore('entries')
    const request = store.index('id').get(entry.id)
    request.onsuccess = () => {
      if (request.result && sameEntry(request.result, entry)) store.put({ ...request.result, synced: true })
      else transaction.abort()
    }
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(new Error('Sync acknowledgement did not match the local entry.'))
  })
}
export async function budget(value?: number, owner = 'guest'): Promise<number> {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid budget amount.')
  const db = await database(owner)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', value === undefined ? 'readonly' : 'readwrite')
    const store = transaction.objectStore('settings')
    const request = value === undefined ? store.get('monthlyBudget') : store.put(value, 'monthlyBudget')
    transaction.oncomplete = () => resolve(value ?? request.result ?? 0)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function recognitionLanguage(value?: 'en-IN' | 'en-US', owner = 'guest'): Promise<'en-IN' | 'en-US'> {
  const db = await database(owner)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', value ? 'readwrite' : 'readonly')
    const store = transaction.objectStore('settings')
    const request = value ? store.put(value, 'language') : store.get('language')
    transaction.oncomplete = () => resolve(value ?? (request.result === 'en-US' ? 'en-US' : 'en-IN'))
    transaction.onabort = () => reject(transaction.error)
  })
}
