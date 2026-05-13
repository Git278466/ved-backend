'use strict';

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const studentSchema = new mongoose.Schema(
  {
    // ── Identity ─────────────────────────────────────────────────
    fullName: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email address'],
    },

    password:  { type: String, minlength: 6, select: false },
    mobile:    { type: String, trim: true },

    // ── Demographics ─────────────────────────────────────────────
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'Male', 'Female', 'Other', ''],
      default: '',
      set: (v) => (v ? v.toLowerCase() : v),
    },
    dateOfBirth: { type: Date },
    category: {
      type: String,
      enum: ['general', 'obc', 'sc', 'st', 'ews', ''],
      default: '',
    },

    // ── Location ─────────────────────────────────────────────────
    city:    { type: String, trim: true },
    state:   { type: String, trim: true },
    country: { type: String, trim: true, default: 'India' },
    pincode: { type: String, trim: true },

    // ── Academic ─────────────────────────────────────────────────
    standard:         { type: String, trim: true, default: '' },
    stream: {
      type: String,
      enum: ['science', 'commerce', 'arts', 'cs_it', ''],
      default: '',
    },
    schoolName:       { type: String, trim: true },
    percentageCgpa:   { type: String, trim: true },
    graduationCourse: { type: String, trim: true },
    specialization:   { type: String, trim: true },
    collegeName:      { type: String, trim: true },
    graduationCgpa:   { type: String, trim: true },
    passingYear:      { type: Number, min: 1990, max: 2100 },

    // ── Institution link ─────────────────────────────────────────
    institution:     { type: mongoose.Schema.Types.ObjectId, ref: 'Institution' },
    institutionType: {
      type: String,
      enum: ['government', 'private', 'aided', 'ngo', ''],
      default: '',
    },

    // ── Status ───────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'waitlisted'],
      default: 'pending',
    },
    statusReason:    { type: String, trim: true },
    statusUpdatedAt: { type: Date },
    statusUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },

    // ── Certificate ──────────────────────────────────────────────
    certificateIssued:   { type: Boolean, default: false },
    certificateNumber:   { type: String, trim: true, sparse: true },
    certificateIssuedAt: { type: Date },
    certificateStatus: {
      type: String,
      enum: ['not_applicable', 'pending', 'issued'],
      default: 'not_applicable',
    },

    // ── Attendance counters (denormalised for fast reads) ─────────
    totalAttendance: { type: Number, default: 0, min: 0 },
    presentCount:    { type: Number, default: 0, min: 0 },

    // ── Meta ─────────────────────────────────────────────────────
    notes:            { type: String, trim: true },
    lastLogin:        { type: Date },
    submittedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    registrationDate: { type: Date, default: Date.now },
    workshopAttended: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ── Pre-save: hash password ───────────────────────────────────────
studentSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ── Instance method ───────────────────────────────────────────────
studentSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// ── Virtual: attendance percentage ───────────────────────────────
studentSchema.virtual('attendancePercent').get(function () {
  if (!this.totalAttendance) return 0;
  return Math.round((this.presentCount / this.totalAttendance) * 100);
});

studentSchema.set('toJSON',   { virtuals: true });
studentSchema.set('toObject', { virtuals: true });

// ── Indexes (compound + text only — single-field indexes already
//   declared via "index:true" / "unique:true" on each field) ───────
studentSchema.index({ status: 1, registrationDate: -1 });
studentSchema.index({ city: 1, state: 1 });
studentSchema.index({ standard: 1, state: 1 });
studentSchema.index({ institution: 1, status: 1 });
studentSchema.index({ createdAt: -1 });

studentSchema.index(
  { fullName: 'text', email: 'text', mobile: 'text', city: 'text', schoolName: 'text' },
  { name: 'student_text_search', weights: { fullName: 10, email: 5, mobile: 5, city: 2 } }
);

module.exports = mongoose.model('Student', studentSchema);
