'use strict';

const mongoose    = require('mongoose');
const PERMISSIONS = require('../config/permissions');

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Role name is required'],
      unique: true,
      trim: true,
      index: true,
    },
    description: { type: String, trim: true },

    permissions: {
      type: [String],
      validate: {
        validator: (arr) => arr.every(p => PERMISSIONS.includes(p)),
        message:   (props) => `Invalid permission: ${props.value}`,
      },
      default: [],
    },

    // ── Flags ─────────────────────────────────────────────────────
    isSystem: { type: Boolean, default: false },  // Super Admin / built-in roles
    status:   { type: String, enum: ['active', 'inactive'], default: 'active', index: true },

    // ── UI ────────────────────────────────────────────────────────
    icon:  { type: String, default: 'fa-shield-halved' },
    color: { type: String, default: 'blue' },

    // ── Meta ─────────────────────────────────────────────────────
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

// ── Virtual: admin count using this role ──────────────────────────
roleSchema.virtual('userCount', {
  ref:          'Admin',
  localField:   '_id',
  foreignField: 'role',
  count:        true,
});

roleSchema.set('toJSON',   { virtuals: true });
roleSchema.set('toObject', { virtuals: true });

// ── Indexes ───────────────────────────────────────────────────────
roleSchema.index({ status: 1, isSystem: 1 });
roleSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Role', roleSchema);
