import type { EntryKind } from './ledger.ts'
import { parseRupees } from './ledger.ts'
export interface Draft { kind: EntryKind; amount: string; date: string; person: string; description: string }
export const kindLabels: Record<EntryKind, string> = { expense: 'Expense', lent: 'Owed to me', borrowed: 'I owe', 'repayment-received': 'Repayment received', 'repayment-paid': 'Repayment paid' }
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function emptyDraft(): Draft { return { kind: 'expense', amount: '', date: localDate(), person: '', description: '' } }
const small: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const scales: Record<string, number> = { thousand: 1000, lakh: 100000, million: 1000000, crore: 10000000 }
const numberWord = `(?:${Object.keys(small).join('|')}|hundred|${Object.keys(scales).join('|')})`
const numberPattern = new RegExp(`\\b(?:\\d+(?:\\.\\d{1,2})?|${numberWord}(?:[ -]+(?:and[ -]+)?${numberWord})*)\\b`, 'i')
function amountText(phrase: string): string {
  if (/^\d/.test(phrase)) return parseRupees(phrase) === null ? '' : phrase
  let total = 0, group = 0
  for (const word of phrase.toLowerCase().split(/[ -]+/)) {
    if (word === 'and') continue
    if (word in small) group += small[word]
    else if (word === 'hundred') group = (group || 1) * 100
    else if (word in scales) { total += (group || 1) * scales[word]; group = 0 }
    else return ''
  }
  const value = String(total + group)
  return parseRupees(value) === null ? '' : value
}
// shortcut: bounded English suggestions, require review; use a richer parser only after real phrases justify it.
export function suggestEntries(text: string, now = new Date()): Draft[] {
  const clean = text.trim().replace(/\bhundred and\b/gi, 'hundred').replace(/,?\s+not\s+[^.!?]+/gi, '')
  const parts = clean.split(/\s+and\s+(?=(?:spent|paid)\b)/i)
  const clauses = parts.flatMap(part => {
    const match = /\b(?:for|on)\b.+?\s+and\s+(.+)$/i.exec(part)
    return match && numberPattern.test(match[1]) && /^(?:spent|paid)\b/i.test(part)
      ? [part.slice(0, match.index + match[0].lastIndexOf(' and ')), `Paid ${match[1]}`] : [part]
  })
  return clauses.filter(Boolean).map(clause => {
    const draft = emptyDraft()
    draft.date = localDate(now)
    if (/\byesterday\b/i.test(clause)) { const day = new Date(now); day.setDate(day.getDate() - 1); draft.date = localDate(day) }
    const owed = /^(.+?)\s+owes?\s+me\b/i.exec(clause)
    const owe = /^I\s+owe\s+(.+?)(?=\s+(?:\d|zero\b|one\b|two\b|three\b|four\b|five\b|six\b|seven\b|eight\b|nine\b|ten\b|eleven\b|twelve\b|thirteen\b|fourteen\b|fifteen\b|twenty\b|thirty\b|forty\b|fifty\b|sixty\b|seventy\b|eighty\b|ninety\b))/i.exec(clause)
    const returned = /^(.+?)\s+(?:returned|repaid|paid\s+back)\b/i.exec(clause)
    const repaid = /^I\s+(?:returned|repaid|paid\s+back)\s+(.+?)(?=\s+(?:\d|one\b|two\b|three\b|four\b|five\b|six\b|seven\b|eight\b|nine\b|ten\b|eleven\b|twelve\b))/i.exec(clause)
    if (owed) { draft.kind = 'lent'; draft.person = owed[1] }
    else if (owe) { draft.kind = 'borrowed'; draft.person = owe[1] }
    else if (repaid) { draft.kind = 'repayment-paid'; draft.person = repaid[1] }
    else if (returned && returned[1].toLowerCase() !== 'i') { draft.kind = 'repayment-received'; draft.person = returned[1] }
    const amount = numberPattern.exec(clause)
    draft.amount = amount ? amountText(amount[0]) : ''
    const description = /\b(?:on|for)\s+(.+)/i.exec(clause)?.[1]
    draft.description = (description ?? clause).replace(/\b(?:today|yesterday)\b/gi, '').replace(/[.!?]+$/, '').trim()
    return draft
  })
}
