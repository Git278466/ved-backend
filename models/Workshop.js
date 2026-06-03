'use strict';

const mongoose = require('mongoose');

const workshopSchema = new mongoose.Schema(
  {
    // ── Identity ─────────────────────────────────────────────
    name:        { type: String, required: true, trim: true },
    code:        { type: String, trim: true },          // e.g. CSR/QS1001
    shortName:   { type: String, trim: true },          // tab label
    description: { type: String, trim: true },
    category:    { type: String, trim: true },          // cybersafe, linkedin, etc.
    icon:        { type: String, default: '🎓' },       // emoji icon
    color:       { type: String, default: '#0b63ce' },  // accent color

    // ── Institution ──────────────────────────────────────────
    institutionName: { type: String, trim: true, default: '' },

    // ── Instructor ───────────────────────────────────────────
    instructor:   { type: String, trim: true },
    instructorBio:{ type: String, trim: true },

    // ── Schedule ─────────────────────────────────────────────
    scheduledAt:  { type: Date },                       // next scheduled date/time
    duration:     { type: Number, default: 60 },        // minutes
    timezone:     { type: String, default: 'Asia/Kolkata' },

    // ── Live Status ──────────────────────────────────────────
    isLive:          { type: Boolean, default: false },
    liveStartedAt:   { type: Date },
    meetingLink:     { type: String, trim: true },
    meetingPlatform: {
      type: String,
      enum: ['google_meet', 'zoom', 'teams', 'youtube', 'other'],
      default: 'google_meet',
    },
    meetingId:       { type: String, trim: true },
    meetingPassword: { type: String, trim: true },

    // ── Recording ────────────────────────────────────────────
    recordingLink:   { type: String, trim: true },
    recordingAvailable: { type: Boolean, default: false },

    // ── Registration ─────────────────────────────────────────
    registrationOpen:  { type: Boolean, default: true },
    maxAttendees:      { type: Number, default: 500 },
    registeredCount:   { type: Number, default: 0, min: 0 },

    // ── Status ───────────────────────────────────────────────
    status: {
      type: String,
      enum: ['upcoming', 'live', 'completed', 'cancelled'],
      default: 'upcoming',
    },
    displayOrder: { type: Number, default: 0 },
    isActive:     { type: Boolean, default: true },

    // ── Meta ─────────────────────────────────────────────────
    tags:      [{ type: String, trim: true }],
    highlights:[{ type: String, trim: true }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

workshopSchema.index({ isLive: 1 });
workshopSchema.index({ status: 1 });
workshopSchema.index({ scheduledAt: 1 });
workshopSchema.index({ displayOrder: 1 });

module.exports = mongoose.model('Workshop', workshopSchema);
