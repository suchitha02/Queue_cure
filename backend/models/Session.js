const mongoose = require('mongoose');

const consultationLogSchema = new mongoose.Schema({
  tokenNumber: Number,
  patientName: String,
  startedAt: Date,
  endedAt: Date,
  durationMs: Number,
});

const patientSchema = new mongoose.Schema({
  tokenNumber: { type: Number, required: true },
  tokenLabel: { type: String, required: true },
  name: { type: String, required: true },
  phone: { type: String, default: '' },
  status: {
    type: String,
    enum: ['waiting', 'serving', 'done', 'skipped'],
    default: 'waiting',
  },
  isUrgent: { type: Boolean, default: false },
  addedAt: { type: Date, default: Date.now },
  calledAt: { type: Date },
  doneAt: { type: Date },
});

const sessionSchema = new mongoose.Schema({
  // unique: true prevents duplicate sessions for the same day (race condition fix)
  date: { type: String, required: true, unique: true },
  clinicName: { type: String, default: 'Neighbourhood Clinic' },
  isOpen: { type: Boolean, default: true },
  doctorOnBreak: { type: Boolean, default: false },
  breakReason: { type: String, default: '' },
  breakResumesAt: { type: Date },

  tokenCounter: { type: Number, default: 0 },
  tokenPrefix: { type: String, default: 'A' },

  currentToken: { type: Number, default: 0 },
  currentPatientName: { type: String, default: '' },
  servingStartedAt: { type: Date },

  baselineConsultationMinutes: { type: Number, default: 10 },

  // Adaptive wait engine — EMA with alpha=0.3
  rollingAvgMs: { type: Number, default: null },
  consultationCount: { type: Number, default: 0 },
  consultationLogs: [consultationLogSchema],

  patients: [patientSchema],
}, { timestamps: true });

// Effective avg consultation duration in ms
sessionSchema.methods.getEffectiveAvgMs = function () {
  if (this.rollingAvgMs !== null && this.consultationCount >= 2) {
    return this.rollingAvgMs;
  }
  return this.baselineConsultationMinutes * 60 * 1000;
};

// Wait time for a patient at queue index `tokensAhead` (0 = next up)
sessionSchema.methods.computeWaitMs = function (tokensAhead) {
  const avgMs = this.getEffectiveAvgMs();

  // Break contribution: if no resumeAt is set, assume 15 min unknown break
  // so patients never see "0 min wait" while doctor is actually on break
  let breakMs = 0;
  if (this.doctorOnBreak) {
    if (this.breakResumesAt) {
      const remaining = new Date(this.breakResumesAt) - Date.now();
      breakMs = remaining > 0 ? remaining : 0;
    } else {
      breakMs = 15 * 60 * 1000; // unknown break — show conservative 15 min
    }
  }

  // Remaining time for whoever is currently being served
  let currentRemaining = 0;
  if (this.servingStartedAt && !this.doctorOnBreak) {
    const elapsed = Date.now() - new Date(this.servingStartedAt);
    currentRemaining = Math.max(0, avgMs - elapsed);
  }

  return breakMs + currentRemaining + tokensAhead * avgMs;
};

module.exports = mongoose.model('Session', sessionSchema);
