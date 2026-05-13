'use strict';

const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    // ── Core ──────────────────────────────────────────────────────
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['present', 'absent', 'leave', 'late',
             // Accept capitalised variants from older records
             'Present', 'Absent', 'Leave'],
      default: 'present',
      set: (v) => (v ? v.toLowerCase() : v),
    },

    // ── Session context ──────────────────────────────────────────
    session:     { type: String, trim: true, default: '' },
    program:     { type: String, trim: true, default: '' },
    batchId:     { type: String, trim: true },           // for cohort-based programs
    institution: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution' },

    // ── Meta ─────────────────────────────────────────────────────
    remarks:  { type: String, trim: true, default: '' },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

// ── Prevent duplicate attendance for same student+date+session ────
attendanceSchema.index(
  { student: 1, date: 1, session: 1 },
  { unique: true, name: 'unique_student_date_session' }
);

// ── Query pattern indexes ─────────────────────────────────────────
attendanceSchema.index({ student: 1, date: -1 });          // student history
attendanceSchema.index({ date: -1, status: 1 });            // daily roll call
attendanceSchema.index({ program: 1, date: -1 });           // program reports
attendanceSchema.index({ institution: 1, date: -1 });       // institution reports
attendanceSchema.index({ markedBy: 1, createdAt: -1 });     // admin audit
attendanceSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
