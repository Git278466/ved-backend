'use strict';

const express     = require('express');
const mongoose    = require('mongoose');
const router      = express.Router();
const Institution = require('../models/Institution');
const Lead        = require('../models/Lead');
const { protectAdmin }  = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

// Helper: valid MongoDB ObjectId guard
const validId = (id) => mongoose.Types.ObjectId.isValid(id);

const TIER_THRESHOLDS = [
  { name: 'Platinum', min: 200 },
  { name: 'Gold',     min: 100 },
  { name: 'Silver',   min: 50  },
  { name: 'Normal',   min: 0   },
];
const getTier = (n) => TIER_THRESHOLDS.find(t => n >= t.min)?.name || 'Normal';

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
    const data  = await Institution.find(filter)
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit))
      .populate('linkedAdmin', 'firstName lastName email');
    res.json({ success: true, total, page: Number(page), data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/institutions/leads-overview ─────────────────────
// Super Admin: see lead stats for every institution in one call
router.get('/leads-overview', hasPermission('institutions.view'), async (req, res) => {
  try {
    const stats = await Lead.aggregate([
      { $match: { assignedInstitution: { $ne: null } } },
      { $group: {
        _id: '$assignedInstitution',
        total:         { $sum: 1 },
        new:           { $sum: { $cond: [{ $eq: ['$institutionStatus','new']           }, 1, 0] } },
        contacted:     { $sum: { $cond: [{ $eq: ['$institutionStatus','contacted']     }, 1, 0] } },
        interested:    { $sum: { $cond: [{ $eq: ['$institutionStatus','interested']    }, 1, 0] } },
        not_interested:{ $sum: { $cond: [{ $eq: ['$institutionStatus','not_interested']}, 1, 0] } },
        follow_up:     { $sum: { $cond: [{ $eq: ['$institutionStatus','follow_up']     }, 1, 0] } },
        converted:     { $sum: { $cond: [{ $eq: ['$institutionStatus','converted']     }, 1, 0] } },
        rejected:      { $sum: { $cond: [{ $eq: ['$institutionStatus','rejected']      }, 1, 0] } },
        commission:    { $sum: '$commissionAmount' },
      }},
    ]);

    // Today's follow-ups per institution
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const todayFU = await Lead.aggregate([
      { $match: { assignedInstitution: { $ne: null }, institutionFollowUpDate: { $gte: today, $lt: tomorrow } } },
      { $group: { _id: '$assignedInstitution', count: { $sum: 1 } } },
    ]);
    const todayMap = Object.fromEntries(todayFU.map(t => [t._id.toString(), t.count]));

    const result = stats.map(s => ({
      institutionId:  s._id,
      total:          s.total,
      new:            s.new,
      contacted:      s.contacted,
      interested:     s.interested,
      not_interested: s.not_interested,
      follow_up:      s.follow_up,
      converted:      s.converted,
      rejected:       s.rejected,
      commissionEarned: s.commission || 0,
      conversionRate: s.total > 0 ? +((s.converted / s.total) * 100).toFixed(1) : 0,
      tier:           getTier(s.converted),
      todayFollowUps: todayMap[s._id.toString()] || 0,
    }));

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/institutions/assign-lead ─────────────────────────
// Super Admin: assign a lead to an institution
router.patch('/assign-lead', hasPermission('leads.update'), async (req, res) => {
  try {
    const { leadId, institutionId } = req.body;
    if (!leadId) return res.status(400).json({ success: false, message: 'leadId is required.' });

    const update = {
      assignedInstitution:    institutionId || null,
      institutionAssignedBy:  institutionId ? req.admin._id : null,
      institutionAssignedAt:  institutionId ? new Date() : null,
      institutionStatus:      institutionId ? 'new' : undefined,
    };
    if (!institutionId) {
      delete update.institutionStatus;
      update.$unset = { institutionStatus: 1 };
    }

    const lead = await Lead.findByIdAndUpdate(leadId, update, { new: true });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });

    res.json({ success: true, message: institutionId ? 'Lead assigned to institution.' : 'Institution assignment removed.', data: lead });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/:id', hasPermission('institutions.view'), async (req, res) => {
  if (!validId(req.params.id))
    return res.status(404).json({ success: false, message: 'Institution not found.' });
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
  if (!validId(req.params.id))
    return res.status(404).json({ success: false, message: 'Institution not found.' });
  try {
    const doc = await Institution.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', hasPermission('institutions.delete'), async (req, res) => {
  if (!validId(req.params.id))
    return res.status(404).json({ success: false, message: 'Institution not found.' });
  try {
    const doc = await Institution.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, message: 'Institution deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
