export interface Result { isFinal: boolean; 0: { transcript: string } }
export interface Recognition extends EventTarget {
  lang: string; continuous: boolean; interimResults: boolean; processLocally?: boolean
  start(): void; stop(): void; abort(): void
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: { results: ArrayLike<Result> }) => void) | null
}
interface Constructor { new(): Recognition; available?: unknown; install?: unknown }
declare global { interface Window { SpeechRecognition?: Constructor; webkitSpeechRecognition?: Constructor } }

// Result indices belong to a session; identical words at different indices are intentional.
export function collectResults(results: ArrayLike<Result>, committed: Set<number>) {
  const final: string[] = [], interim: string[] = []
  Array.from(results).forEach((result, index) => {
    if (result.isFinal) {
      if (!committed.has(index)) { final.push(result[0].transcript.trim()); committed.add(index) }
    } else { interim.push(result[0].transcript) }
  })
  return { final: final.filter(Boolean).join(' '), interim: interim.join(' ') }
}
export const errors: Record<string, string> = {
  'not-allowed': 'Microphone permission denied. Allow access in browser or system settings, then try Start.',
  'service-not-allowed': 'Recognition service is blocked by browser or system settings.',
  'audio-capture': 'No usable microphone. Check your microphone and system permissions.',
  'no-speech': 'No speech detected. Try Start again and speak clearly.',
  network: 'The browser recognition service reported a network error. Check your connection. If you are using the in-app preview, open this same URL in Chrome or Safari outside the preview and try again. API availability does not guarantee the recognition service is reachable.',
  aborted: 'Recognition was aborted. You can start a new session.',
  'language-not-supported': 'This recognition service does not support the selected English locale.',
}
