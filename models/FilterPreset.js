'use strict';

const mongoose = require('mongoose');

const filterPresetSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 300 },
    filters:     { type: mongoose.Schema.Types.Mixed, default: {} },
    visibility:  { type: String, enum: ['private', 'admins', 'institution'], default: 'private' },
    favourite:   { type: Boolean, default: false },
    usedAt:      Date,
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  },
  { timestamps: true }
);

filterPresetSchema.index({ createdBy: 1 });
filterPresetSchema.index({ visibility: 1 });

module.exports = mongoose.model('FilterPreset', filterPresetSchema);
