'use strict';

const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  requestNumber:     { type: String, unique: true, sparse: true, trim: true },
  partner:           { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  partnerName:       { type: String, required: true, trim: true },
  partnerCode:       { type: String, trim: true },   // Admin.code → Application Number on cert
  institutionName:   { type: String, required: true, trim: true },
  registeredAddress: { type: String, required: true, trim: true },
  registrationDate:  { type: Date,   required: true },
  remarks:           { type: String, trim: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  rejectionReason: { type: String, trim: true },
  editAllowed:     { type: Boolean, default: false },
  editAllowedAt:   { type: Date },
  editAllowedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  submittedAt:     { type: Date, default: Date.now },
  reviewedAt:      { type: Date },
  reviewedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  certificate:     { type: mongoose.Schema.Types.ObjectId, ref: 'CEPCertificate' },
}, { timestamps: true });

requestSchema.index({ partner: 1, status: 1 });
requestSchema.index({ status: 1, submittedAt: -1 });

module.exports = mongoose.model('PartnerCertificateRequest', requestSchema);
