'use strict';

const express  = require('express');
const router   = express.Router();
const Partner  = require('../models/Partner');
const { protectAdmin }                    = require('../middleware/authMiddleware');
const { hasPermission, scopeToOwn } = require('../middleware/roleMiddleware');

router.use(protectAdmin);

router.get('/', hasPermission('associate_partners.view'), scopeToOwn, async (req, res) => {
  try {
    const { search, status, page = 1, limit = 30 } = req.query;
    const filter = { ...req.ownerFilter };
    if (search) filter.$or = [{ organizationName: new RegExp(search,'i') }, { contactPerson: new RegExp(search,'i') }];
    if (status) filter.status = status;
    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Partner.countDocuments(filter);
    const data  = await Partner.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit));
    res.json({ success: true, total, page: Number(page), data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/:id', hasPermission('associate_partners.view'), async (req, res) => {
  try {
    const doc = await Partner.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', hasPermission('associate_partners.create'), async (req, res) => {
  try {
    const doc = await Partner.create({ ...req.body, createdBy: req.admin._id });
    res.status(201).json({ success: true, message: 'Partner created.', data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id', hasPermission('associate_partners.update'), async (req, res) => {
  try {
    const doc = await Partner.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', hasPermission('associate_partners.delete'), async (req, res) => {
  try {
    const doc = await Partner.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, message: 'Partner deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
