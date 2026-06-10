import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import { Icon } from '../App';

export default function ReceptionistView({ onBack }) {
  const { queue, emit, connected } = useSocket();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const nameRef = useRef(null);

  const [showBreakModal, setShowBreakModal] = useState(false);
  const [breakReason, setBreakReason] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('');

  const [showSettings, setShowSettings] = useState(false);
  const [settingsBaseline, setSettingsBaseline] = useState('');
  const [settingsClinicName, setSettingsClinicName] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (queue && !showSettings) {
      setSettingsBaseline(String(queue.baselineConsultationMinutes));
      setSettingsClinicName(queue.clinicName);
    }
  }, [queue?.baselineConsultationMinutes, queue?.clinicName, showSettings]);

  useEffect(() => {
    if (showSettings && queue) {
      setSettingsBaseline(String(queue.baselineConsultationMinutes));
      setSettingsClinicName(queue.clinicName);
      setSettingsSaved(false);
    }
  }, [showSettings]);

  function handleSaveSettings() {
    const mins = parseFloat(settingsBaseline);
    if (!isNaN(mins) && mins > 0) emit('set_baseline', { minutes: mins });
    if (settingsClinicName.trim()) emit('set_clinic_name', { name: settingsClinicName.trim() });
    setSettingsSaved(true);
    setTimeout(() => { setSettingsSaved(false); setShowSettings(false); }, 900);
  }

  function handleAddPatient(e) {
    e.preventDefault();
    if (!name.trim()) return;
    emit('add_patient', { name, phone, isUrgent });
    setName('');
    setPhone('');
    setIsUrgent(false);
    nameRef.current?.focus();
  }

  function handleCallNext() { emit('call_next'); }

  function handleToggleBreak() {
    if (queue?.doctorOnBreak) { emit('toggle_break', {}); }
    else { setShowBreakModal(true); }
  }

  function submitBreak() {
    emit('toggle_break', {
      reason: breakReason || 'Short break',
      resumeInMinutes: breakMinutes ? parseFloat(breakMinutes) : null,
    });
    setShowBreakModal(false);
    setBreakReason('');
    setBreakMinutes('');
  }

  function getElapsed() {
    if (!queue?.servingStartedAt || queue?.doctorOnBreak) return null;
    const ms = Date.now() - new Date(queue.servingStartedAt);
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return { text: `${mins}m ${secs}s`, overAvg: queue.effectiveAvgMs && ms > queue.effectiveAvgMs };
  }

  function getBreakCountdown() {
    if (!queue?.breakResumesAt) return null;
    const remaining = new Date(queue.breakResumesAt) - Date.now();
    if (remaining <= 0) return 'Overdue';
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    return `${mins}m ${secs}s remaining`;
  }

  const elapsed = getElapsed();
  const breakCountdown = getBreakCountdown();
  const avgLabel = queue?.isAdaptive
    ? `${queue.effectiveAvgMin} min (adaptive · ${queue.dataPoints} seen)`
    : `${queue?.effectiveAvgMin ?? '–'} min (baseline)`;

  return (
    <div className={`receptionist-layout ${queue?.doctorOnBreak ? 'break-mode' : ''}`}>
      <header className="rec-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <div className="rec-header-center">
          <span className="rec-clinic-name">{queue?.clinicName || '—'}</span>
          <span className="rec-header-date">{queue?.date || '—'}</span>
        </div>
        <div className="rec-header-right">
          <div className={`conn-pill ${connected ? 'connected' : 'disconnected'}`}>
            <span className="conn-dot-inner" />
            <span className="conn-label">{connected ? 'Live' : 'Offline'}</span>
          </div>
          <button
            className={`settings-btn ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(s => !s)}
            aria-label="Settings"
            title="Clinic settings"
          >
            <Icon id="settings" size={16} />
          </button>
        </div>
      </header>

      <div className={`settings-panel ${showSettings ? 'open' : ''}`} aria-hidden={!showSettings}>
        <div className="settings-inner">
          <div className="settings-header-row">
            <div className="settings-title"><Icon id="settings" size={16} />Clinic Settings</div>
            <button className="settings-close" onClick={() => setShowSettings(false)} aria-label="Close settings">
              <Icon id="x" size={16} />
            </button>
          </div>
          <div className="settings-fields">
            <div className="settings-field">
              <label className="settings-label" htmlFor="set-clinic-name">Clinic name</label>
              <input id="set-clinic-name" className="settings-input" value={settingsClinicName}
                onChange={e => setSettingsClinicName(e.target.value)}
                placeholder="e.g. Sunrise Medical Centre"
                onKeyDown={e => e.key === 'Enter' && handleSaveSettings()} />
            </div>
            <div className="settings-field">
              <label className="settings-label" htmlFor="set-baseline">
                Baseline consultation time
                <span className="settings-label-hint">minutes per patient</span>
              </label>
              <input id="set-baseline" className="settings-input settings-input-sm" type="number"
                value={settingsBaseline} min="1" max="120"
                onChange={e => setSettingsBaseline(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveSettings()} />
            </div>
          </div>
          <div className="settings-footer">
            <p className="settings-note">
              <Icon id="activity" size={12} />
              After 2 consultations the system switches to adaptive mode automatically.
            </p>
            <button className={`settings-save-btn ${settingsSaved ? 'saved' : ''}`} onClick={handleSaveSettings}>
              {settingsSaved ? <><Icon id="check-circle" size={15} /> Saved</> : <><Icon id="save" size={15} /> Save changes</>}
            </button>
          </div>
        </div>
      </div>

      {queue?.doctorOnBreak && (
        <div className="break-banner">
          <Icon id="coffee" size={16} />
          <span className="break-text">
            Doctor on break — <strong>{queue.breakReason}</strong>
            {breakCountdown && <span className="break-countdown"> · {breakCountdown}</span>}
          </span>
          <button className="resume-btn" onClick={handleToggleBreak}>
            <Icon id="play" size={13} />Resume
          </button>
        </div>
      )}

      <div className="rec-body">
        <div className="rec-left">
          <div className="now-serving-card">
            <div className="ns-label">NOW SERVING</div>
            {queue?.servingPatient ? (
              <>
                <div className="ns-token">{queue.servingPatient.tokenLabel}</div>
                <div className="ns-name">{queue.servingPatient.name}</div>
                {queue.servingPatient.isUrgent && (
                  <div className="urgent-badge"><Icon id="urgent" size={10} />URGENT</div>
                )}
                {elapsed && (
                  <div className={`ns-timer ${elapsed.overAvg ? 'over-avg' : ''}`}>
                    <span className="timer-dot" />
                    {elapsed.text}
                    {queue.effectiveAvgMs && (
                      <span className="timer-vs"> / {Math.round(queue.effectiveAvgMs / 60000)}m avg</span>
                    )}
                    {elapsed.overAvg && <span className="over-label"> · running late</span>}
                  </div>
                )}
                {/* Not available button for currently serving patient */}
                <button
                  className="qr-btn not-available-action"
                  style={{ marginTop: '8px', width: '100%' }}
                  onClick={() => emit('patient_not_available', { patientId: queue.servingPatient._id })}
                >
                  <Icon id="x" size={12} /> Patient Not Available
                </button>
              </>
            ) : (
              <div className="ns-empty">Queue not started</div>
            )}
            <button
              className={`call-next-btn ${!queue?.waitingCount && !queue?.servingPatient ? 'disabled' : ''}`}
              onClick={handleCallNext}
              disabled={queue?.doctorOnBreak}
            >
              {queue?.servingPatient ? 'Call Next' : 'Start Queue'}
              <Icon id="arrow-right" size={16} />
            </button>
          </div>

          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-icon"><Icon id="users" size={14} /></div>
              <div className="stat-value">{queue?.waitingCount ?? '—'}</div>
              <div className="stat-label">Waiting</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon"><Icon id="check-circle" size={14} /></div>
              <div className="stat-value">{queue?.dataPoints ?? 0}</div>
              <div className="stat-label">Seen today</div>
            </div>
            <div className="stat-card adaptive">
              <div className="stat-icon">
                <Icon id={queue?.isAdaptive ? 'zap' : 'clipboard'} size={14} />
              </div>
              <div className="stat-label-mode">{queue?.isAdaptive ? 'Adaptive' : 'Baseline'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon"><Icon id="clock" size={14} /></div>
              <div className="stat-value avg-val">{avgLabel}</div>
              <div className="stat-label">Avg consult</div>
            </div>
          </div>

          <div className="add-patient-card">
            <div className="card-title"><Icon id="list" size={14} />Add Patient</div>
            <form className="add-form" onSubmit={handleAddPatient}>
              <input ref={nameRef} className="form-input" placeholder="Patient name *"
                value={name} onChange={e => setName(e.target.value)} autoFocus />
              <input className="form-input" placeholder="Phone (optional)"
                value={phone} onChange={e => setPhone(e.target.value)} />
              <div className="form-bottom">
                <label className="urgent-toggle">
                  <input type="checkbox" checked={isUrgent} onChange={e => setIsUrgent(e.target.checked)} />
                  <span className="urgent-toggle-label"><Icon id="urgent" size={12} />Urgent / Priority</span>
                </label>
                <button type="submit" className="add-btn" disabled={!name.trim()}>
                  Assign Token<Icon id="arrow-right" size={14} />
                </button>
              </div>
            </form>
          </div>

          <button className={`break-btn ${queue?.doctorOnBreak ? 'on-break' : ''}`} onClick={handleToggleBreak}>
            {queue?.doctorOnBreak
              ? <><Icon id="play" size={15} /> Resume from Break</>
              : <><Icon id="coffee" size={15} /> Doctor Break</>}
          </button>
        </div>

        <div className="rec-right">
          <div className="queue-header">
            <span className="queue-title"><Icon id="list" size={16} />Waiting Queue</span>
            <span className="queue-count">{queue?.waitingCount ?? 0} patients</span>
          </div>
          <div className="queue-list">
            {queue?.waitingPatients?.length === 0 && (
              <div className="queue-empty">
                <div className="queue-empty-icon"><Icon id="check-circle" size={36} /></div>
                <div>Queue is clear</div>
              </div>
            )}
            {queue?.waitingPatients?.map((p, idx) => (
              <QueueRow key={p._id} patient={p} position={idx + 1} isNext={idx === 0} emit={emit} />
            ))}
          </div>

          {queue?.recentDone?.length > 0 && (
            <div className="done-section">
              <div className="done-title"><Icon id="check-circle" size={12} />Recently Completed</div>
              {queue.recentDone.map((p, i) => (
                <div key={i} className="done-row">
                  <span className="done-token">{p.tokenLabel}</span>
                  <span className="done-name">{p.name}</span>
                  <span className="done-time">{formatTime(p.doneAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showBreakModal && (
        <div className="modal-overlay" onClick={() => setShowBreakModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title"><Icon id="coffee" size={18} />Doctor Break</div>
            <input className="form-input" placeholder="Reason (e.g. Lunch break)"
              value={breakReason} onChange={e => setBreakReason(e.target.value)} autoFocus />
            <input className="form-input" type="number"
              placeholder="Resume in how many minutes? (optional)"
              value={breakMinutes} onChange={e => setBreakMinutes(e.target.value)} />
            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => setShowBreakModal(false)}>Cancel</button>
              <button className="modal-confirm" onClick={submitBreak}>
                <Icon id="pause" size={14} />Start Break
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── QueueRow with inline edit + not available ──────────────────────────────
function QueueRow({ patient, position, isNext, emit }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(patient.name);
  const editRef = useRef(null);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  // Keep editName in sync if queue snapshot updates the name externally
  useEffect(() => {
    if (!editing) setEditName(patient.name);
  }, [patient.name, editing]);

  function handleSaveName() {
    if (editName.trim() && editName.trim() !== patient.name) {
      emit('edit_patient', { patientId: patient._id, name: editName.trim() });
    }
    setEditing(false);
  }

  function handleNotAvailable() {
    emit('patient_not_available', { patientId: patient._id });
    setExpanded(false);
  }

  return (
    <div className={`queue-row ${isNext ? 'next-up' : ''} ${patient.isUrgent ? 'urgent-row' : ''}`}>
      <div className="qr-main" onClick={() => !editing && setExpanded(e => !e)}>
        <div className="qr-position">{position}</div>
        <div className="qr-token">{patient.tokenLabel}</div>
        <div className="qr-info">
          {editing ? (
            <input
              ref={editRef}
              className="form-input qr-edit-input"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') { setEditing(false); setEditName(patient.name); }
              }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <div className="qr-name">
              {patient.name}
              {patient.isUrgent && <span className="urgent-pip" title="Urgent"><Icon id="urgent" size={12} /></span>}
              {isNext && <span className="next-pip">NEXT</span>}
            </div>
          )}
          <div className="qr-wait">
            <Icon id="clock" size={11} />
            ~{patient.estimatedWaitMin} min wait
          </div>
        </div>
        <div className="qr-expand">
          <Icon id={expanded ? 'chevron-up' : 'chevron-down'} size={15} />
        </div>
      </div>

      {expanded && (
        <div className="qr-actions">
          {patient.phone && (
            <span className="qr-phone"><Icon id="phone" size={12} />{patient.phone}</span>
          )}
          {editing ? (
            <>
              <button className="qr-btn save-action" onClick={handleSaveName}>
                <Icon id="check-circle" size={12} /> Save Name
              </button>
              <button className="qr-btn" onClick={() => { setEditing(false); setEditName(patient.name); }}>
                Cancel
              </button>
            </>
          ) : (
            <button className="qr-btn edit-action" onClick={e => { e.stopPropagation(); setEditing(true); }}>
              <Icon id="edit" size={12} /> Edit Name
            </button>
          )}
          {!patient.isUrgent && (
            <button className="qr-btn urgent-action"
              onClick={() => emit('mark_urgent', { patientId: patient._id })}>
              <Icon id="urgent" size={12} />Mark Urgent
            </button>
          )}
          <button className="qr-btn not-available-action" onClick={handleNotAvailable}>
            <Icon id="x" size={12} />Not Available
          </button>
          <button className="qr-btn skip-action"
            onClick={() => emit('skip_patient', { patientId: patient._id })}>
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
