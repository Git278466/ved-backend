'use strict';

const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  questionId: { type: String, required: true },
  question:   { type: String, required: true },
  answer:     { type: String, required: true },
}, { _id: false });

const counsellingResponseSchema = new mongoose.Schema(
  {
    // ── User identity ─────────────────────────────────────────
    userType:  { type: String, enum: ['student', 'professional'], required: true },
    fullName:  { type: String, trim: true, default: '' },
    email:     { type: String, lowercase: true, trim: true, default: '' },
    mobile:    { type: String, trim: true },

    // ── Counselling answers ───────────────────────────────────
    counsellingAnswers: [answerSchema],

    // ── Certificate request ───────────────────────────────────
    programName:     { type: String, trim: true, default: '' },
    completionDate:  { type: Date },
    preferredMode:   { type: String, enum: ['online', 'offline', 'hybrid'], default: 'online' },
    message:         { type: String, trim: true },

    // ── Admin workflow ────────────────────────────────────────
    certificateStatus: {
      type: String,
      enum: ['pending', 'under_review', 'approved', 'issued', 'rejected'],
      default: 'pending',
    },
    certificateNumber: { type: String, trim: true },
    adminNotes:        { type: String, trim: true },
    reviewedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    reviewedAt:        { type: Date },
  },
  { timestamps: true }
);

counsellingResponseSchema.index({ certificateStatus: 1, createdAt: -1 });
counsellingResponseSchema.index({ userType: 1 });
counsellingResponseSchema.index({ email: 1 });

module.exports = mongoose.model('CounsellingResponse', counsellingResponseSchema);
