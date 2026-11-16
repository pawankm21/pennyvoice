import { useEffect, useRef, useState } from 'react'
import SpeechCapture from './SpeechCapture'
import AnalysisView from './AnalysisView'
import AuthDialog from './AuthDialog'
import Icon from './Icon'
import { parseRupees } from './ledger'
import type { Entry } from './ledger'
import { emptyDraft, kindLabels, localDate, suggestEntries } from './extract'
import type { Draft } from './extract'
import { appendEntries, budget, readEntries, recognitionLanguage } from './storage'
import type { LocalEntry } from './storage'
import { cachedUser, restoreSession, signOut, forgetAccessSession } from './auth'
import type { User } from './auth'
import { syncEntries } from './sync'
import { money } from './format'
type Review = Draft & { id: string }
type Page = 'home' | 'analysis' | 'activity' | 'settings'
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Please try again.'
const navigation = [{ id: 'home', label: 'Home', icon: 'home' }, { id: 'analysis', label: 'Analysis', icon: 'chart' }, { id: 'activity', label: 'Activity', icon: 'activity' }, { id: 'settings', label: 'Settings', icon: 'settings' }] as const
export default function App() {
  const [user, setUser] = useState<User | null>(cachedUser)
  const owner = user?.id ?? 'guest'
  const activeOwner = useRef(owner)
  const [page, setPage] = useState<Page>('home')
  const [authOpen, setAuthOpen] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const [entries, setEntries] = useState<LocalEntry[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [drafts, setDrafts] = useState<Review[]>([])
  const [saving, setSaving] = useState(false)
  const savingNow = useRef(false)
  const [captureVersion, setCaptureVersion] = useState(0)
  const [month, setMonth] = useState(localDate().slice(0, 7))
  const [today, setToday] = useState(localDate())
  const [limit, setLimit] = useState(0)
  const [language, setLanguage] = useState<'en-IN' | 'en-US'>('en-IN')
  const [syncStatus, setSyncStatus] = useState('')
  const [syncing, setSyncing] = useState(false)
  const syncingOwners = useRef(new Set<string>())
  const syncAgain = useRef(new Set<string>())
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<Entry['kind'] | 'all'>('all')
  const reviewDialog = useRef<HTMLDialogElement>(null)
  function changeUser(next: User | null) {
    const nextOwner = next?.id ?? 'guest'
    if (nextOwner !== activeOwner.current) {
      activeOwner.current = nextOwner; setEntries([]); setReady(false); setLimit(0); setDrafts([]); setNotice(''); setError(''); setSyncStatus(''); setSyncing(false); setAuthOpen(false); setCaptureVersion(value => value + 1)
    }
    setUser(next)
  }
  async function refresh(target = owner) {
    const data = await readEntries(target)
    if (activeOwner.current === target) setEntries(data)
  }
  async function sync(target = owner) {
    if (target === 'guest' || target !== activeOwner.current) return
    if (syncingOwners.current.has(target)) { syncAgain.current.add(target); return }
    syncingOwners.current.add(target); setSyncing(true); setSyncStatus('Syncing…')
    try { await syncEntries(target); await refresh(target); if (activeOwner.current === target) setSyncStatus('Up to date') }
    catch (error) { if (activeOwner.current === target) setSyncStatus(errorText(error)) }
    finally {
      syncingOwners.current.delete(target)
      if (activeOwner.current === target) setSyncing(false)
      if (syncAgain.current.delete(target)) void sync(target)
    }
  }
  useEffect(() => {
    let mounted = true
    Promise.all([readEntries(owner), budget(undefined, owner), recognitionLanguage(undefined, owner)]).then(([data, amount, lang]) => {
      if (mounted && activeOwner.current === owner) { setEntries(data); setLimit(amount); setLanguage(lang); setReady(true) }
    }).catch(() => { if (mounted) setError('Storage unavailable. Saving is disabled.') })
    return () => { mounted = false }
  }, [owner])
  useEffect(() => {
    let mounted = true
    void restoreSession().then(next => { if (mounted) { changeUser(next); if (next) void sync(next.id) } })
    const focus = () => { setToday(localDate()); void refresh(activeOwner.current).catch(() => {}) }
    const online = () => { void restoreSession(true).then(next => { changeUser(next); if (next) void sync(next.id) }) }
    const accountChange = (event: StorageEvent) => { if (event.key === 'pennyvoice-account') { forgetAccessSession(); changeUser(cachedUser()) } }
    const tick = setInterval(() => setToday(localDate()), 60000)
    window.addEventListener('focus', focus); window.addEventListener('online', online); window.addEventListener('storage', accountChange)
    return () => { mounted = false; clearInterval(tick); window.removeEventListener('focus', focus); window.removeEventListener('online', online); window.removeEventListener('storage', accountChange) }
  }, [])
  useEffect(() => {
    const dialog = reviewDialog.current
    if (drafts.length && !dialog?.open) dialog?.showModal()
    else if (!drafts.length && dialog?.open) dialog.close()
  }, [drafts.length])
  function review(text?: string) {
    if (drafts.length || !ready) return
    setDrafts((text ? suggestEntries(text) : [emptyDraft()]).map(draft => ({ ...draft, id: crypto.randomUUID() }))); setError(''); setNotice('')
  }
  async function save() {
    if (savingNow.current || !ready || !drafts.length) return
    savingNow.current = true; setSaving(true); setError('')
    const target = owner
    try {
      const reviewed: Entry[] = drafts.map(draft => {
        const amountPaise = parseRupees(draft.amount)
        if (amountPaise === null) throw new Error('Enter a valid amount.')
        return { id: draft.id, kind: draft.kind, amountPaise, date: draft.date, person: draft.kind === 'expense' ? '' : draft.person.trim(), description: draft.description.trim() }
      })
      await appendEntries(reviewed, false, target)
      if (activeOwner.current !== target) return
      setDrafts([]); setCaptureVersion(value => value + 1); setNotice('Saved'); await refresh(target); void sync(target)
    } catch (error) { if (activeOwner.current === target) setError(errorText(error)) }
    finally { savingNow.current = false; setSaving(false) }
  }
  async function saveBudget(amount: number) { const target = owner; await budget(amount, target); if (activeOwner.current === target) { setLimit(amount); setNotice('Budget saved') } }
  async function exportBackup() {
    try {
      const data = await readEntries(owner)
      const file = new Blob([JSON.stringify({ version: 1, entries: data.map(({ key: _key, synced: _synced, ...entry }) => entry) }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(file), anchor = document.createElement('a')
      anchor.href = url; anchor.download = `pennyvoice-${today}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setError(errorText(error)) }
  }
  async function importBackup(file?: File) {
    if (!file) return
    const target = owner
    try {
      if (file.size > 10_000_000) throw new Error('Backup exceeds 10 MB.')
      const data: unknown = JSON.parse(await file.text())
      if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('entries' in data) || !Array.isArray(data.entries)) throw new Error('Choose a PennyVoice backup.')
      await appendEntries(data.entries, false, target); await refresh(target)
      if (activeOwner.current === target) { setNotice('Imported'); void sync(target) }
    } catch (error) { if (activeOwner.current === target) setError(errorText(error)) }
  }
  async function importDeviceEntries() {
    if (!user || accountBusy) return
    const target = owner
    setAccountBusy(true)
    try { const data = await readEntries('guest'); await appendEntries(data, false, target); await refresh(target); if (activeOwner.current === target) { setNotice(`${data.length} device entries copied`); void sync(target) } }
    catch (error) { setError(errorText(error)) } finally { setAccountBusy(false) }
  }
  async function logout() {
    setAccountBusy(true)
    try { await signOut(); changeUser(null) } catch (error) { changeUser(null); setError(errorText(error)) } finally { setAccountBusy(false) }
  }
  function navigate(next: Page) { setPage(next); window.scrollTo({ top: 0, behavior: 'instant' }) }
  const pending = entries.filter(entry => !entry.synced).length
  const spentToday = entries.filter(entry => entry.kind === 'expense' && entry.date === today).reduce((sum, entry) => sum + entry.amountPaise, 0)
  const monthEntries = entries.filter(entry => entry.date.startsWith(`${month}-`)).sort((a, b) => b.date.localeCompare(a.date) || (b.key ?? 0) - (a.key ?? 0))
  const filteredEntries = monthEntries.filter(entry => (kindFilter === 'all' || entry.kind === kindFilter) && `${entry.description} ${entry.person}`.toLowerCase().includes(search.toLowerCase().trim()))
  return <div className="app-layout minimal-app">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar"><a className="brand" href="#main-content" onClick={() => navigate('home')}><span className="brand-mark"><Icon name="mic" size={23} /></span><span>pennyvoice.</span></a><nav aria-label="Main navigation">{navigation.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav><button className="sidebar-account" onClick={() => navigate('settings')}><span className="person-avatar">{user ? user.email.charAt(0).toUpperCase() : <Icon name="wallet" size={18} />}</span><span>{user ? user.email : 'Device only'}</span></button></aside>
    <main id="main-content" className="workspace"><div className="topbar"><span className="mobile-brand">pennyvoice.</span><span className="breadcrumb">{navigation.find(item => item.id === page)?.label}</span><button className="sync-pill" onClick={() => navigate('settings')} aria-label={syncing ? 'Syncing. Open settings' : pending ? `${pending} entries on this device. Open settings` : 'Account and settings'}><span className={`status-dot ${pending ? 'pending' : ''}`} />{syncing ? 'Syncing' : pending ? pending : <Icon name="check" size={15} />}<Icon name="settings" size={17} /></button></div>
      {page !== 'home' && <header className="page-heading"><h1>{navigation.find(item => item.id === page)?.label}</h1>{page !== 'settings' && <label className="month-picker"><span className="sr-only">Month</span><input type="month" required value={month} onChange={event => { if (event.target.value) setMonth(event.target.value) }} /></label>}</header>}
      {error && !drafts.length && <p className="alert" role="alert">{error}<button className="text-button" onClick={() => setError('')} aria-label="Dismiss error"><Icon name="close" size={16} /></button></p>}
      {notice && <p className="toast" role="status"><Icon name="check" size={18} />{notice}<button className="text-button" onClick={() => setNotice('')} aria-label="Dismiss message"><Icon name="close" size={16} /></button></p>}
      {!ready && <p className="note" role="status">Opening ledger…</p>}
      <div hidden={page !== 'home'} className="home-stage"><section className="today-card" aria-labelledby="today-title"><span className="today-icon"><Icon name="wallet" size={24} /></span><div><h1 id="today-title">Today</h1><p className="today-amount">{money(spentToday)}</p></div><span className="today-date">{new Date(`${today}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></section><SpeechCapture key={`${owner}:${captureVersion}`} onReview={review} reviewPending={drafts.length > 0 || !ready} isVisible={page === 'home' && !authOpen} language={language} /></div>
      {page === 'analysis' && <AnalysisView key={`${owner}:${limit}`} entries={entries} month={month} limit={limit} onBudget={saveBudget} />}
      {page === 'activity' && <section className="activity-card"><div className="section-heading"><span className="soft-pill">{monthEntries.length} entries</span><button className="primary" disabled={!ready} onClick={() => review()} aria-label="Add manually"><Icon name="plus" size={19} /></button></div><div className="activity-filters"><label><span className="sr-only">Search entries</span><input type="search" placeholder="Search" value={search} onChange={event => setSearch(event.target.value)} /></label><label><span className="sr-only">Entry type</span><select value={kindFilter} onChange={event => setKindFilter(event.target.value as Entry['kind'] | 'all')}><option value="all">All types</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>{filteredEntries.length ? <ul className="entry-list">{filteredEntries.map(entry => <li key={entry.id}><span className={`entry-icon ${entry.kind}`}><Icon name={entry.kind === 'expense' ? 'wallet' : entry.kind === 'lent' || entry.kind === 'repayment-paid' ? 'up' : 'down'} /></span><div className="entry-description"><strong>{entry.description}</strong><span>{entry.person ? `${entry.person} · ` : ''}{entry.date} · {kindLabels[entry.kind]}</span></div><div className="entry-amount"><strong>{money(entry.amountPaise)}</strong><span aria-label={entry.synced ? 'Synced' : 'Device only'}><Icon name={entry.synced ? 'check' : 'wallet'} size={12} /></span></div></li>)}</ul> : <div className="empty-state"><Icon name="activity" size={30} /><p>No entries</p></div>}</section>}
      {page === 'settings' && <div className="settings-grid"><section><div className="section-heading"><h2>Account</h2><span className="person-avatar">{user ? user.email.charAt(0).toUpperCase() : <Icon name="wallet" size={18} />}</span></div>{user ? <><p className="account-email">{user.email}</p><div className="controls"><button className="secondary" disabled={accountBusy || saving || syncing} onClick={() => setAuthOpen(true)}>Sign in / switch</button><button className="secondary" disabled={accountBusy || saving || syncing} onClick={() => void logout()}>Sign out</button></div></> : <button className="primary" disabled={saving || accountBusy} onClick={() => setAuthOpen(true)}>Sign in / sign up <Icon name="arrow" size={16} /></button>}{user && <div className="sync-controls"><p role="status" className="note">{syncStatus || `${pending} pending`}</p><button className="secondary" disabled={syncing || !ready} onClick={() => void sync()}><Icon name="check" size={16} /> Sync now</button><details><summary>Import device-only entries</summary><p className="note">Copy this browser’s device-only ledger into this account. Originals are kept.</p><button className="secondary" disabled={accountBusy || syncing || saving} onClick={() => void importDeviceEntries()}>Copy entries</button></details></div>}</section>
        <section><h2>Preferences</h2><label>Speech language<select value={language} onChange={event => { const next = event.target.value as 'en-IN' | 'en-US'; void recognitionLanguage(next, owner).then(() => setLanguage(next)).catch(() => setError('Language could not be saved.')) }}><option value="en-IN">English · India</option><option value="en-US">English · US</option></select></label><div className="settings-row"><span>Currency</span><strong>INR · ₹</strong></div></section>
        <section className="data-settings"><div className="section-heading"><h2>Data & privacy</h2><Icon name="wallet" /></div><div className="controls"><button className="secondary" disabled={!ready} onClick={() => void exportBackup()}>Export backup <Icon name="down" size={16} /></button><label className="file-label">Import backup<input type="file" accept="application/json,.json" disabled={!ready || accountBusy} onChange={event => { void importBackup(event.target.files?.[0]); event.target.value = '' }} /></label></div><details><summary>Storage & privacy</summary><p className="note">Browser data can be cleared. Export backups. Account caches stay on this device after sign-out, isolated from other accounts. Voice may use your browser’s external speech service; PennyVoice stores no raw audio. Budgets and language preferences are device-only.</p></details></section></div>}
    </main>
    <nav className="mobile-nav" aria-label="Mobile navigation">{navigation.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} size={22} /><span>{item.label}</span></button>)}</nav>
    <AuthDialog key={owner} open={authOpen} onClose={() => setAuthOpen(false)} onSignedIn={next => { changeUser(next); void sync(next.id) }} />
    <dialog ref={reviewDialog} className="review-dialog" aria-labelledby="review-title" onCancel={event => { event.preventDefault(); if (!saving) setDrafts([]) }}><div className="review-heading"><span className="review-icon"><Icon name="check" size={24} /></span><button className="icon-button" aria-label="Close review" disabled={saving} onClick={() => setDrafts([])}><Icon name="close" /></button></div><h2 id="review-title">Review</h2>{error && <p className="alert" role="alert">{error}</p>}<form onSubmit={event => { event.preventDefault(); void save() }}>{drafts.map((draft, index) => <fieldset key={draft.id} disabled={saving}><legend>Entry {index + 1}</legend><div className="form-grid"><label>Type<select value={draft.kind} onChange={event => setDrafts(items => items.map((item, i) => i === index ? { ...item, kind: event.target.value as Draft['kind'] } : item))}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Amount (₹)<input inputMode="decimal" value={draft.amount} required onChange={event => setDrafts(items => items.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))} /></label><label>Date<input type="date" required value={draft.date} onChange={event => setDrafts(items => items.map((item, i) => i === index ? { ...item, date: event.target.value } : item))} /></label>{draft.kind !== 'expense' && <label>Person<input autoComplete="off" maxLength={100} value={draft.person} required onChange={event => setDrafts(items => items.map((item, i) => i === index ? { ...item, person: event.target.value } : item))} /></label>}</div><label>Description<input maxLength={500} value={draft.description} required onChange={event => setDrafts(items => items.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} /></label><button type="button" className="text-button" aria-label={`Remove entry ${index + 1}`} onClick={() => setDrafts(items => items.filter(item => item.id !== draft.id))}><Icon name="close" size={15} /> Remove</button></fieldset>)}<div className="review-actions"><button type="button" className="secondary" disabled={saving} onClick={() => setDrafts([])}>Back</button><button className="primary" disabled={!ready || saving || !drafts.length}>{saving ? 'Saving…' : 'Save'}<Icon name="check" size={18} /></button></div></form></dialog>
  </div>
}
