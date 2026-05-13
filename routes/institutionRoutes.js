'use strict';

const express     = require('express');
const router      = express.Router();
const Institution = require('../models/Institution');
const { protectAdmin }       = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

router.use(protectAdmin);

router.get('/', hasPermission('institutions.view'), async (req, res) => {
  try {
    const { search, type, status, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (search) filter.$or = [{ name: new RegExp(search,'i') }, { principalName: new RegExp(search,'i') }];
    if (type)   filter.type   = type;
    if (status) filter.status = status;
    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Institution.countDocuments(filter);
    const data  = await Institution.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit));
    res.json({ success: true, total, page: Number(page), data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/:id', hasPermission('institutions.view'), async (req, res) => {
  try {
    const doc = await Institution.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', hasPermission('institutions.create'), async (req, res) => {
  try {
    const doc = await Institution.create({ ...req.body, createdBy: req.admin._id });
    res.status(201).json({ success: true, message: 'Institution created.', data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id', hasPermission('institutions.update'), async (req, res) => {
  try {
    const doc = await Institution.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', hasPermission('institutions.delete'), async (req, res) => {
  try {
    const doc = await Institution.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, message: 'Institution deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
