import assert from 'node:assert/strict'
import { spendingAnalysis } from '../src/analysis.ts'
import type { Entry } from '../src/ledger.ts'
const entry = (date: string, amountPaise: number, kind: Entry['kind'] = 'expense'): Entry => ({ id: crypto.randomUUID(), date, amountPaise, kind, description: 'Lunch', person: kind === 'expense' ? '' : 'Rahul' })
const entries = [entry('2026-11-01', 10000), entry('2026-11-07', 20000), entry('2026-11-08', 6000), entry('2026-11-30', 4000), entry('2026-10-31', 20000), entry('2026-11-01', 80000, 'lent'), entry('2026-11-08', 10000, 'repayment-received')]
const analysis = spendingAnalysis(entries, '2026-11')
assert.equal(analysis.total, 40000)
assert.equal(analysis.count, 4)
assert.equal(analysis.average, 10000)
assert.equal(analysis.change, 100)
assert.equal(analysis.previousMonth, '2026-10')
assert.deepEqual(analysis.weeks.map(week => week.total), [30000, 6000, 0, 0, 4000])
assert.deepEqual(analysis.largest.map(item => item.amountPaise), [20000, 10000, 6000])
assert.equal(spendingAnalysis([], '2024-02').daily.length, 29)
assert.equal(spendingAnalysis([], '2026-01').previousMonth, '2025-12')
assert.equal(spendingAnalysis([], '2026-01').change, null)
assert.equal(spendingAnalysis([], '2026-01').average, 0)
console.log('PASS: monthly analysis, debt exclusion, weekly boundaries, averages, zero baseline, leap years, year rollover')
