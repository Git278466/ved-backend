'use strict';
const mongoose = require('mongoose');

const campaignMessageSchema = new mongoose.Schema({
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
  student:  { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },

  // Recipient snapshot (stored so it works even if student is deleted)
  recipientName:    { type: String },
  recipientEmail:   { type: String },
  recipientMobile:  { type: String },
  recipientWhatsapp:{ type: String },

  status: {
    type: String,
    enum: ['pending','sending','sent','delivered','failed','skipped'],
    default: 'pending',
    index: true,
  },

  sentAt:      { type: Date },
  deliveredAt: { type: Date },
  errorMessage:{ type: String },
  retryCount:  { type: Number, default: 0 },
  batchIndex:  { type: Number, default: 0 },
}, { timestamps: true });

campaignMessageSchema.index({ campaign: 1, status: 1 });
campaignMessageSchema.index({ campaign: 1, batchIndex: 1 });
campaignMessageSchema.index({ campaign: 1, retryCount: 1 });

module.exports = mongoose.model('CampaignMessage', campaignMessageSchema);
