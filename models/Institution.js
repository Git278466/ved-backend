'use strict';

const mongoose = require('mongoose');

const institutionSchema = new mongoose.Schema(
  {
    // ── Identity ─────────────────────────────────────────────────
    name: {
      type: String,
      required: [true, 'Institution name is required'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['government', 'private', 'aided', 'ngo', 'other'],
      default: 'other',
    },

    // ── Contact ──────────────────────────────────────────────────
    principalName: { type: String, trim: true },
    email:         { type: String, lowercase: true, trim: true },
    mobile:        { type: String, trim: true },
    website:       { type: String, trim: true },

    // ── Location ─────────────────────────────────────────────────
    address: { type: String, trim: true },
    city:    { type: String, trim: true },
    state:   { type: String, trim: true },
    country: { type: String, trim: true, default: 'India' },
    pincode: { type: String, trim: true },

    // ── Academic info ────────────────────────────────────────────
    affiliationCode:  { type: String, trim: true },
    affiliatedTo:     { type: String, trim: true },  // e.g. CBSE, ICSE, State Board
    establishedYear:  { type: Number, min: 1800, max: new Date().getFullYear() },
    totalStudents:    { type: Number, default: 0, min: 0 },

    // ── Status & linking ─────────────────────────────────────────
    status: {
      type: String,
      enum: ['active', 'inactive', 'pending'],
      default: 'active',
    },
    linkedAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },

    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

// ── Compound indexes ──────────────────────────────────────────────
institutionSchema.index({ state: 1, city: 1, status: 1 });
institutionSchema.index({ status: 1, type: 1 });
institutionSchema.index({ createdAt: -1 });

// ── Text search ───────────────────────────────────────────────────
institutionSchema.index(
  { name: 'text', city: 'text', state: 'text', principalName: 'text' },
  { name: 'institution_text_search', weights: { name: 10, city: 3, state: 2 } }
);

// ── Virtual: student count via ref ───────────────────────────────
institutionSchema.virtual('studentCount', {
  ref:          'Student',
  localField:   '_id',
  foreignField: 'institution',
  count:        true,
});

institutionSchema.set('toJSON',   { virtuals: true });
institutionSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Institution', institutionSchema);
