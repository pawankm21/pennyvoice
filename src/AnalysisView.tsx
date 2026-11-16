import { useState } from 'react'
import { balances, parseRupees } from './ledger'
import type { Entry } from './ledger'
import { spendingAnalysis } from './analysis'
import { money } from './format'
import Icon from './Icon'
export default function AnalysisView({ entries, month, limit, onBudget }: { entries: Entry[]; month: string; limit: number; onBudget: (value: number) => Promise<void> }) {
  const analysis = spendingAnalysis(entries, month)
  const people = balances(entries).filter(person => person.receivablePaise || person.payablePaise)
  const [input, setInput] = useState(limit ? String(limit / 100) : '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const maximum = Math.max(...analysis.weeks.map(week => week.total), 1)
  const previous = new Date(`${analysis.previousMonth}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'short' })
  async function saveBudget(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return
    const value = !input.trim() || input.trim() === '0' ? 0 : parseRupees(input)
    if (value === null) { setError('Enter a valid amount.'); return }
    setSaving(true); setError('')
    try { await onBudget(value) } catch { setError('Budget could not be saved.') } finally { setSaving(false) }
  }
  return <div className="analysis-page">
    <div className="analysis-summary"><section className="spending-card"><div className="section-heading"><span className="card-kicker"><Icon name="wallet" size={18} /> SPENDING</span><span className="soft-pill">{analysis.count} expenses</span></div><p className="hero-amount">{money(analysis.total)}</p><p className="comparison">{analysis.change === null ? `No ${previous} baseline` : `${analysis.change > 0 ? '+' : ''}${analysis.change}% vs ${previous} total`}</p>
      {limit > 0 && <div className="budget-summary"><div><span>Budget</span><strong>{money(limit)}</strong></div><div className={`budget-track ${analysis.total >= limit ? 'over-budget' : ''}`} role="progressbar" aria-label="Budget used" aria-valuenow={Math.min(100, Math.round(analysis.total / limit * 100))} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, analysis.total / limit * 100)}%` }} /></div><div className="budget-caption"><strong>{analysis.total > limit ? `${money(analysis.total - limit)} over` : `${money(limit - analysis.total)} left`}</strong><span>{Math.round(analysis.total / limit * 100)}%</span></div>{analysis.total >= limit * .8 && <p className="budget-threshold" role="status">{analysis.total >= limit ? 'Budget reached' : '80% threshold reached'}</p>}</div>}
      <details className="budget-editor"><summary><Icon name="settings" size={15} /> {limit ? 'Edit budget' : 'Set budget'}</summary><form onSubmit={saveBudget}><label>Monthly budget (₹)<input inputMode="decimal" value={input} onChange={event => setInput(event.target.value)} placeholder="0" /></label>{error && <p role="alert" className="error-text">{error}</p>}<button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}<Icon name="check" size={16} /></button></form></details>
    </section><div className="balance-grid"><section className="balance-card"><span className="balance-icon mint"><Icon name="down" /></span><div><span>Owed to you</span><strong>{money(people.reduce((sum, person) => sum + person.receivablePaise, 0))}</strong></div></section><section className="balance-card"><span className="balance-icon peach"><Icon name="up" /></span><div><span>You owe</span><strong>{money(people.reduce((sum, person) => sum + person.payablePaise, 0))}</strong></div></section><section className="average-card"><Icon name="chart" /><div><span>Average expense</span><strong>{money(analysis.average)}</strong></div></section></div></div>
    <div className="analysis-grid"><section className="trend-card"><h2>Spending trend</h2><div className="bar-chart" role="img" aria-label={analysis.weeks.map(week => `${week.label}: ${money(week.total)}`).join('; ')}><div className="chart-grid" aria-hidden="true"><i /><i /><i /></div>{analysis.weeks.map(week => <div className="chart-column" key={week.label}><div className="bar-space"><div className="chart-bar" style={{ height: week.total ? `${Math.max(5, week.total / maximum * 100)}%` : '0%' }}><span>{money(week.total)}</span></div></div><span className="chart-day">{week.label}</span></div>)}</div><div className="chart-caption"><span><i /> Expenses</span><span>Dates of month</span></div><p className="note">Recorded monthly totals; a month may be incomplete.</p></section>
      <section className="largest-card"><h2>Largest expenses</h2>{analysis.largest.length ? <ol className="largest-list">{analysis.largest.map((entry, index) => <li key={entry.id}><span className="rank">{index + 1}</span><div><strong>{entry.description}</strong><span>{entry.date}</span></div><strong>{money(entry.amountPaise)}</strong></li>)}</ol> : <div className="empty-state"><Icon name="wallet" size={32} /><p>No expenses yet</p></div>}</section></div>
    {people.length > 0 && <section className="people-card"><div className="section-heading"><h2>Balances</h2><span className="note">All dates</span></div><ul className="people-list">{people.map(person => <li key={person.person.toLowerCase()}><span className="person-avatar">{person.person.charAt(0).toUpperCase()}</span><strong>{person.person}</strong><div>{person.receivablePaise > 0 && <span>Owes you <strong>{money(person.receivablePaise)}</strong></span>}{person.payablePaise > 0 && <span>You owe <strong>{money(person.payablePaise)}</strong></span>}</div></li>)}</ul></section>}
  </div>
}
