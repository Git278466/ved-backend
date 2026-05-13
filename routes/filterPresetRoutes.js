'use strict';

const express      = require('express');
const router       = express.Router();
const FilterPreset = require('../models/FilterPreset');
const { protectAdmin }       = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

router.use(protectAdmin);

router.get('/', hasPermission('filter_presets.view'), async (req, res) => {
  try {
    const presets = await FilterPreset.find({
      $or: [{ createdBy: req.admin._id }, { visibility: 'admins' }, { visibility: 'institution' }],
    }).populate('createdBy', 'firstName lastName').sort({ favourite: -1, updatedAt: -1 });
    res.json({ success: true, data: presets });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', hasPermission('filter_presets.create'), async (req, res) => {
  try {
    const { name, description, filters, visibility, favourite } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required.' });
    const preset = await FilterPreset.create({ name, description, filters, visibility, favourite, createdBy: req.admin._id });
    res.status(201).json({ success: true, data: preset });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id', hasPermission('filter_presets.update'), async (req, res) => {
  try {
    const preset = await FilterPreset.findById(req.params.id);
    if (!preset) return res.status(404).json({ success: false, message: 'Not found.' });
    if (preset.createdBy.toString() !== req.admin._id.toString() && req.admin.role?.name !== 'Super Admin') {
      return res.status(403).json({ success: false, message: 'Can only edit own presets.' });
    }
    Object.assign(preset, req.body);
    await preset.save();
    res.json({ success: true, data: preset });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', hasPermission('filter_presets.delete'), async (req, res) => {
  try {
    const preset = await FilterPreset.findById(req.params.id);
    if (!preset) return res.status(404).json({ success: false, message: 'Not found.' });
    if (preset.createdBy.toString() !== req.admin._id.toString() && req.admin.role?.name !== 'Super Admin') {
      return res.status(403).json({ success: false, message: 'Can only delete own presets.' });
    }
    await preset.deleteOne();
    res.json({ success: true, message: 'Deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
