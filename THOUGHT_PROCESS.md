# Queue Cure — Thought Process

## The Core Problem

76% of India's 1.5M clinics run on paper tokens. Patients wait 2–3 hours with zero visibility. The receptionist manages everything from memory and shouting. Our job: replace that with a live digital system that works on any phone, needs no app install, and gives a clinic owner a clear reason to switch.

Three questions drove every decision:
1. Can a receptionist add a patient in under 10 seconds?
2. Does the patient screen update live without refreshing?
3. Is the wait time computed from real data — not a hardcoded guess?

---

## Architecture Decisions

### Why Socket.IO over polling?
Polling (fetching every 2–3 seconds) adds unnecessary server load and still has a visible lag. Socket.IO gives true real-time push — the patient screen updates in under 50ms of the receptionist clicking "Call Next". This is the core promise of the product and the only approach that makes the demo moment work.

### Why a single session document per day?
A single MongoDB document per clinic per day means all queue state is co-located. When `call_next` fires, we read, mutate, and save one document. This is fast, atomic per operation, and inherently sequential in Node.js's single-threaded event loop. A relational schema with separate rows per patient would require joins and transactions for every state change — unnecessary complexity for a single-clinic system.

### Why Express + Socket.IO over Django Channels?
Django Channels requires a separate Redis layer as a channel layer for WebSocket broadcasting. Express + Socket.IO handles it natively in the same process. For a single-clinic, low-concurrency use case, the simpler stack is the right choice. Django would only be justified if the system needed to scale across multiple clinic servers.

### Why Exponential Moving Average for wait times?
Simple moving average treats all past consultations equally. In a clinic, morning consultations (doctor fresh) are typically faster than post-lunch ones. EMA with α=0.3 means each new duration carries 30% weight and old data fades, so the estimate reflects the doctor's *current* pace rather than their average from 3 hours ago. The system labels estimates "Baseline" until 2+ real consultations are logged, then switches to "⚡ Adaptive".

### Why stamp snapshots with `receivedAt` on the frontend?
`estimatedWaitMs` is computed on the server at the moment a snapshot is sent. Without a reference timestamp, the frontend has no way to know how old that value is — it would show the same number until the next snapshot arrives, making the countdown appear frozen. By recording `receivedAt = Date.now()` when each snapshot arrives, the frontend can subtract `(now − receivedAt)` from `estimatedWaitMs` every second, producing a true ticking countdown. When the value reaches zero, it shows "Any moment now" and a running-late indicator. The value self-corrects on the next `queue_snapshot`.

---

## Concurrency & Race Conditions

### Problem: Two receptionists click "Call Next" simultaneously
Node.js processes socket events sequentially (single-threaded event loop). The first event marks the current patient done and starts the next one. The second event finds the already-transitioned state and either moves to the following patient or hits "no patients". The result is two patients processed in rapid succession — acceptable behaviour, not a corrupt state.

For a multi-doctor clinic needing strict locking, the solution is MongoDB's `findOneAndUpdate` with a version key and optimistic concurrency. Not needed for the single-receptionist neighbourhood clinic use case.

### Problem: Two connections try to create today's session simultaneously
Fixed with `findOneAndUpdate + upsert` and a unique index on `date`. The unique index is the second line of defence — even if two upserts race, MongoDB guarantees only one document is created.

### Problem: Socket reconnects mid-session
On every `connect` event, the client re-emits `join_queue`. The server responds with a fresh `queue_snapshot`. The client state is fully restored from the server — no stale UI is possible regardless of how long the connection was dropped.

### Problem: Network drop during "Call Next"
If the socket event doesn't reach the server, the client sees the old state until reconnect + `join_queue`. The Live/Offline pill in the header tells the receptionist the connection status so they know whether to retry.

---

## Key Feature Decisions

### Edit Patient Name
Receptionists sometimes mishear names and add them wrong. Allowing inline edits while the patient is still `waiting` prevents the embarrassment of calling a wrong name. The server guards on `status: 'waiting'` so names can't be changed after a patient is already being seen.

### Patient Not Available
When a token is called and the patient doesn't appear, the receptionist needs a single tap to clear them — not a multi-step skip flow. `patient_not_available` handles both waiting and serving states and clears the `currentToken` / `servingStartedAt` if the patient was already being called, so the next patient gets a clean timer.

### Doctor Break with Wait Estimate Integration
When a break starts, all patient wait estimates include the break's remaining duration. If no resume time is given, a conservative 15-minute buffer is added — patients never see a misleadingly short wait while the doctor is actually unavailable. When the break ends, `servingStartedAt` is reset so the elapsed timer on the current patient is accurate.

### IST Timezone Fix
MongoDB and Node.js use UTC by default. `new Date().toISOString().split('T')[0]` returns the UTC date — a clinic starting at 12:30 AM IST (which is 7 PM UTC the previous day) would get yesterday's session. Fixed by using `new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })` everywhere a session date is computed.

### Audio Announcements
Browser `speechSynthesis` requires a user gesture to unlock autoplay policy. The "Audio" button serves as that gesture — tapping it once unlocks the API and plays a confirmation. After that, every `currentToken` change triggers an announcement: "Token A003, [Name], please proceed to the doctor's room." Works in any browser with `en-IN` voice if available.

### Vite Proxy for Clean URLs
In development, Vite proxies `/socket.io` (with `ws: true` for WebSocket) and `/api` to the backend on port 5000. The browser always stays on `http://localhost:5173` — no port numbers or backend URLs visible to anyone using the demo. In production, `VITE_BACKEND_URL` is set to the deployed backend and the proxy block is removed.

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Call Next on empty queue | Error toast. Queue state unchanged. |
| Call Next while on break | Blocked: "Doctor is on break. Resume before calling next." |
| Add patient with empty name | Client + server validation. Token not assigned. |
| Edit name after patient called | Server rejects: "Patient not found or already called." |
| Mark urgent on non-waiting patient | Server rejects: "Patient not found or no longer waiting." |
| Patient Not Available on serving patient | Clears serving state, resets currentToken and servingStartedAt. |
| Break with no resume time | Break starts, conservative 15-min buffer in estimates, receptionist resumes manually. |
| Very fast consultations (< 1 min) | EMA handles naturally; estimate converges to real pace. |
| First patient (no history) | Baseline used until 2+ consultations logged. |
| Database unavailable on startup | Server exits with clear error: "MongoDB connection failed." |
| Countdown reaches zero | Shows "Any moment now" with pulsing orange; self-corrects on next snapshot. |
| Duplicate midnight session | `findOneAndUpdate` upsert + unique index on `date` prevents double session. |

---

## The "I Want This" Demo Moment

The receptionist adds a patient → the patient's phone across the waiting room updates instantly. No refresh. The countdown ticks down in real time. When the doctor calls them, the browser announces their token aloud. The wait time shown is computed from the last few real consultations, not a guess. The clinic owner sees a system that *knows* how their doctor actually works today — and changes its estimates in real time as the pace shifts.

---

## What Would Make This Production-Ready

1. **Auth** — OTP or PIN login for receptionist; prevent patients from landing on the receptionist view
2. **Multi-doctor** — separate queues per doctor in the same session
3. **SMS notifications** — "Your turn in 10 minutes" via Fast2SMS / Twilio
4. **PWA** — installable on patient phones, shows last-known queue state offline
5. **Analytics** — daily patient count, avg wait per hour, busiest period heatmap
6. **Optimistic locking** — `findOneAndUpdate` with `$inc` version key for multi-receptionist clinics
7. **Multi-clinic** — clinic ID in session key, auth tokens scoped per clinic
