import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import { Icon } from '../App';

export default function PatientView({ onBack }) {
  const { queue, connected } = useSocket();
  const [myToken, setMyToken] = useState('');
  const [myTokenInput, setMyTokenInput] = useState('');
  const [now, setNow] = useState(Date.now());
  const prevServingTokenRef = useRef(null);
  const audioEnabledRef = useRef(false);

  // Tick every second — drives the live countdown
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Audio announcement when currentToken changes
  useEffect(() => {
    if (!queue?.servingPatient) return;
    const newToken = queue.servingPatient.tokenLabel;
    const prevToken = prevServingTokenRef.current;
    if (newToken && newToken !== prevToken) {
      prevServingTokenRef.current = newToken;
      if (audioEnabledRef.current && 'speechSynthesis' in window) {
        const name = queue.servingPatient.name || '';
        const msg = new SpeechSynthesisUtterance(
          `Token ${newToken}, ${name ? name + ', ' : ''}please proceed to the doctor's room.`
        );
        msg.lang = 'en-IN';
        msg.rate = 0.9;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(msg);
      }
    }
  }, [queue?.servingPatient?.tokenLabel]);

  const myPatient = myToken
    ? queue?.waitingPatients?.find(p =>
        p.tokenLabel.toUpperCase() === myToken.toUpperCase()
      )
    : null;

  const isBeingServed =
    myToken &&
    queue?.servingPatient?.tokenLabel?.toUpperCase() === myToken.toUpperCase();

  function handleTokenSubmit(e) {
    e.preventDefault();
    setMyToken(myTokenInput.trim().toUpperCase());
  }

  // THE FIX: estimatedWaitMs is the wait at the moment the snapshot was received.
  // We subtract (now - receivedAt) to get the true remaining time.
  // This makes the countdown tick down every second in real time.
  function getLiveCountdown() {
    if (!myPatient?.estimatedWaitMs) return null;
    const receivedAt = queue?.receivedAt ?? now;
    const elapsed = now - receivedAt;
    const remainingMs = myPatient.estimatedWaitMs - elapsed;

    if (remainingMs <= 0) return { text: 'Any moment now', overdue: true, ms: 0 };

    const totalSecs = Math.floor(remainingMs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    const text = mins === 0 ? `${secs}s` : `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
    return { text, overdue: false, ms: remainingMs };
  }

  function getArrivalTime() {
    const cd = getLiveCountdown();
    if (!cd || cd.overdue) return null;
    return new Date(now + cd.ms).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
  }

  function handleEnableAudio() {
    audioEnabledRef.current = true;
    if ('speechSynthesis' in window) {
      const unlock = new SpeechSynthesisUtterance('Audio announcements enabled.');
      unlock.lang = 'en-IN';
      unlock.volume = 0.5;
      window.speechSynthesis.speak(unlock);
    }
  }

  const countdown = getLiveCountdown();
  const arrivalTime = getArrivalTime();
  const breakCountdown = getBreakCountdown(queue?.breakResumesAt, now);
  const isAlmostNext = myPatient?.queuePosition === 1;
  const totalWaiting = queue?.waitingCount ?? 0;

  return (
    <div className="patient-layout">
      <header className="patient-header">
        <button className="back-btn light" onClick={onBack}>← Back</button>
        <div className="patient-clinic-name">{queue?.clinicName || '—'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handleEnableAudio}
            title="Enable audio announcements"
            style={{
              background: 'transparent',
              border: '1px solid var(--c-border, #e2e8f0)',
              borderRadius: '999px',
              padding: '4px 10px',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: 'var(--c-text-2, #64748b)',
            }}
          >
            <Icon id="volume-2" size={13} />
            <span>Audio</span>
          </button>
          <div className={`conn-pill ${connected ? 'connected' : 'disconnected'}`}>
            <span className="conn-dot-inner" />
            <span className="conn-label">{connected ? 'Live' : 'Offline'}</span>
          </div>
        </div>
      </header>

      {queue?.doctorOnBreak && (
        <div className="patient-break-banner">
          <Icon id="coffee" size={15} />
          <span>
            Doctor on break — <strong>{queue.breakReason}</strong>
            {breakCountdown && <span> · Resumes in {breakCountdown}</span>}
          </span>
        </div>
      )}

      <div className="patient-hero">
        <div className="ph-label">NOW SERVING</div>
        <div className={`ph-token ${queue?.servingPatient ? 'active' : 'idle'}`}>
          {queue?.servingPatient?.tokenLabel || '—'}
        </div>
        {queue?.servingPatient && (
          <div className="ph-name">{queue.servingPatient.name}</div>
        )}
        <div className="ph-queue-meta">
          <span>
            <Icon id="users" size={12} />
            {totalWaiting} waiting
          </span>
          <span className="ph-sep">·</span>
          <span>
            <Icon id={queue?.isAdaptive ? 'zap' : 'clipboard'} size={12} />
            {queue?.isAdaptive ? 'Adaptive' : 'Baseline'} avg: {queue?.effectiveAvgMin ?? '—'} min
          </span>
        </div>
      </div>

      <div className="my-token-section">
        {!myToken ? (
          <div className="token-lookup">
            <div className="tl-title">
              <Icon id="search" size={14} />
              Check your wait time
            </div>
            <form className="tl-form" onSubmit={handleTokenSubmit}>
              <input
                className="tl-input"
                placeholder="Enter your token (e.g. A003)"
                value={myTokenInput}
                onChange={e => setMyTokenInput(e.target.value)}
                autoFocus
              />
              <button type="submit" className="tl-btn">
                Track <Icon id="arrow-right" size={14} />
              </button>
            </form>
          </div>
        ) : isBeingServed ? (
          <div className="your-turn-card">
            <div className="yt-pulse" />
            <div className="yt-icon"><Icon id="bell" size={36} /></div>
            <div className="yt-title">It&apos;s your turn!</div>
            <div className="yt-token">{myToken}</div>
            <div className="yt-sub">Please proceed to the doctor&apos;s room</div>
            <button className="yt-clear" onClick={() => { setMyToken(''); setMyTokenInput(''); }}>
              Done
            </button>
          </div>
        ) : myPatient ? (
          <div className={`my-card ${isAlmostNext ? 'almost-next' : ''}`}>
            {isAlmostNext && (
              <div className="almost-banner">
                <Icon id="zap" size={12} /> You&apos;re next!
              </div>
            )}
            <div className="my-token-display">{myToken}</div>
            <div className="my-stats">
              <div className="my-stat">
                <div className="my-stat-value">{myPatient.queuePosition}</div>
                <div className="my-stat-label">ahead of you</div>
              </div>
              <div className="my-stat-sep" />
              <div className="my-stat">
                <div className={`my-stat-value wait-val ${countdown?.overdue ? 'overdue' : ''}`}>
                  {countdown ? countdown.text : `~${myPatient.estimatedWaitMin}m`}
                </div>
                <div className="my-stat-label">
                  {countdown?.overdue ? '⚠ running late' : 'live countdown'}
                </div>
              </div>
              {arrivalTime && (
                <>
                  <div className="my-stat-sep" />
                  <div className="my-stat">
                    <div className="my-stat-value" style={{ fontSize: '1.1rem' }}>{arrivalTime}</div>
                    <div className="my-stat-label">your turn around</div>
                  </div>
                </>
              )}
            </div>
            <WaitBar
              queuePosition={myPatient.queuePosition}
              totalWaiting={totalWaiting + (queue?.servingPatient ? 1 : 0)}
            />
            {myPatient.estimatedWaitMin >= 10 && (
              <div className="smart-tip">
                <Icon id="lightbulb" size={13} />
                <span>
                  You have ~{myPatient.estimatedWaitMin} min.{' '}
                  {myPatient.estimatedWaitMin >= 20
                    ? "Safe to step out briefly — we'll keep your spot."
                    : 'Stay close — your turn is coming up.'}
                </span>
              </div>
            )}
            <button className="tl-btn clear-btn" onClick={() => { setMyToken(''); setMyTokenInput(''); }}>
              Clear
            </button>
          </div>
        ) : (
          <div className="token-not-found">
            <div className="tnf-icon"><Icon id="search" size={32} /></div>
            <div>Token <strong>{myToken}</strong> not found in queue</div>
            <button className="tl-btn clear-btn" onClick={() => { setMyToken(''); setMyTokenInput(''); }}>
              Try again
            </button>
          </div>
        )}
      </div>

      <div className="patient-queue-list">
        <div className="pql-title">
          <Icon id="list" size={13} />
          Full Queue ({totalWaiting} waiting)
        </div>
        {queue?.waitingPatients?.length === 0 && (
          <div className="pql-empty">
            <Icon id="check-circle" size={20} />
            Queue is clear
          </div>
        )}
        {queue?.waitingPatients?.map((p) => {
          const isMe = p.tokenLabel === myToken;
          const receivedAt = queue?.receivedAt ?? now;
          const elapsed = now - receivedAt;
          const rowMs = Math.max(0, p.estimatedWaitMs - elapsed);
          const rowMins = rowMs > 0 ? Math.ceil(rowMs / 60000) : 0;
          return (
            <div
              key={p._id}
              className={`pql-row ${isMe ? 'my-row' : ''} ${p.isUrgent ? 'urgent-row' : ''}`}
            >
              <div className="pql-pos">{p.queuePosition}</div>
              <div className="pql-token">{p.tokenLabel}</div>
              <div className="pql-wait">
                <Icon id="clock" size={11} />
                {rowMs <= 0 ? 'soon' : `~${rowMins}m`}
              </div>
              {p.isUrgent && (
                <span className="pql-urgent" title="Urgent">
                  <Icon id="urgent" size={13} />
                </span>
              )}
              {isMe && <span className="pql-me">YOU</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WaitBar({ queuePosition, totalWaiting }) {
  if (!totalWaiting) return null;
  const progress = Math.max(5, ((totalWaiting - queuePosition) / totalWaiting) * 100);
  return (
    <div className="wait-bar-wrap">
      <div className="wait-bar-track">
        <div className="wait-bar-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="wait-bar-label">Progress through queue</div>
    </div>
  );
}

function getBreakCountdown(breakResumesAt, now) {
  if (!breakResumesAt) return null;
  const remaining = new Date(breakResumesAt) - now;
  if (remaining <= 0) return null;
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
}
