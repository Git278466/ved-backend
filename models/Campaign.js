'use strict';
const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  type:    { type: String, enum: ['whatsapp', 'email', 'sms'], required: true },
  status:  { type: String, enum: ['draft','queued','running','paused','completed','failed'], default: 'draft' },

  // Message content
  subject:    { type: String, trim: true },           // email subject
  message:    { type: String, required: true, trim: true },
  mediaUrl:   { type: String, trim: true },            // WhatsApp image/pdf
  mediaType:  { type: String, enum: ['image','pdf','video',''] , default: '' },

  // Recipients
  recipientType: { type: String, enum: ['all','filtered','group'], default: 'all' },
  filters:       { type: mongoose.Schema.Types.Mixed, default: {} },
  recipientCount:{ type: Number, default: 0 },

  // Progress counters (updated live)
  sentCount:      { type: Number, default: 0 },
  deliveredCount: { type: Number, default: 0 },
  failedCount:    { type: Number, default: 0 },
  pendingCount:   { type: Number, default: 0 },

  // Queue processing
  batchSize:           { type: Number, default: 30 },
  delayBetweenMs:      { type: Number, default: 2000 },  // ms between batches
  currentBatchIndex:   { type: Number, default: 0 },
  totalBatches:        { type: Number, default: 0 },

  // Scheduling
  scheduledAt:  { type: Date },
  startedAt:    { type: Date },
  completedAt:  { type: Date },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  notes:     { type: String, trim: true },
}, { timestamps: true });

campaignSchema.index({ status: 1, createdAt: -1 });
campaignSchema.index({ type: 1, status: 1 });
campaignSchema.index({ scheduledAt: 1, status: 1 });
campaignSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('Campaign', campaignSchema);
