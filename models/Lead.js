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
  // Source is a free string so imported Excel sources are preserved verbatim
  // (dynamic source management). Existing values remain valid; de-duplication
  // and pretty labels are handled at read time via /leads/meta/sources.
  source: {
    type: String,
    trim: true,
    default: 'manual',
  },
  stage: {
    type: String,
    enum: [
      'not_answering', 'not_reachable', 'call_back',
      'interested', 'enrolled', 'not_interested', 'follow_up',
      /* legacy values kept for backward compatibility */
      'new', 'contacted', 'applied', 'converted', 'lost',
    ],
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

  // ── Institution Assignment ───────────────────────────────────
  assignedInstitution: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', default: null },
  institutionAssignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  institutionAssignedAt: { type: Date },
  institutionStatus: {
    type: String,
    enum: ['new', 'contacted', 'interested', 'not_interested', 'follow_up', 'converted', 'rejected'],
    default: 'new',
  },
  institutionRemarks:      { type: String, trim: true },
  institutionFollowUpDate: { type: Date },
  institutionStatusHistory: [{
    status:     { type: String },
    remarks:    { type: String },
    followUpDate: { type: Date },
    changedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    changedAt:  { type: Date, default: Date.now },
  }],

  // ── Notes & tags ────────────────────────────────────────────
  notes: { type: String, trim: true },
  tags:  [{ type: String, trim: true }],

  // ── Dates ───────────────────────────────────────────────────
  // Original business/enquiry date from an imported file (if any). Kept
  // separate from createdAt so imported leads still sort to the top by
  // recency (createdAt = when the record entered the system).
  leadDate:         { type: Date },

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

leadSchema.index({ stage: 1, createdAt: -1 });
leadSchema.index({ assignedTo: 1, stage: 1 });
leadSchema.index({ createdBy: 1, stage: 1 });
leadSchema.index({ assignedInstitution: 1 });
leadSchema.index({ assignedInstitution: 1, institutionStatus: 1 });
leadSchema.index({ assignedInstitution: 1, institutionFollowUpDate: 1 });
leadSchema.index({ score: -1 });
leadSchema.index({ nextFollowUp: 1, stage: 1 });
leadSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Lead', leadSchema);
