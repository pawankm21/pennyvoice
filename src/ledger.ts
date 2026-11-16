export type EntryKind = 'expense' | 'lent' | 'borrowed' | 'repayment-received' | 'repayment-paid'
export interface Entry {
  id: string
  kind: EntryKind
  amountPaise: number
  date: string
  description: string
  person: string
}
export interface Balance { person: string; receivablePaise: number; payablePaise: number }
const kinds: EntryKind[] = ['expense', 'lent', 'borrowed', 'repayment-received', 'repayment-paid']

export function parseRupees(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [rupees, paise = ''] = trimmed.split('.')
  const amount = Number(rupees) * 100 + Number(paise.padEnd(2, '0'))
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

export function balances(entries: Entry[]): Balance[] {
  const people = new Map<string, Balance>()
  for (const entry of entries) {
    if (entry.kind === 'expense') continue
    const person = entry.person.trim()
    const key = person.toLocaleLowerCase('en-IN')
    const balance = people.get(key) ?? { person, receivablePaise: 0, payablePaise: 0 }
    if (entry.kind === 'lent') balance.receivablePaise += entry.amountPaise
    if (entry.kind === 'borrowed') balance.payablePaise += entry.amountPaise
    if (entry.kind === 'repayment-received') balance.receivablePaise -= entry.amountPaise
    if (entry.kind === 'repayment-paid') balance.payablePaise -= entry.amountPaise
    people.set(key, balance)
  }
  return [...people.values()]
}

export function validateEntry(entry: Entry, existing: Entry[]): string | null {
  if (!entry.id || existing.some(item => item.id === entry.id)) return 'This entry has already been saved.'
  if (!kinds.includes(entry.kind)) return 'Choose a valid entry type.'
  if (!Number.isSafeInteger(entry.amountPaise) || entry.amountPaise <= 0) return 'Enter a positive amount with at most two decimal places.'
  if (entry.date.startsWith('0000') || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(Date.parse(entry.date)) || new Date(entry.date).toISOString().slice(0, 10) !== entry.date) return 'Choose a valid date.'
  if (entry.description.length > 500 || entry.person.length > 100) return 'Description or person name is too long.'
  if (!entry.description.trim()) return 'Add a short description.'
  if (entry.kind !== 'expense' && !entry.person.trim()) return 'Enter the person’s name.'
  if (!Number.isSafeInteger(existing.reduce((sum, item) => sum + item.amountPaise, entry.amountPaise))) return 'The ledger total exceeds the supported amount.'
  if (entry.kind === 'repayment-received' || entry.kind === 'repayment-paid') {
    const balance = balances(existing).find(item => item.person.toLocaleLowerCase('en-IN') === entry.person.trim().toLocaleLowerCase('en-IN'))
    const outstanding = entry.kind === 'repayment-received' ? balance?.receivablePaise : balance?.payablePaise
    if (entry.amountPaise > (outstanding ?? 0)) return 'Repayment exceeds this person’s outstanding balance. Record the original amount owed first.'
  }
  return null
}

export function monthlySpending(entries: Entry[], month: string): number {
  return entries.filter(entry => entry.kind === 'expense' && entry.date.startsWith(`${month}-`)).reduce((sum, entry) => sum + entry.amountPaise, 0)
}
