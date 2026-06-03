'use strict';

const mongoose = require('mongoose');

const MarketingMaterialSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  url:         { type: String, required: true, trim: true },
  category: {
    type: String,
    enum: ['brochure', 'social_media', 'presentation', 'video', 'document', 'link', 'other'],
    default: 'link',
  },
  tags:      [{ type: String, trim: true }],
  isActive:  { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
}, { timestamps: true });

module.exports = mongoose.model('MarketingMaterial', MarketingMaterialSchema);
