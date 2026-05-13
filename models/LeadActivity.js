'use strict';

const mongoose = require('mongoose');

const leadActivitySchema = new mongoose.Schema({
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },

  type: {
    type: String,
    enum: ['call', 'email', 'whatsapp', 'meeting', 'note', 'stage_change', 'assignment'],
    required: true,
  },

  note:    { type: String, trim: true },

  outcome: {
    type: String,
    enum: ['positive', 'neutral', 'negative', 'no_response', ''],
    default: 'neutral',
  },

  nextFollowUpDate: { type: Date },
  scoreChange:      { type: Number, default: 0 },

  doneBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
}, { timestamps: true });

leadActivitySchema.index({ lead: 1, createdAt: -1 });

module.exports = mongoose.model('LeadActivity', leadActivitySchema);
