# Archived speech spike

Historical prototype instructions; see the root README for the current Spring Boot/Postgres app.

# PennyVoice speech feasibility spike

One mobile-first screen using React + TypeScript + Vite. No ledger, authentication, AI extraction, database, reminders, notifications, receipt uploads, custom audio capture, server recognizer, or downloaded model.

## Run

Use Node 22.18+ (verified with Node 26.8.1).

```sh
npm ci
npm run dev
```

For the installable production app:

```sh
npm test
npm run lint
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Open http://127.0.0.1:4173 on the development computer. Development mode intentionally does not register a service worker. The production shell includes a manifest, PNG icons, and a service worker. Refresh once after the first production visit so the service worker controls the page and can cache loaded assets before an offline test. Only static same-origin GET responses are cached, never transcript data. Reloading loses all text. For fresh build tests, clear site data/unregister the old worker and reopen. Root-path hosting is assumed.

## HTTPS on real devices

No hosting credentials, deployment configuration, domain, or DNS setup existed in this empty repository. No deployment or tunnel was created.

Plain HTTP at a LAN IP is not a secure context; the localhost exception applies to the device running the browser, not your computer's LAN address. Use trusted HTTPS for phone testing and PWA installation. See [installability requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

Temporary device-testing route (macOS with Homebrew; run yourself when ready to expose the static test app):

```sh
brew install cloudflared
npm run build
python3 -m http.server 4174 --bind 127.0.0.1 --directory dist
```

Leave that terminal running. In another terminal:

```sh
cloudflared tunnel --url http://127.0.0.1:4174
```

Open the printed `https://...trycloudflare.com` URL on each device. This follows [Cloudflare's Quick Tunnel instructions](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/). It creates a temporary public URL; anyone with the URL can open the static app. Stop the tunnel with Ctrl+C after testing. No domain or DNS changes are needed. Keep the same tunnel running for tab/PWA comparisons; each new tunnel gets a new origin with separate permissions and install state. The tunnel carries app assets; the browser independently controls its speech service.

On Safari iPhone use Share → Add to Home Screen (enable Open as Web App if offered), then launch from the icon. On Chrome Android use the browser menu's Install app/Add to Home screen action. Confirm `displayMode: standalone` on the capability report rather than assuming a home screen shortcut is a PWA. Record if installation is unavailable. On either platform, installation behavior and recognition must be observed, not inferred from API presence.

## Recognition behavior and privacy

Start is a direct user gesture. Each session gets a new recognizer and result-index set. Final result indices are committed once; identical words at different indices or in new sessions are retained. Interim text is tentative and is cleared on end; completed text survives Stop and errors. Editing and clearing are available between sessions. Sessions never restart automatically. Stop waits for final results; after 8 seconds without end it aborts and releases the session for a manual retry. Leaving the page aborts recognition; background visibility changes are logged so behavior can be observed.

Diagnostics include browser user-agent, requested locale, display mode, API presence, state, timestamps, timing events, and connectivity hint. They exclude transcript text; there is deliberately no transcript export toggle. Only the explicit Copy button writes diagnostics to the clipboard. Logs are bounded to 60 events. `navigator.onLine` is only a hint, not proof that the recognition service is reachable.

Both `SpeechRecognition` and `webkitSpeechRecognition` are feature-detected. `processLocally` is checked on a constructed instance with `in`; `available()` and `install()` are checked independently on the selected constructor. No unsupported property is assigned to claim support. This spike does not request local processing, query language-pack availability, or install packs. Those are optional future experiments if default recognition proves useful.

Documentation checked 16 November 2026:

- [WebKit Safari speech announcement](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/): Safari speech recognition uses the Siri engine; WebKit documented that Siri must be enabled. Check Siri settings when debugging Apple devices. This announcement does not prove current installed-PWA reliability.
- [Chrome's Web Speech introduction](https://developer.chrome.com/blog/voice-driven-web-apps-introduction-to-the-web-speech-api/): prefixed constructor, interim/final results, and recognition events. It does not establish Android installed-mode reliability.
- [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition): limited availability; browsers including Chrome may use server-based recognition. Do not assume offline operation.
- [processLocally](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally), [available](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static), and [install](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/install_static): separate optional APIs. Presence alone does not prove usable on-device English recognition.

## Verification results

### Automated / local tooling

Passed `npm test`: actual accumulation helper tested for interim→final conversion, replayed results without duplicated finals, intentionally repeated words, index reset across sessions, and empty results. Passed `npm run build` (TypeScript + Vite) and `npm run lint` with no warnings. Local production HTTP checks returned 200 for `/`, `/manifest.webmanifest`, and `/sw.js`.

These checks do not prove microphone access, recognition accuracy, timing, PWA installation, or offline recognition. No mocked recognition result is presented as hardware evidence.

### Device-observed

The user exercised the Codex in-app browser at `http://127.0.0.1:4173/`. Inspection of its live event log showed three Start attempts on 16 November 2026 (India time): each received a start acknowledgement, then `error: network` and session end; Start was available again. No first-text or final-result events were logged. API detection reported `SpeechRecognition`, a secure context, browser display mode, and all three optional local APIs present. This demonstrates that API presence does not establish a working recognition service. The log does not establish the network failure’s cause, microphone/audio quality, device model, browser version, or recognition accuracy. This is an embedded-browser observation, not a Safari iPhone or Chrome Android result.

### Untested

All Safari iPhone, Chrome Android, desktop microphone, installed PWA, permission, silence, noise, background, offline, and latency cases below. HTTPS tunnel instructions have been documented, not executed. The live in-app page rendered its error state, capability report, and event log. Service-worker offline behavior remains unobserved.

## Manual checklist

Run the full checklist separately in each row. Start with en-IN; repeat the six phrases with en-US for comparison. Use non-sensitive test speech.

| Target | Model / OS version | Browser version | Capability report | Result |
| --- | --- | --- | --- | --- |
| Safari iPhone tab | pending | pending | pending | untested |
| Safari iPhone installed PWA | pending | pending | pending | untested |
| Chrome Android tab | pending | pending | pending | untested |
| Chrome Android installed PWA | pending | pending | pending | untested |
| Desktop browser baseline | pending | pending | pending | untested |

For every target:

- [ ] Record device model, OS version, full browser version, locale, online status, and display mode. On iPhone record the OS/Safari version from Settings as well as diagnostics.
- [ ] Allow microphone access and run all six phrases below; note recognition success and each amount/name error. There is no amount/name parser: assess those errors manually.
- [ ] Deny permission using a fresh permission state; check error message, retained completed text, and successful retry after re-enabling permission in browser/system settings.
- [ ] Try a missing/disabled microphone where the device permits it; record if not reproducible.
- [ ] Perform five consecutive Start → speak → Stop cycles without reloading. Check no overlap, duplicate final segments, stale interim text, or lost earlier text. Try rapid repeated taps, Stop while starting, and repeating exactly the same phrase in successive sessions.
- [ ] Remain silent, then try normal background noise. Record no-speech/errors or unexpected end; verify manual retry works without automatic restart.
- [ ] Background the browser/PWA while listening, then return. Record whether recognition ends, pauses, continues, or errors, and whether Stop/retry works. Navigate away while listening and verify the microphone indicator stops; returning requires a new Start.
- [ ] Disconnect networking after the production shell has been visited and refreshed under service-worker control. Reopen the app, attempt recognition, and record what actually happens. Distinguish shell availability from speech availability; do not infer offline support from an API flag or one successful session.
- [ ] Edit completed text, clear it, and verify reload loses it. Inspect app storage/network: no transcript persistence or app transcript requests. Browser-managed recognition traffic may be external and may not appear as app fetches.
- [ ] Copy diagnostics; verify it excludes transcript content. Record timing events before the bounded log rolls over.

Test phrases (speak exactly):

1. “Spent one hundred and fifty rupees on lunch today.”
2. “Rahul owes me eight hundred rupees.”
3. “I owe Priya twelve hundred rupees.”
4. “Rahul returned three hundred rupees yesterday.”
5. “Spent fifty rupees, not fifteen rupees.”
6. “Paid two hundred for lunch and six hundred for groceries.”

Copy this row per phrase/session/scenario into your test notes (not app storage):

| Device / OS / browser version | Mode | Locale | Scenario / phrase / cycle | Recognition success | Amount errors | Name errors | Start→first text ms | Stop→final result ms | Stop→end ms | Notes / error / offline observation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pending | pending | en-IN | pending | untested | — | — | — | — | — | — |

Timing starts at button presses, including permission delay. Copy diagnostics after each run. If finals arrive before Stop, write `N/A: final before Stop`; if no final arrives, write `no final`, not zero. Session-end latency is separate from final-result latency. Interim output is optional browser behavior. Record failures and unsupported APIs rather than excluding those runs.

## Decision

Browser recognition is a candidate, not yet established as sufficient. Complete the target-device matrix before expanding PennyVoice. A provisional pass means all four mobile modes support repeated usable sessions, preserve completed text on failure, and produce reviewable amounts/names with acceptable observed latency. Product accuracy and latency targets still need agreement; do not invent a production success rate from this spike. If a target mode is unavailable, repeatedly hangs, loses final results, or makes too many amount/name errors, investigate a fallback separately. Do not build that fallback or the ledger until these observations are recorded.

## Troubleshooting a recognition network error

The `network` error comes from the browser recognizer, separately from loading the app. A working page and detected API do not prove that the browser can reach or use its recognition backend. Check connectivity, then compare the same local URL in standalone Chrome or Safari on the development computer. For phones use the HTTPS route above; phone localhost points to the phone itself. Record the same failure if it repeats. An embedded preview failure alone does not establish whether the target mobile browsers work. No automatic retries or alternate recognizer are added.

## Subsequent user report

The user reported successful recognition in Safari and Chrome. Device models, versions, installed-PWA status, accuracy, and latency were not supplied; these details remain unverified.
