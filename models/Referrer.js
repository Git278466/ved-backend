'use strict';

const mongoose = require('mongoose');

const referrerSchema = new mongoose.Schema(
  {
    name:   { type: String, required: true, trim: true },
    mobile: { type: String, required: true, trim: true },
    email:  { type: String, trim: true, lowercase: true },
    city:   { type: String, trim: true },
    state:  { type: String, trim: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    notes:  { type: String, trim: true },

    // Denormalised counters — updated whenever a lead's commission changes
    totalLeads:            { type: Number, default: 0, min: 0 },
    totalCommissionEarned: { type: Number, default: 0, min: 0 },
    totalCommissionPaid:   { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

referrerSchema.index({ name: 1 });
referrerSchema.index({ mobile: 1 });
referrerSchema.index({ status: 1 });

module.exports = mongoose.model('Referrer', referrerSchema);
