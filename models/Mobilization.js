'use strict';

const mongoose = require('mongoose');

const mobilizationSchema = new mongoose.Schema(
  {
    // ── Student Identity ────────────────────────────────────────
    fullName:             { type: String, required: true, trim: true },
    guardianName:         { type: String, trim: true },
    guardianContact:      { type: String, trim: true },
    guardianOccupation:   { type: String, trim: true },
    organization:         { type: String, trim: true },
    mobile:               { type: String, trim: true },
    dob:                  { type: Date },
    gender:               { type: String, enum: ['male', 'female', 'other'], default: 'male' },
    address:              { type: String, trim: true },

    // ── Documents ───────────────────────────────────────────────
    aadhaar:           { type: String, trim: true },

    // ── Education & Interests ───────────────────────────────────
    education:         { type: String, trim: true },
    certificateProgram:{ type: String, enum: ['NESCOM', 'IBM', 'Workshop', ''], default: '' },
    skillCourse:       { type: String, trim: true },
    futureCourse:      { type: String, trim: true },
    degreeMode:        { type: String, enum: ['regular', 'distance', 'online', ''], default: 'regular' },
    educationDest:     { type: String, enum: ['india', 'abroad', ''], default: 'india' },

    // ── Referral ─────────────────────────────────────────────────
    referralCode:      { type: String, trim: true, uppercase: true },
    referredByType:    { type: String, enum: ['admin', 'institution', 'partner', ''], default: '' },
    referredById:      { type: mongoose.Schema.Types.ObjectId },
    referredByName:    { type: String, trim: true },

    // ── Declaration ─────────────────────────────────────────────
    declarationAccepted: { type: Boolean, default: false },
    signatureName:       { type: String, trim: true },
    registrationDate:    { type: Date, default: Date.now },

    // ── Admin workflow ──────────────────────────────────────────
    status: {
      type: String,
      enum: ['new', 'contacted', 'enrolled', 'closed'],
      default: 'new',
    },
    adminNotes: { type: String, trim: true },
  },
  { timestamps: true }
);

mobilizationSchema.index({ status: 1, createdAt: -1 });
mobilizationSchema.index({ gender: 1 });

module.exports = mongoose.model('Mobilization', mobilizationSchema);
