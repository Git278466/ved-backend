'use strict';

const mongoose = require('mongoose');

const LeadImportSchema = new mongoose.Schema({
  importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  fileName:   { type: String, default: 'unknown' },
  totalRows:  { type: Number, default: 0 },
  imported:   { type: Number, default: 0 },
  skipped:    { type: Number, default: 0 },
  importErrors: [String],
  status:     { type: String, enum: ['completed', 'partial', 'failed'], default: 'completed' },
  leads:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Lead' }],
}, { timestamps: true });

module.exports = mongoose.model('LeadImport', LeadImportSchema);
