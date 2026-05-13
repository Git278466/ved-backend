'use strict';

const mongoose = require('mongoose');

const certificateSchema = new mongoose.Schema(
  {
    // ── Core ──────────────────────────────────────────────────────
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    certificateNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    // ── Course details ────────────────────────────────────────────
    courseCompleted: { type: String, trim: true },
    programName:     { type: String, trim: true },
    grade:           { type: String, trim: true },        // e.g. A+, Distinction
    percentage:      { type: Number, min: 0, max: 100 },

    // ── Dates ─────────────────────────────────────────────────────
    issuedDate:  { type: Date, default: Date.now },
    expiryDate:  { type: Date },
    validFrom:   { type: Date },

    // ── Status ───────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['active', 'revoked', 'expired'],
      default: 'active',
    },
    revokedAt:     { type: Date },
    revokedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    revokeReason:  { type: String, trim: true },

    // ── Document ─────────────────────────────────────────────────
    pdfUrl:        { type: String, trim: true },
    verifyUrl:     { type: String, trim: true },    // public verify link
    qrCode:        { type: String, trim: true },    // QR code data URL

    // ── Meta ─────────────────────────────────────────────────────
    issuedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    remarks:   { type: String, trim: true },
  },
  { timestamps: true }
);

// ── Compound indexes ──────────────────────────────────────────────
certificateSchema.index({ student: 1, status: 1 });
certificateSchema.index({ status: 1, issuedDate: -1 });
certificateSchema.index({ expiryDate: 1, status: 1 });     // expiry monitoring
certificateSchema.index({ issuedBy: 1, createdAt: -1 });
certificateSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Certificate', certificateSchema);
