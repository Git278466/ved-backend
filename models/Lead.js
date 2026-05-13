'use strict';

const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  // ── Basic info ──────────────────────────────────────────────
  name:         { type: String, required: true, trim: true },
  email:        { type: String, trim: true, lowercase: true },
  mobile:       { type: String, trim: true },
  city:         { type: String, trim: true },
  state:        { type: String, trim: true },
  courseInterest: { type: String, trim: true },

  // ── Classification ──────────────────────────────────────────
  source: {
    type: String,
    enum: ['website', 'referral', 'event', 'social_media', 'walk_in', 'manual', 'csv_import', 'other'],
    default: 'manual',
  },
  stage: {
    type: String,
    enum: ['new', 'contacted', 'interested', 'applied', 'enrolled', 'converted', 'lost'],
    default: 'new',
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },

  // ── Scoring (0-100) ─────────────────────────────────────────
  score: { type: Number, default: 10, min: 0, max: 100 },

  // ── Assignment ──────────────────────────────────────────────
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },

  // ── Notes & tags ────────────────────────────────────────────
  notes: { type: String, trim: true },
  tags:  [{ type: String, trim: true }],

  // ── Follow-up tracking ──────────────────────────────────────
  nextFollowUp:     { type: Date },
  lastContactedAt:  { type: Date },

  // ── Conversion ──────────────────────────────────────────────
  convertedAt:         { type: Date },
  convertedToStudent:  { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },

  // ── Referral & Commission ────────────────────────────────────
  referrerType: {
    type: String,
    enum: ['individual', 'institution', 'partner'],
    default: 'individual',
  },
  referrer:            { type: mongoose.Schema.Types.ObjectId, ref: 'Referrer',    default: null },
  referrerInstitution: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', default: null },
  referrerPartner:     { type: mongoose.Schema.Types.ObjectId, ref: 'Partner',     default: null },
  referredByName:      { type: String, trim: true },  // denormalised name for quick display
  totalAmount:         { type: Number, default: 0, min: 0 },
  commissionPct:       { type: Number, default: 0, min: 0, max: 100 },
  commissionAmount:    { type: Number, default: 0, min: 0 },
  commissionStatus: {
    type: String,
    enum: ['none', 'pending', 'approved', 'paid', 'cancelled'],
    default: 'none',
  },
  commissionPaidAt: { type: Date },
  commissionNotes:  { type: String, trim: true },

  // ── Meta ────────────────────────────────────────────────────
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
}, { timestamps: true });

leadSchema.index({ stage: 1 });
leadSchema.index({ assignedTo: 1 });
leadSchema.index({ score: -1 });
leadSchema.index({ nextFollowUp: 1 });
leadSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Lead', leadSchema);
