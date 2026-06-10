# Queue Cure 🏥
### Live Digital Queue Manager for Neighbourhood Clinics

> Replace paper tokens and shouting with a real-time digital waiting system — visible to patients on their phone, controlled by the receptionist on one screen.

---

## The Problem

76% of India's 1.5 million clinics run on paper token slips and shouting. Patients wait 2–3 hours with zero visibility. Doctors have no dashboard. Receptionists manage everything from memory.

Queue Cure fixes this with a live, no-install, two-screen system that works on any phone or browser.

---

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB running locally on port 27017

### 1. Start Backend
```bash
cd backend
npm install
npm run dev
# Server starts on http://localhost:5000
```

### 2. Start Frontend
```bash
cd frontend
npm install
npm run dev
# App opens on http://localhost:5173
```

### 3. Open Two Browser Windows
- **Window 1** → click **Receptionist** (control screen)
- **Window 2** → click **Waiting Room** (patient screen)

Watch both screens sync live when you click "Call Next" or add a patient.

---

## Architecture

```
Browser (React + Vite)           Browser (React + Vite)
  Receptionist View                Patient View
        │                               │
        └──────── Socket.IO ────────────┘
                       │
               Express.js (port 5000)
               Vite Proxy → no :5000 in browser URL
                       │
               MongoDB (localhost:27017)
                 Database : queuecure
                 Collection: sessions
```

### URL Design
Vite proxies `/socket.io` (WebSocket) and `/api` to the backend. The browser always stays on `http://localhost:5173` — port 5000 is never visible. In production, set `VITE_BACKEND_URL` to your deployed backend URL.

---

## Socket Events

| Direction | Event | Payload | Description |
|---|---|---|---|
| Client → Server | `join_queue` | — | Subscribe, receive fresh snapshot |
| Client → Server | `add_patient` | `{name, phone, isUrgent}` | Add patient to queue |
| Client → Server | `call_next` | — | Mark current done, call next patient |
| Client → Server | `mark_urgent` | `{patientId}` | Bump patient to front of queue |
| Client → Server | `skip_patient` | `{patientId}` | Remove patient from queue |
| Client → Server | `edit_patient` | `{patientId, name}` | Edit patient name while waiting |
| Client → Server | `patient_not_available` | `{patientId}` | Mark patient absent, clear serving state |
| Client → Server | `set_baseline` | `{minutes}` | Set avg consultation time |
| Client → Server | `toggle_break` | `{reason, resumeInMinutes}` | Start or end doctor break |
| Client → Server | `set_clinic_name` | `{name}` | Update clinic display name |
| Server → All | `queue_snapshot` | Full queue state | Broadcast on every state change |
| Server → Caller | `patient_added` | `{tokenLabel, name}` | Confirmation toast |
| Server → Caller | `error_msg` | `{message}` | Error feedback |

---

## Adaptive Wait Engine

The system starts with the receptionist's baseline (default 10 min) and learns actual consultation durations using an Exponential Moving Average:

```
After each consultation:
  actual = timestamp_called_next − timestamp_called_prev

  if first consultation:
    rolling_avg = actual
  else:
    rolling_avg = rolling_avg × 0.7 + actual × 0.3   (EMA, α = 0.3)

Patient wait = break_remaining + current_remaining + tokens_ahead × rolling_avg
```

- **EMA α = 0.3** — recent consultations weighted more; system adapts to the doctor's current pace
- **Switches** from "Baseline" to "⚡ Adaptive" label after 2+ data points
- **Break time** added to wait estimate; unknown breaks default to a conservative 15-minute buffer
- **Current patient remaining time** subtracted from the next patient's estimate in real time

### Live Countdown (Frontend)
`estimatedWaitMs` is computed at snapshot time on the server. The frontend stamps each snapshot with `receivedAt = Date.now()`. The countdown subtracts `(now − receivedAt)` from `estimatedWaitMs` every second, giving a true ticking countdown. When the doctor runs over, it shows "Any moment now" with a running-late indicator. The value self-corrects on every new `queue_snapshot`.

---

## Features

### Receptionist Screen
| Feature | Detail |
|---|---|
| Add patient | Name + optional phone, urgent flag, token auto-assigned |
| Call Next | One click — marks current done, calls next, broadcasts to all |
| Edit patient name | Inline edit on any waiting patient — Enter to save |
| Patient Not Available | Removes waiting or serving patient, clears serving state |
| Mark Urgent | Bumps patient to front of queue |
| Skip patient | Removes patient from queue |
| Doctor Break | Optional reason + resume countdown; blocks Call Next during break |
| Clinic settings | Clinic name + baseline consultation time, saved live |
| Elapsed timer | Shows how long current patient has been with doctor; turns red if over average |
| Live/Offline indicator | Shows socket connection status |

### Patient Screen
| Feature | Detail |
|---|---|
| Now Serving display | Large token + name, updates instantly on Call Next |
| Token lookup | Patient enters their token to track personal wait |
| Live countdown | Ticks down every second from real remaining time |
| Expected arrival time | "Your turn around 11:40 AM" — computed from live wait |
| Running late indicator | Pulses orange if doctor is running over average |
| You're Next banner | Shown when patient is first in queue |
| Progress bar | Visual queue position indicator |
| Smart tip | "Safe to step out" or "Stay close" based on wait time |
| Full queue list | All waiting tokens with estimated wait per token |
| Break banner | Shows doctor break reason + countdown to resume |
| Audio announcements | Opt-in button — speaks token aloud via browser Speech API when called |
| Live/Offline indicator | Shows socket connection status |

---

## Edge Cases Handled

| Scenario | Behaviour |
|---|---|
| Call Next on empty queue | Error toast, queue state unchanged |
| Call Next while on break | Blocked: "Doctor is on break. Resume before calling next." |
| Two simultaneous Call Next clicks | Node.js event loop processes sequentially; no corrupt state |
| Edit name after patient called | Server rejects: patient must be `waiting` |
| Patient Not Available on serving patient | Clears serving state, resets currentToken |
| Socket reconnect | `join_queue` re-emitted on connect, fresh snapshot delivered |
| Duplicate session at midnight | `findOneAndUpdate` with upsert + unique index on `date` prevents double session |
| IST midnight (timezone) | Date key uses `Asia/Kolkata` timezone — no UTC mismatch |
| Doctor running over average | Countdown shows "Any moment now" + running-late label |
| Unknown break duration | Conservative 15-minute buffer added to all wait estimates |
| Empty name submission | Client + server validation, token not assigned |

---

## Evaluation Criteria

| Criteria | Weight | Implementation |
|---|---|---|
| Live queue updates, no refresh | 40% | Socket.IO `io.emit('queue_snapshot')` broadcasts to all clients on every state change |
| Wait time from real data | 25% | EMA engine, never hardcoded; adapts to actual consultation pace |
| Receptionist screen fast & mistake-proof | 20% | Auto-focus, Enter-to-submit, < 10 seconds to add a token |
| Thought process: concurrency & edge cases | 15% | See THOUGHT_PROCESS.md |

---

## Deployment

### Local (Development)
Frontend: `http://localhost:5173` — Vite proxy keeps backend invisible

### Production
| Service | Platform | Notes |
|---|---|---|
| Backend | Railway | Set `MONGODB_URI` from Atlas, `PORT=5000` |
| Database | MongoDB Atlas (free M0) | Allow `0.0.0.0/0` in Network Access |
| Frontend | Vercel | Set `VITE_BACKEND_URL` to Railway URL, remove Vite proxy block |

---

## The "I Want This" Moment

The receptionist adds a patient → the patient's phone across the waiting room updates instantly — no refresh. The countdown ticks down in real time. When the doctor calls them, the browser announces their token aloud. The wait estimate shown is computed from the last few real consultations, not a guess. The clinic owner sees a system that *knows* how their doctor actually works today.

---

## What Would Make This Production-Ready

1. **Auth** — OTP or PIN login for receptionist
2. **Multi-doctor** — separate queues per doctor
3. **SMS notifications** — "Your turn in 10 min" via Fast2SMS/Twilio
4. **PWA** — installable on patient phones, works offline for viewing
5. **Analytics** — daily patient count, avg wait, peak hour heatmap
6. **Optimistic locking** — `findOneAndUpdate` with version key for multi-receptionist clinics
