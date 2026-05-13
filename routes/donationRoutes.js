'use strict';

const express  = require('express');
const router   = express.Router();
const Donation = require('../models/Donation');
const { protectAdmin }       = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

router.use(protectAdmin);

const genReceipt = () => `VED-DON-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

router.get('/stats', hasPermission('donations.view'), async (req, res) => {
  try {
    const agg = await Donation.aggregate([{ $match: { status:'confirmed' }}, { $group:{ _id:null, total:{ $sum:'$amount' }}}]);
    const count = await Donation.countDocuments({ status: 'confirmed' });
    res.json({ success: true, data: { totalAmount: agg[0]?.total || 0, confirmedCount: count } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/', hasPermission('donations.view'), async (req, res) => {
  try {
    const { search, status, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (search) filter.$or = [{ donorName: new RegExp(search,'i') }, { transactionId: new RegExp(search,'i') }];
    if (status) filter.status = status;
    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Donation.countDocuments(filter);
    const data  = await Donation.find(filter).sort({ donationDate: -1 }).skip(skip).limit(Number(limit));
    res.json({ success: true, total, page: Number(page), data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', hasPermission('donations.create'), async (req, res) => {
  try {
    const doc = await Donation.create({ ...req.body, receiptNumber: genReceipt(), recordedBy: req.admin._id });
    res.status(201).json({ success: true, data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id', hasPermission('donations.update'), async (req, res) => {
  try {
    const doc = await Donation.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', hasPermission('donations.delete'), async (req, res) => {
  try {
    const doc = await Donation.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, message: 'Deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
