import { useEffect, useRef, useState } from 'react'
import { collectResults, errors } from './speech'
import type { Recognition } from './speech'
import Icon from './Icon'

const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition
function inspectCapabilities() {
  let instance: Recognition | undefined
  try { instance = Constructor ? new Constructor() : undefined } catch { /* Report unusable constructor. */ }
  return {
    recognizer: window.SpeechRecognition ? 'SpeechRecognition' : window.webkitSpeechRecognition ? 'webkitSpeechRecognition' : 'Unavailable',
    constructible: !!instance,
    processLocally: !!instance && 'processLocally' in instance,
    available: typeof Constructor?.available === 'function',
    install: typeof Constructor?.install === 'function',
    secureContext: window.isSecureContext,
    displayMode: window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone ? 'standalone' : 'browser',
  }
}
const capabilities = inspectCapabilities()
type Phase = 'idle' | 'starting' | 'listening' | 'stopping' | 'error'
type Log = { time: string; event: string }
export default function SpeechCapture({ onReview, reviewPending, isVisible, language }: { onReview: (text: string) => void; reviewPending: boolean; isVisible: boolean; language: 'en-IN' | 'en-US' }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Ready. Say what you spent or who owes whom.')
  const lang = language
  const [text, setText] = useState('')
  const [interim, setInterim] = useState('')
  const [logs, setLogs] = useState<Log[]>([])
  const [copyStatus, setCopyStatus] = useState('')
  const active = useRef<Recognition | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const stopAction = useRef<() => void>(() => {})
  const log = (event: string) => setLogs(previous => [...previous.slice(-59), { time: new Date().toISOString(), event }])

  useEffect(() => {
    const cleanup = () => {
      clearTimeout(timer.current)
      const recognition = active.current
      active.current = null
      if (recognition) {
        recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null
        try { recognition.abort() } catch { /* Already ended. */ }
      }
    }
    const leave = () => { cleanup(); setBusy(false); setPhase('idle'); setInterim(''); setMessage('Page left; recognition stopped. Tap Start to begin again.') }
    const visibility = () => log(`visibility: ${document.visibilityState}`)
    window.addEventListener('pagehide', leave)
    document.addEventListener('visibilitychange', visibility)
    return () => { cleanup(); window.removeEventListener('pagehide', leave); document.removeEventListener('visibilitychange', visibility) }
  }, [])

  useEffect(() => { if (!isVisible) stopAction.current() }, [isVisible])

  function start() {
    if (active.current || !Constructor) return
    let recognition: Recognition
    try { recognition = new Constructor() } catch { setPhase('error'); setMessage('Browser could not create a recognizer.'); return }
    active.current = recognition
    setBusy(true)
    const committed = new Set<number>()
    const started = performance.now()
    let firstText = false, stopped: number | undefined, failed = false
    const current = () => active.current === recognition
    const finish = () => {
      if (!current()) return
      clearTimeout(timer.current)
      active.current = null
      setBusy(false)
      recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null
      setInterim('')
      setPhase(failed ? 'error' : 'idle')
      if (!failed) setMessage(stopped === undefined ? 'Browser ended the session. Completed text is preserved; tap Start to continue.' : 'Stopped. Completed text is preserved.')
      log(stopped === undefined ? 'end: browser initiated' : `end: ${Math.round(performance.now() - stopped)} ms after Stop`)
    }
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onstart = () => { if (current()) { setPhase(stopped === undefined ? 'listening' : 'stopping'); if (stopped === undefined) setMessage('Listening. Tap Stop when you are done.'); log('start acknowledged') } }
    recognition.onresult = event => {
      if (!current()) return
      const result = collectResults(event.results, committed)
      if (!firstText && (result.final || result.interim)) { firstText = true; log(`first text: ${Math.round(performance.now() - started)} ms after Start`) }
      if (result.final) {
        setText(previous => [previous.trim(), result.final].filter(Boolean).join(' '))
        log(stopped === undefined ? 'final result' : `final result: ${Math.round(performance.now() - stopped)} ms after Stop`)
      }
      setInterim(result.interim)
    }
    recognition.onerror = event => {
      if (!current()) return
      failed = true
      setPhase('error'); setMessage(errors[event.error] ?? `Recognition error: ${event.error}`)
      log(`error: ${event.error}`)
      // shortcut: wait at most 8 seconds for end, then abort to unblock a manual retry.
      clearTimeout(timer.current)
      timer.current = setTimeout(() => { finish(); try { recognition.abort() } catch { /* Already ended. */ } }, 8000)
    }
    recognition.onend = finish
    setPhase('starting'); setInterim(''); setMessage('Waiting for the browser and microphone permission…'); log(`Start requested: ${lang}`)
    try { recognition.start() } catch {
      failed = true; setMessage('Start failed. Check browser permissions and try again.'); log('start threw'); finish()
    }
    // Store Stop on this instance so session timing stays isolated.
    stopAction.current = () => {
      if (!current() || stopped !== undefined) return
      stopped = performance.now(); setPhase('stopping'); setMessage('Waiting for final results…'); log('Stop requested')
      try { recognition.stop() } catch { failed = true; setMessage('Stop failed; session released.'); finish(); try { recognition.abort() } catch { /* Already ended. */ } return }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => { failed = true; setMessage('Timed out waiting for end. Completed text is preserved.'); log('stop timeout'); finish(); try { recognition.abort() } catch { /* Already ended. */ } }, 8000)
    }
  }
  async function copyDiagnostics() {
    const report = { capturedAt: new Date().toISOString(), userAgent: navigator.userAgent, language: lang, capabilities, phase, online: navigator.onLine, events: logs }
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); setCopyStatus('Diagnostics copied. No transcript included.') }
    catch { setCopyStatus('Clipboard unavailable. Copy the capability report and event log manually.') }
  }
  return <section className={`voice-card ${busy ? 'is-listening' : ''}`} aria-labelledby="session-title" id="add-entry">
    <div className="voice-intro"><h2 id="session-title">Add entry</h2><div className="penny-character" aria-hidden="true"><i /><i /><b /></div></div>
    <div className="speak-area">
      <button className={`speak-button ${busy ? 'recording' : ''}`} onClick={() => busy ? stopAction.current() : start()} disabled={reviewPending || phase === 'stopping' || (!busy && (!capabilities.constructible || !capabilities.secureContext))} aria-label={busy ? 'Stop listening' : 'Speak an entry'}>
        {busy ? <span className="stop-symbol" /> : <Icon name="mic" size={32} />}
      </button>
      <strong>{phase === 'stopping' ? 'Finishing up…' : busy ? 'Stop' : 'Speak'}</strong>
      {busy && <div className="sound-wave" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ animationDelay: `${i * .12}s` }} />)}</div>}
    </div>
    <div className="transcript-box"><label htmlFor="transcript">{busy ? 'Live transcript' : 'Your words'}<span aria-hidden="true">{busy ? 'Stop to edit' : 'Edit'}</span></label>
      <textarea id="transcript" rows={3} value={text} readOnly={busy} onChange={e => setText(e.target.value)} placeholder='“Spent 150 rupees on lunch today.”' />
      {interim && <p className="interim" aria-live="off">{interim}<span className="typing-dot"> ···</span></p>}
      <div className="composer-actions"><button className="text-button" disabled={busy || !text} onClick={() => { setText(''); setInterim(''); log('text cleared') }}>Clear</button><button className="send-button" disabled={busy || reviewPending || !text.trim()} onClick={() => onReview(text)}>Send <Icon name="arrow" size={18} /></button></div>
    </div>
    <p className={`voice-status ${phase === 'error' ? 'error-text' : ''}`} role="status" aria-live="polite">{!capabilities.constructible ? 'Voice is unavailable here. You can still type and send an entry.' : !capabilities.secureContext ? 'Voice needs HTTPS or localhost. You can still type below.' : phase === 'error' || busy ? message : ''}</p>
    <details className="speech-details"><summary aria-label="Speech privacy and diagnostics">•••</summary><p className="note">Your browser may use an external speech service. Raw audio is not stored by this app. Only reviewed entries are saved and synced; speech may need internet.</p>
      <dl>{Object.entries(capabilities).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl><p className="note">Local API presence does not prove usable on-device recognition. No language pack is installed by this app.</p>
      <button className="secondary" onClick={copyDiagnostics}>Copy diagnostics</button><p role="status" className="note">{copyStatus || 'Transcript content is excluded.'}</p><pre tabIndex={0} aria-label="Timestamped event log">{logs.map(entry => `${entry.time}  ${entry.event}`).join('\n') || 'No events yet.'}</pre>
    </details>
  </section>
}
