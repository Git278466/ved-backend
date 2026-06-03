'use strict';

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  type: {
    type: String,
    enum: ['cert_approved', 'cert_rejected', 'cert_request', 'cert_edit_allowed', 'general'],
    default: 'general'
  },
  title:   { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  data:    { type: mongoose.Schema.Types.Mixed, default: {} },
  read:    { type: Boolean, default: false },
  readAt:  { type: Date },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
// Auto-expire after 30 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', notificationSchema);
