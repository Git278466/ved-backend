'use strict';

const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema(
  {
    // ── Donor ─────────────────────────────────────────────────────
    donorName:   { type: String, required: true, trim: true },
    donorEmail:  { type: String, lowercase: true, trim: true },
    donorMobile: { type: String, trim: true },
    donorType:   { type: String, enum: ['individual', 'organization', 'anonymous'], default: 'individual' },

    // Link to partner if donor is a known partner
    partner: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },

    // ── Amount ───────────────────────────────────────────────────
    amount:   { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'INR', uppercase: true },

    // ── Payment ──────────────────────────────────────────────────
    paymentMode: {
      type: String,
      enum: ['upi', 'bank_transfer', 'cheque', 'cash', 'online', 'other'],
      default: 'online',
    },
    transactionId: { type: String, trim: true },
    receiptNumber: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
    },

    // ── Purpose ──────────────────────────────────────────────────
    purpose:      { type: String, trim: true },
    campaign:     { type: String, trim: true },          // e.g. "Diwali Drive 2025"
    restricted:   { type: Boolean, default: false },     // restricted to specific purpose

    // ── Status ───────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'failed', 'refunded'],
      default: 'pending',
    },
    donationDate: { type: Date, default: Date.now },

    // ── Tax / Compliance ─────────────────────────────────────────
    taxExempt:     { type: Boolean, default: false },
    panNumber:     { type: String, trim: true },          // PAN for 80G exemption
    section80GIssued: { type: Boolean, default: false },

    // ── Meta ─────────────────────────────────────────────────────
    notes:      { type: String, trim: true },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

// ── Compound indexes ──────────────────────────────────────────────
donationSchema.index({ status: 1, donationDate: -1 });
donationSchema.index({ donorEmail: 1, donationDate: -1 });
donationSchema.index({ recordedBy: 1, donationDate: -1 });
donationSchema.index({ amount: -1 });
donationSchema.index({ createdAt: -1 });

// ── Text search ───────────────────────────────────────────────────
donationSchema.index(
  { donorName: 'text', donorEmail: 'text', transactionId: 'text', receiptNumber: 'text' },
  { name: 'donation_text_search', weights: { donorName: 10, transactionId: 8, receiptNumber: 8 } }
);

module.exports = mongoose.model('Donation', donationSchema);
