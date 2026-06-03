'use strict';

const mongoose = require('mongoose');

const cepCertSchema = new mongoose.Schema({
  request:           { type: mongoose.Schema.Types.ObjectId, ref: 'PartnerCertificateRequest', required: true },
  certificateNumber: { type: String, unique: true, required: true, trim: true }, // CEP-2026-XXXXXX
  verificationId:    { type: String, unique: true, required: true, trim: true }, // hex hash for URL
  partnerName:       { type: String, required: true, trim: true },
  partnerCode:       { type: String, trim: true },   // Admin.code = Application Number
  institutionName:   { type: String, required: true, trim: true },
  registeredAddress: { type: String, required: true, trim: true },
  registrationDate:  { type: Date,   required: true },
  issuedDate:        { type: Date,   default: Date.now },
  issuedBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  qrCode:            { type: String },   // base64 data URL
  verifyUrl:         { type: String },   // public verification URL
  status: {
    type: String,
    enum: ['active', 'revoked'],
    default: 'active',
    index: true
  },
  revokedAt:    { type: Date },
  revokedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  revokeReason: { type: String, trim: true },
}, { timestamps: true });

// verificationId and certificateNumber already indexed via unique:true above
cepCertSchema.index({ request: 1 });
cepCertSchema.index({ status: 1, issuedDate: -1 });

module.exports = mongoose.model('CEPCertificate', cepCertSchema);
