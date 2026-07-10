'use strict';

const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        'team_created', 'team_updated', 'member_added', 'member_removed',
        'lead_assigned', 'lead_reassigned', 'lead_closed', 'leader_changed',
        'status_changed',
      ],
      required: true,
    },
    message: { type: String, trim: true },
    by:      { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    at:      { type: Date, default: Date.now },
  },
  { _id: false }
);

const teamSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    leader:      { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    members:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }],
    status:      { type: String, enum: ['active', 'inactive'], default: 'active' },

    // ── Lead distribution settings ─────────────────────────────
    distributionType: {
      type: String,
      enum: ['round_robin', 'equal', 'manual', 'capacity', 'priority'],
      default: 'round_robin',
    },
    maxLeadsPerMember: { type: Number, default: 0, min: 0 }, // 0 = unlimited
    rules: {
      skipInactive:     { type: Boolean, default: true },
      autoRedistribute: { type: Boolean, default: false },
    },

    tags: [{ type: String, trim: true }],

    // ── Activity timeline (newest last, capped in routes) ──────
    activity: { type: [activitySchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

teamSchema.index({ status: 1 });
teamSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Team', teamSchema);
