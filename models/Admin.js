'use strict';

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const adminSchema = new mongoose.Schema(
  {
    // ── Identity ─────────────────────────────────────────────────
    firstName: { type: String, required: true, trim: true },
    lastName:  { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email address'],
      index: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,          // never returned in queries
    },

    // ── Role & access ────────────────────────────────────────────
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      required: true,
    },

    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },

    // ── Profile ──────────────────────────────────────────────────
    mobile:       { type: String, trim: true },
    profileImage: { type: String, trim: true },

    // ── Security tracking ────────────────────────────────────────
    lastLogin:        { type: Date },
    passwordChangedAt:{ type: Date },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil:      { type: Date },

    // ── Meta ─────────────────────────────────────────────────────
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    notes:     { type: String, trim: true },
  },
  { timestamps: true }
);

// ── Hash password before save ─────────────────────────────────────
adminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordChangedAt = new Date();
  next();
});

// ── Instance: compare password ────────────────────────────────────
adminSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// ── Instance: check if account is locked ─────────────────────────
adminSchema.methods.isLocked = function () {
  return this.lockedUntil && this.lockedUntil > new Date();
};

// ── Virtuals ──────────────────────────────────────────────────────
adminSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

adminSchema.virtual('name').get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

adminSchema.set('toJSON',   { virtuals: true });
adminSchema.set('toObject', { virtuals: true });

// ── Compound indexes ──────────────────────────────────────────────
adminSchema.index({ status: 1, role: 1 });
adminSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Admin', adminSchema);
