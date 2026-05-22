'use strict';

const mongoose    = require('mongoose');
const Lead        = require('../models/Lead');
const Student     = require('../models/Student');
const Institution = require('../models/Institution');

const validId = (id) => mongoose.Types.ObjectId.isValid(id);

const TIER_THRESHOLDS = [
  { name: 'Platinum', min: 200 },
  { name: 'Gold',     min: 150 },
  { name: 'Silver',   min: 100 },
  { name: 'Normal',   min: 50  },
  { name: 'New',      min: 0   },
];

function getTier(convertedCount) {
  return TIER_THRESHOLDS.find(t => convertedCount >= t.min) || TIER_THRESHOLDS[4];
}

function getNextTier(convertedCount) {
  const thresholds = [50, 100, 150, 200];
  const next = thresholds.find(t => t > convertedCount);
  return next !== undefined ? { needed: next - convertedCount, at: next } : null;
}

// ── GET /api/institution/dashboard ───────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const instId  = req.institution._id;
    const today   = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      total, newLeads, contacted, interested,
      converted, rejected, followUp, todayFollowUps, overdue,
      commAgg,
    ] = await Promise.all([
      Lead.countDocuments({ assignedInstitution: instId }),
      Lead.countDocuments({ assignedInstitution: instId, institutionStatus: 'new' }),
      Lead.countDocuments({ assignedInstitution: instId, institutionStatus: 'contacted' }),
      Lead.countDocuments({ assignedInstitution: instId, institutionStatus: 'interested' }),
      Lead.countDocuments({ assignedInstitution: instId, institutionStatus: 'converted' }),
      Lead.countDocuments({ assignedInstitution: instId, institutionStatus: 'rejected' }),
      Lead.countDocuments({ assignedInstitution: instId, institutionStatus: 'follow_up' }),
      Lead.countDocuments({
        assignedInstitution: instId,
        institutionFollowUpDate: { $gte: today, $lt: tomorrow },
      }),
      Lead.countDocuments({
        assignedInstitution: instId,
        institutionFollowUpDate: { $lt: today },
        institutionStatus: { $nin: ['converted', 'rejected', 'not_interested'] },
      }),
      Lead.aggregate([
        { $match: { assignedInstitution: instId, institutionStatus: 'converted' } },
        { $group: { _id: null, total: { $sum: '$commissionAmount' } } },
      ]),
    ]);

    const conversionRate   = total > 0 ? ((converted / total) * 100).toFixed(1) : '0.0';
    const tier             = getTier(converted);
    const nextTier         = getNextTier(converted);
    const commissionEarned = commAgg[0]?.total || 0;

    res.json({
      success: true,
      data: {
        totalAssigned: total,
        newLeads,
        contacted,
        interested,
        converted,
        rejected,
        followUpPending:  followUp,
        todayFollowUps,
        overdueFollowUps: overdue,
        conversionRate:   parseFloat(conversionRate),
        currentTier:      tier.name,
        nextTier,
        commissionEarned,
      },
    });
  } catch (err) {
    console.error('institution/dashboard error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/institution/leads ────────────────────────────────
exports.getLeads = async (req, res) => {
  try {
    const instId = req.institution._id;
    const {
      status, city, courseInterest, source,
      fromDate, toDate,
      followUpFrom, followUpTo,
      search,
      page  = 1,
      limit = 30,
      sort  = '-institutionAssignedAt',
    } = req.query;

    const filter = { assignedInstitution: instId };

    if (status)         filter.institutionStatus = status;
    if (city)           filter.city = new RegExp(city, 'i');
    if (courseInterest) filter.courseInterest = new RegExp(courseInterest, 'i');
    if (source)         filter.source = source;

    if (fromDate || toDate) {
      filter.institutionAssignedAt = {};
      if (fromDate) filter.institutionAssignedAt.$gte = new Date(fromDate);
      if (toDate)   filter.institutionAssignedAt.$lte = new Date(toDate);
    }

    if (followUpFrom || followUpTo) {
      filter.institutionFollowUpDate = {};
      if (followUpFrom) filter.institutionFollowUpDate.$gte = new Date(followUpFrom);
      if (followUpTo)   filter.institutionFollowUpDate.$lte = new Date(followUpTo);
    }

    if (search) {
      filter.$or = [
        { name:   new RegExp(search, 'i') },
        { mobile: new RegExp(search, 'i') },
        { email:  new RegExp(search, 'i') },
      ];
    }

    const pageNum  = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip     = (pageNum - 1) * limitNum;
    const total    = await Lead.countDocuments(filter);
    const leads    = await Lead.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .populate('institutionAssignedBy', 'firstName lastName')
      .lean();

    res.json({
      success: true,
      total,
      page:  pageNum,
      pages: Math.ceil(total / limitNum),
      data:  leads,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/institution/leads/:id ────────────────────────────
exports.getLeadById = async (req, res) => {
  if (!validId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid lead ID.' });
  try {
    const instId = req.institution._id;
    const lead   = await Lead.findOne({ _id: req.params.id, assignedInstitution: instId })
      .populate('institutionAssignedBy', 'firstName lastName email')
      .populate('convertedToStudent', 'fullName email mobile')
      .populate({ path: 'institutionStatusHistory.changedBy', select: 'firstName lastName' })
      .lean();

    if (!lead)
      return res.status(404).json({ success: false, message: 'Lead not found or not assigned to your institution.' });

    res.json({ success: true, data: lead });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/institution/leads/:id/status ───────────────────
exports.updateLeadStatus = async (req, res) => {
  if (!validId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid lead ID.' });
  try {
    const instId = req.institution._id;
    const { status, remarks, followUpDate } = req.body;

    const VALID = ['new', 'contacted', 'interested', 'not_interested', 'follow_up', 'rejected'];
    if (!status || !VALID.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value.' });
    }

    const historyEntry = {
      status,
      remarks:   remarks || '',
      changedBy: req.admin._id,
      changedAt: new Date(),
    };
    if (followUpDate) historyEntry.followUpDate = new Date(followUpDate);

    const update = {
      institutionStatus:  status,
      institutionRemarks: remarks || '',
      $push: { institutionStatusHistory: historyEntry },
    };
    if (followUpDate) update.institutionFollowUpDate = new Date(followUpDate);

    const lead = await Lead.findOneAndUpdate(
      { _id: req.params.id, assignedInstitution: instId },
      update,
      { new: true }
    );

    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });

    res.json({ success: true, message: 'Status updated.', data: lead });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/institution/leads/:id/followup ──────────────────
exports.addFollowUp = async (req, res) => {
  if (!validId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid lead ID.' });
  try {
    const instId = req.institution._id;
    const { followUpDate, remarks } = req.body;

    if (!followUpDate)
      return res.status(400).json({ success: false, message: 'followUpDate is required.' });

    const historyEntry = {
      status:      'follow_up',
      remarks:     remarks || '',
      followUpDate: new Date(followUpDate),
      changedBy:   req.admin._id,
      changedAt:   new Date(),
    };

    const lead = await Lead.findOneAndUpdate(
      { _id: req.params.id, assignedInstitution: instId },
      {
        institutionStatus:       'follow_up',
        institutionFollowUpDate: new Date(followUpDate),
        institutionRemarks:      remarks || '',
        $push: { institutionStatusHistory: historyEntry },
      },
      { new: true }
    );

    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });

    res.json({ success: true, message: 'Follow-up scheduled.', data: lead });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/institution/leads/:id/convert ───────────────────
exports.convertLead = async (req, res) => {
  if (!validId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid lead ID.' });
  try {
    const instId = req.institution._id;
    const lead   = await Lead.findOne({ _id: req.params.id, assignedInstitution: instId });

    if (!lead)
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    if (lead.institutionStatus === 'converted')
      return res.status(400).json({ success: false, message: 'Lead is already converted.' });

    const { courseName, batchName, fees, joiningDate, remarks } = req.body;

    // Check if student already exists with same email/mobile to avoid duplicates
    let student;
    const existingStudent = lead.email
      ? await Student.findOne({ email: lead.email }).lean()
      : null;

    if (existingStudent) {
      student = existingStudent;
    } else {
      student = await Student.create({
        fullName:         lead.name,
        email:            lead.email,
        mobile:           lead.mobile,
        city:             lead.city,
        state:            lead.state,
        courseInterest:   courseName || lead.courseInterest,
        status:           'approved',
        registrationDate: joiningDate ? new Date(joiningDate) : new Date(),
        institution:      instId,
        submittedBy:      req.admin._id,
      });
    }

    const historyEntry = {
      status:    'converted',
      remarks:   remarks || 'Lead converted to student.',
      changedBy: req.admin._id,
      changedAt: new Date(),
    };

    await Lead.findByIdAndUpdate(lead._id, {
      institutionStatus:  'converted',
      institutionRemarks: remarks || '',
      convertedAt:        new Date(),
      convertedToStudent: student._id,
      stage:              'converted',
      $push: { institutionStatusHistory: historyEntry },
    });

    res.status(201).json({
      success: true,
      message: 'Lead converted to student successfully.',
      data:    { studentId: student._id, leadId: lead._id },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/institution/reports ──────────────────────────────
exports.getReports = async (req, res) => {
  try {
    const instId = req.institution._id;
    const { type = 'summary', fromDate, toDate } = req.query;

    const dateFilter = {};
    if (fromDate) dateFilter.$gte = new Date(fromDate);
    if (toDate)   dateFilter.$lte = new Date(toDate);

    const baseMatch = { assignedInstitution: instId };
    if (fromDate || toDate) baseMatch.institutionAssignedAt = dateFilter;

    if (type === 'monthly') {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const monthly = await Lead.aggregate([
        { $match: { assignedInstitution: instId, institutionAssignedAt: { $gte: sixMonthsAgo } } },
        { $group: {
          _id: {
            year:  { $year:  '$institutionAssignedAt' },
            month: { $month: '$institutionAssignedAt' },
          },
          assigned:  { $sum: 1 },
          converted: { $sum: { $cond: [{ $eq: ['$institutionStatus', 'converted'] }, 1, 0] } },
          rejected:  { $sum: { $cond: [{ $eq: ['$institutionStatus', 'rejected']  }, 1, 0] } },
        }},
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]);
      return res.json({ success: true, data: monthly });
    }

    if (type === 'status') {
      const byStatus = await Lead.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$institutionStatus', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);
      return res.json({ success: true, data: byStatus });
    }

    if (type === 'followup') {
      const today    = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(today); nextWeek.setDate(nextWeek.getDate() + 7);

      const selectFields = 'name mobile email city institutionStatus institutionFollowUpDate institutionRemarks';
      const [overdue, todayFU, upcoming] = await Promise.all([
        Lead.find({
          assignedInstitution: instId,
          institutionFollowUpDate: { $lt: today },
          institutionStatus: { $nin: ['converted', 'rejected', 'not_interested'] },
        }).select(selectFields).lean(),
        Lead.find({
          assignedInstitution: instId,
          institutionFollowUpDate: { $gte: today, $lt: tomorrow },
        }).select(selectFields).lean(),
        Lead.find({
          assignedInstitution: instId,
          institutionFollowUpDate: { $gte: tomorrow, $lte: nextWeek },
        }).select(selectFields).lean(),
      ]);

      return res.json({ success: true, data: { overdue, today: todayFU, upcoming } });
    }

    // Default: summary
    const [byStatus, total, converted, commission] = await Promise.all([
      Lead.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$institutionStatus', count: { $sum: 1 } } },
      ]),
      Lead.countDocuments({ assignedInstitution: instId }),
      Lead.countDocuments({ assignedInstitution: instId, institutionStatus: 'converted' }),
      Lead.aggregate([
        { $match: { assignedInstitution: instId, institutionStatus: 'converted' } },
        { $group: { _id: null, total: { $sum: '$commissionAmount' } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        total,
        converted,
        conversionRate:   total > 0 ? ((converted / total) * 100).toFixed(1) : '0.0',
        commissionEarned: commission[0]?.total || 0,
        byStatus,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/institution/commission ───────────────────────────
exports.getCommission = async (req, res) => {
  try {
    const instId    = req.institution._id;
    const converted = await Lead.countDocuments({ assignedInstitution: instId, institutionStatus: 'converted' });

    const commAgg = await Lead.aggregate([
      { $match: { assignedInstitution: instId, institutionStatus: 'converted' } },
      { $group: {
        _id:   '$commissionStatus',
        total: { $sum: '$commissionAmount' },
        count: { $sum: 1 },
      }},
    ]);

    const recentConverted = await Lead.find({ assignedInstitution: instId, institutionStatus: 'converted' })
      .sort('-convertedAt')
      .limit(10)
      .select('name commissionAmount commissionStatus convertedAt')
      .lean();

    const tier     = getTier(converted);
    const nextTier = getNextTier(converted);

    res.json({
      success: true,
      data: {
        tier:               tier.name,
        convertedLeads:     converted,
        nextTier,
        commissionByStatus: commAgg,
        recentConversions:  recentConverted,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/institution/leads/export ─────────────────────────
exports.exportLeads = async (req, res) => {
  try {
    const instId = req.institution._id;
    const { status } = req.query;

    const filter = { assignedInstitution: instId };
    if (status) filter.institutionStatus = status;

    const leads = await Lead.find(filter)
      .sort('-institutionAssignedAt')
      .select('name mobile email city courseInterest source institutionAssignedAt institutionStatus institutionFollowUpDate institutionRemarks')
      .lean();

    res.json({ success: true, total: leads.length, data: leads });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
