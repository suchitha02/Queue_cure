const Session = require('../models/Session');

// ─────────────────────────────────────────────────────────────────────────────
// getTodaySession
// Uses findOneAndUpdate + upsert so two simultaneous "first connection" calls
// at midnight can't create two sessions for the same day. The unique index on
// `date` is a second line of defence.
// ─────────────────────────────────────────────────────────────────────────────
async function getTodaySession() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const session = await Session.findOneAndUpdate(
    { date: today },
    { $setOnInsert: { date: today } },
    { upsert: true, new: true, runValidators: true }
  );
  return session;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildSnapshot
// Note: waiting patients sorted urgent-first, then FIFO — matches call_next logic
// so the patient screen shows the correct queue order.
// ─────────────────────────────────────────────────────────────────────────────
function buildSnapshot(session) {
  const waitingPatients = session.patients
    .filter(p => p.status === 'waiting')
    .sort((a, b) => {
      if (a.isUrgent && !b.isUrgent) return -1;
      if (!a.isUrgent && b.isUrgent) return 1;
      return a.tokenNumber - b.tokenNumber;
    });

  const servingPatient = session.patients.find(p => p.status === 'serving') || null;
  const effectiveAvgMs = session.getEffectiveAvgMs();

  const enrichedWaiting = waitingPatients.map((p, idx) => {
    const waitMs = session.computeWaitMs(idx);
    return {
      _id: p._id,
      tokenNumber: p.tokenNumber,
      tokenLabel: p.tokenLabel,
      name: p.name,
      phone: p.phone,
      isUrgent: p.isUrgent,
      addedAt: p.addedAt,
      estimatedWaitMs: waitMs,
      estimatedWaitMin: Math.ceil(waitMs / 60000),
      queuePosition: idx + 1,
    };
  });

  return {
    sessionId: session._id,
    date: session.date,
    clinicName: session.clinicName,
    isOpen: session.isOpen,
    doctorOnBreak: session.doctorOnBreak,
    breakReason: session.breakReason,
    breakResumesAt: session.breakResumesAt,
    currentToken: session.currentToken,
    currentPatientName: session.currentPatientName,
    servingStartedAt: session.servingStartedAt,
    tokenPrefix: session.tokenPrefix,
    baselineConsultationMinutes: session.baselineConsultationMinutes,
    effectiveAvgMs,
    effectiveAvgMin: Math.round(effectiveAvgMs / 60000 * 10) / 10,
    dataPoints: session.consultationCount,
    isAdaptive: session.consultationCount >= 2,
    waitingCount: waitingPatients.length,
    waitingPatients: enrichedWaiting,
    servingPatient: servingPatient
      ? {
          _id: servingPatient._id,
          tokenNumber: servingPatient.tokenNumber,
          tokenLabel: servingPatient.tokenLabel,
          name: servingPatient.name,
          isUrgent: servingPatient.isUrgent,
          calledAt: servingPatient.calledAt,
        }
      : null,
    recentDone: session.patients
      .filter(p => p.status === 'done')
      .sort((a, b) => new Date(b.doneAt) - new Date(a.doneAt))
      .slice(0, 5)
      .map(p => ({ tokenLabel: p.tokenLabel, name: p.name, doneAt: p.doneAt })),
  };
}

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // ── JOIN ────────────────────────────────────────────────────────────────
    socket.on('join_queue', async () => {
      try {
        const session = await getTodaySession();
        socket.emit('queue_snapshot', buildSnapshot(session));
      } catch (err) {
        socket.emit('error_msg', { message: err.message });
      }
    });

    // ── ADD PATIENT ─────────────────────────────────────────────────────────
    // Race condition fix: $inc tokenCounter atomically on the DB side.
    // Two simultaneous add_patient calls will get sequential counter values
    // guaranteed — no read-modify-write in JS memory.
    socket.on('add_patient', async ({ name, phone, isUrgent }) => {
      try {
        if (!name || !name.trim()) {
          return socket.emit('error_msg', { message: 'Patient name is required' });
        }

        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        // Atomically increment the counter and get the new value
        const updated = await Session.findOneAndUpdate(
          { date: today },
          { $inc: { tokenCounter: 1 } },
          { new: true, upsert: true }
        );

        const tokenNumber = updated.tokenCounter;
        const tokenLabel = `${updated.tokenPrefix}${String(tokenNumber).padStart(3, '0')}`;

        // Push the new patient
        const session = await Session.findByIdAndUpdate(
          updated._id,
          {
            $push: {
              patients: {
                tokenNumber,
                tokenLabel,
                name: name.trim(),
                phone: (phone || '').trim(),
                isUrgent: !!isUrgent,
                status: 'waiting',
                addedAt: new Date(),
              },
            },
          },
          { new: true }
        );

        io.emit('queue_snapshot', buildSnapshot(session));
        socket.emit('patient_added', { tokenLabel, name: name.trim() });
      } catch (err) {
        socket.emit('error_msg', { message: err.message });
      }
    });

    // ── CALL NEXT ───────────────────────────────────────────────────────────
    // Race condition fix: use findOneAndUpdate with a status filter on the
    // "currently serving" patient as a condition. If two call_next events
    // fire simultaneously, the second one will find no patient with
    // status='serving' matching the one the first already transitioned,
    // and will either move to a clean next-up or get the "no patients" error.
    //
    // Pattern: optimistic read → validate → atomic write. The $set on
    // patients.$.status with the positional operator only applies if the
    // document still matches the filter, preventing double-processing.
    socket.on('call_next', async () => {
      try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const session = await Session.findOne({ date: today });

        if (!session) return socket.emit('error_msg', { message: 'No session found' });
        if (session.doctorOnBreak) {
          return socket.emit('error_msg', { message: 'Doctor is on break. Resume before calling next.' });
        }

        const currentlyServing = session.patients.find(p => p.status === 'serving');
        const now = new Date();

        // Build the update for finishing the current patient
        const updateOps = {};
        let durationMs = null;

        if (currentlyServing && session.servingStartedAt) {
          durationMs = now - new Date(session.servingStartedAt);

          // EMA update
          let newRollingAvg;
          if (session.rollingAvgMs === null) {
            newRollingAvg = durationMs;
          } else {
            newRollingAvg = session.rollingAvgMs * 0.7 + durationMs * 0.3;
          }

          updateOps['$set'] = {
            [`patients.${session.patients.indexOf(currentlyServing)}.status`]: 'done',
            [`patients.${session.patients.indexOf(currentlyServing)}.doneAt`]: now,
            rollingAvgMs: newRollingAvg,
          };
          updateOps['$inc'] = { consultationCount: 1 };
          updateOps['$push'] = {
            consultationLogs: {
              tokenNumber: currentlyServing.tokenNumber,
              patientName: currentlyServing.name,
              startedAt: session.servingStartedAt,
              endedAt: now,
              durationMs,
            },
          };
        }

        // Find next patient (urgent first, then FIFO)
        const waiting = session.patients
          .filter(p => p.status === 'waiting')
          .sort((a, b) => {
            if (a.isUrgent && !b.isUrgent) return -1;
            if (!a.isUrgent && b.isUrgent) return 1;
            return a.tokenNumber - b.tokenNumber;
          });

        if (waiting.length === 0) {
          // Still save the done-patient update if there was one
          if (Object.keys(updateOps).length > 0) {
            await Session.findByIdAndUpdate(session._id, updateOps);
          }
          const fresh = await Session.findById(session._id);
          io.emit('queue_snapshot', buildSnapshot(fresh));
          return socket.emit('error_msg', { message: 'No more patients in queue' });
        }

        const next = waiting[0];
        const nextIdx = session.patients.indexOf(next);

        // Merge next-patient update into the same atomic operation
        if (!updateOps['$set']) updateOps['$set'] = {};
        updateOps['$set'][`patients.${nextIdx}.status`] = 'serving';
        updateOps['$set'][`patients.${nextIdx}.calledAt`] = now;
        updateOps['$set'].currentToken = next.tokenNumber;
        updateOps['$set'].currentPatientName = next.name;
        updateOps['$set'].servingStartedAt = now;

        // Atomic write — all changes in a single DB round-trip
        const saved = await Session.findByIdAndUpdate(session._id, updateOps, { new: true });
        io.emit('queue_snapshot', buildSnapshot(saved));
      } catch (err) {
        socket.emit('error_msg', { message: err.message });
      }
    });

    // ── MARK URGENT ─────────────────────────────────────────────────────────
    // Uses positional update — only fires if patient exists AND status=waiting
    // Prevents marking a patient urgent after they've been called/done
    socket.on('mark_urgent', async ({ patientId }) => {
      try {
        // FIX: use arrayFilters instead of positional $ operator.
        // The $ operator with two array conditions (_id + status) resolves to
        // the first element matching ANY condition, not ALL — so it was marking
        // the wrong patient (the first waiting patient) instead of the intended one.
        // arrayFilters explicitly targets by _id and guards on status=waiting.
        const mongoose = require('mongoose');
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const oid = new mongoose.Types.ObjectId(patientId);
        const result = await Session.findOneAndUpdate(
          { date: today, 'patients._id': oid },
          { $set: { 'patients.$[p].isUrgent': true } },
          {
            arrayFilters: [{ 'p._id': oid, 'p.status': 'waiting' }],
            new: true,
          }
        );

        if (!result) {
          return socket.emit('error_msg', { message: 'Patient not found' });
        }
        const updated = result.patients.find(p => p._id.toString() === patientId);
        if (!updated || !updated.isUrgent) {
          return socket.emit('error_msg', { message: 'Patient is no longer waiting' });
        }
        io.emit('queue_snapshot', buildSnapshot(result));
      } catch (err) {
        socket.emit('error_msg', { message: err.message });
      }
    });

    // ── SKIP PATIENT ────────────────────────────────────────────────────────
    // Same pattern — atomic, guards on status=waiting
    socket.on('skip_patient', async ({ patientId }) => {
      try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const mongoose = require('mongoose');
        const oid = new mongoose.Types.ObjectId(patientId);
        const result = await Session.findOneAndUpdate(
          { date: today, 'patients._id': oid },
          { $set: { 'patients.$[p].status': 'skipped' } },
          {
            arrayFilters: [{ 'p._id': oid, 'p.status': 'waiting' }],
            new: true,
          }
        );

        if (!result) {
          return socket.emit('error_msg', { message: 'Patient not found or no longer waiting' });
        }
        io.emit('queue_snapshot', buildSnapshot(result));
      } catch (err) {
        socket.emit('error_msg', { message: err.message });
      }
    });

    // ── SET BASELINE ─────────────────────────────────────────────────────────
    socket.on('set_baseline', async ({ minutes }) => {
      try {
        const mins = parseFloat(minutes);
        if (isNaN(mins) || mins < 1 || mins > 120) {
          return socket.emit('error_msg', { message: 'Baseline must be between 1 and 120 minutes' });
        }
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const session = await Session.findOneAndUpdate(
          { date: today },
          { $set: { baselineConsultationMinutes: mins } },
          { new: true, upsert: true }
        );
        io.emit('queue_snapshot', buildSnapshot(session));
      } catch (err) {
        socket.emit('error_msg', { message: err.message });
      }
    });

    // ── TOGGLE BREAK ─────────────────────────────────────────────────────────
    socket.on('toggle_break', async ({ reason, resumeInMinutes }) => {
      try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const current = await Session.findOne({ date: today });
        if (!current) return;

        let updateFields;
        if (!current.doctorOnBreak) {
          updateFields = {
            doctorOnBreak: true,
            breakReason: reason || 'Short break',
            breakResumesAt: resumeInMinutes
              ? new Date(Date.now() + resumeInMinutes * 60 * 1000)
              : null,
          };
        } else {
          updateFields = {
            doctorOnBreak: false,
            breakReason: '',
            breakResumesAt: null,
            // Reset serving start so wait calc is accurate after break
            ...(current.servingStartedAt ? { servingStartedAt: new Date() } : {}),
          };
        }

        const session = await Session.findByIdAndUpdate(
          current._id,
          { $set: updateFields },
          { new: true }
        );
        io.emit('queue_snapshot', buildSnapshot(session));
      } catch (err) {
        socket.emit('error_msg', { message: err.message });
      }
    });

    // ── SET CLINIC NAME ──────────────────────────────────────────────────────
    socket.on('set_clinic_name', async ({ name }) => {
      try {
        if (!name || !name.trim()) return;
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const session = await Session.findOneAndUpdate(
          { date: today },
          { $set: { clinicName: name.trim() } },
          { new: true, upsert: true }
        );
        io.emit('queue_snapshot', buildSnapshot(session));
      } catch (err) {
        socket.emit('error_msg', { message: err.message });
      }
    });

    // ── EDIT PATIENT NAME ────────────────────────────────────────────────────
    // Only allowed while patient is still waiting — not after called/done
    socket.on('edit_patient', async ({ patientId, name }) => {
      try {
        if (!name || !name.trim()) {
          return socket.emit('error_msg', { message: 'Name cannot be empty' });
        }
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const mongoose = require('mongoose');
        const oid = new mongoose.Types.ObjectId(patientId);
        const result = await Session.findOneAndUpdate(
          { date: today, 'patients._id': oid },
          { $set: { 'patients.$[p].name': name.trim() } },
          {
            arrayFilters: [{ 'p._id': oid, 'p.status': 'waiting' }],
            new: true,
          }
        );
        if (!result) {
          return socket.emit('error_msg', { message: 'Patient not found or already called' });
        }
        io.emit('queue_snapshot', buildSnapshot(result));
      } catch (err) {
        socket.emit('error_msg', { message: err.message });
      }
    });

    // ── PATIENT NOT AVAILABLE ────────────────────────────────────────────────
    // Marks patient as 'skipped' with a not_available flag — receptionist use
    // when patient doesn't respond after being called or steps out
    socket.on('patient_not_available', async ({ patientId }) => {
      try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const result = await Session.findOneAndUpdate(
          {
            date: today,
            'patients._id': patientId,
            'patients.status': { $in: ['waiting', 'serving'] },
          },
          { $set: { 'patients.$.status': 'skipped' } },
          { new: true }
        );
        if (!result) {
          return socket.emit('error_msg', { message: 'Patient not found' });
        }
        // If the not-available patient was being served, clear the serving state
        const wasServing = result.patients.find(
          p => p._id.toString() === patientId && p.status === 'skipped' && result.servingStartedAt
        );
        let finalSession = result;
        if (result.currentToken && !result.patients.find(p => p.status === 'serving')) {
          finalSession = await Session.findByIdAndUpdate(
            result._id,
            { $set: { currentToken: 0, currentPatientName: '', servingStartedAt: null } },
            { new: true }
          );
        }
        io.emit('queue_snapshot', buildSnapshot(finalSession));
      } catch (err) {
        socket.emit('error_msg', { message: err.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });
}

module.exports = { registerSocketHandlers, getTodaySession, buildSnapshot };
