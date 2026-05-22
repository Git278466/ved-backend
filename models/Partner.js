'use strict';

const mongoose     = require('mongoose');
const generateCode = require('../utils/generateCode');

const partnerSchema = new mongoose.Schema(
  {
    // ── Identity ─────────────────────────────────────────────────
    organizationName: {
      type: String,
      required: [true, 'Organization name is required'],
      trim: true,
      index: true,
    },
    contactPerson: { type: String, trim: true },
    email:         { type: String, lowercase: true, trim: true },
    mobile:        { type: String, trim: true },
    website:       { type: String, trim: true },

    // ── Location ─────────────────────────────────────────────────
    address: { type: String, trim: true },
    city:    { type: String, trim: true },
    state:   { type: String, trim: true },
    country: { type: String, trim: true, default: 'India' },

    // ── Unique code ──────────────────────────────────────────────
    code: { type: String, unique: true, sparse: true, trim: true, index: true },

    // ── Classification ───────────────────────────────────────────
    partnerType: {
      type: String,
      enum: ['ngo', 'corporate', 'government', 'individual', 'other'],
      default: 'other',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'pending'],
      default: 'active',
    },

    // ── Agreement ────────────────────────────────────────────────
    agreementDate:   { type: Date },
    agreementExpiry: { type: Date },
    agreementValue:  { type: Number, min: 0 },  // INR value of partnership

    // ── Contribution tracking ────────────────────────────────────
    studentsSupported: { type: Number, default: 0, min: 0 },
    totalDonated:      { type: Number, default: 0, min: 0 },

    // ── Assignment ───────────────────────────────────────────────
    assignedTo:  { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    linkedAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },

    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

// ── Auto-generate unique code using organization name ────────────
// Format: first 4 letters of organization name + random 4-digit number
// e.g. "Youth For India NGO" → YOUT-3842
partnerSchema.pre('save', async function (next) {
  if (this.isNew && !this.code) {
    const { namePrefix } = require('../utils/generateCode');
    const prefix = namePrefix(this.organizationName || 'PART');
    this.code = await generateCode(this.constructor, prefix);
  }
  next();
});

// ── Compound indexes ──────────────────────────────────────────────
partnerSchema.index({ status: 1, partnerType: 1 });
partnerSchema.index({ assignedTo: 1, status: 1 });
partnerSchema.index({ agreementExpiry: 1, status: 1 });  // expiry monitoring
partnerSchema.index({ createdAt: -1 });

// ── Text search ───────────────────────────────────────────────────
partnerSchema.index(
  { organizationName: 'text', contactPerson: 'text', city: 'text' },
  { name: 'partner_text_search', weights: { organizationName: 10, contactPerson: 5 } }
);

partnerSchema.set('toJSON',   { virtuals: true });
partnerSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Partner', partnerSchema);
