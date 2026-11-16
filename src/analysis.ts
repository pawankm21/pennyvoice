import type { Entry } from './ledger.ts'
import { monthlySpending } from './ledger.ts'

export function spendingAnalysis(entries: Entry[], month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const days = new Date(year, monthNumber, 0).getDate()
  const expenses = entries.filter(entry => entry.kind === 'expense' && entry.date.startsWith(`${month}-`))
  const daily = Array<number>(days).fill(0)
  for (const entry of expenses) daily[Number(entry.date.slice(-2)) - 1] += entry.amountPaise
  const weeks = []
  for (let day = 0; day < days; day += 7) {
    weeks.push({ label: `${day + 1}–${Math.min(day + 7, days)}`, total: daily.slice(day, day + 7).reduce((sum, amount) => sum + amount, 0) })
  }
  const previousDate = new Date(year, monthNumber - 2, 1)
  const previousMonth = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`
  const total = monthlySpending(entries, month)
  const previousTotal = monthlySpending(entries, previousMonth)
  return {
    total, count: expenses.length, daily, weeks, previousMonth, previousTotal,
    average: expenses.length ? Math.round(total / expenses.length) : 0,
    largest: [...expenses].sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 3),
    change: previousTotal > 0 ? Math.round((total - previousTotal) / previousTotal * 100) : null,
  }
}
