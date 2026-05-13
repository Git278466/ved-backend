'use strict';

const express  = require('express');
const router   = express.Router();
const Student  = require('../models/Student');
const { protectAdmin }       = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

router.use(protectAdmin);
router.use(hasPermission('reports.view'));

// GET / → alias for /overview so dashboard fetch('/reports') works
router.get('/', async (req, res) => {
  try {
    const [total, approved, pending, rejected, certIssued] = await Promise.all([
      Student.countDocuments(),
      Student.countDocuments({ status: 'approved' }),
      Student.countDocuments({ status: 'pending' }),
      Student.countDocuments({ status: 'rejected' }),
      Student.countDocuments({ certificateStatus: 'issued' }),
    ]);
    res.json({ success: true, data: { total, approved, pending, rejected, certificatesIssued: certIssued } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/overview', async (req, res) => {
  try {
    const [total, approved, pending, rejected, certIssued] = await Promise.all([
      Student.countDocuments(),
      Student.countDocuments({ status: 'approved' }),
      Student.countDocuments({ status: 'pending' }),
      Student.countDocuments({ status: 'rejected' }),
      Student.countDocuments({ certificateStatus: 'issued' }),
    ]);
    res.json({ success: true, data: { total, approved, pending, rejected, certificatesIssued: certIssued } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/registrations-trend', async (req, res) => {
  try {
    const months = Number(req.query.months) || 6;
    const since  = new Date();
    since.setMonth(since.getMonth() - months);
    const data = await Student.aggregate([
      { $match: { registrationDate: { $gte: since } } },
      { $group: { _id: { year: { $year: '$registrationDate' }, month: { $month: '$registrationDate' } }, count: { $sum: 1 } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/gender-breakdown', async (req, res) => {
  try {
    const data = await Student.aggregate([
      { $group: { _id: '$gender', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/location-breakdown', async (req, res) => {
  try {
    const [byState, byCity] = await Promise.all([
      Student.aggregate([{ $group: { _id: '$state', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 20 }]),
      Student.aggregate([{ $group: { _id: '$city',  count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 20 }]),
    ]);
    res.json({ success: true, data: { byState, byCity } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
