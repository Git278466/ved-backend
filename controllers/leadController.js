'use strict';

const Lead         = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const Student      = require('../models/Student');

// ── Score rules ───────────────────────────────────────────────
const ACTIVITY_SCORE = {
  call:     { positive: 15, neutral: 5,  negative: -5, no_response: -10 },
  email:    { positive: 10, neutral: 3,  negative: -3, no_response: -8  },
  whatsapp: { positive: 20, neutral: 8,  negative: -5, no_response: -10 },
  meeting:  { positive: 25, neutral: 10, negative: -5, no_response:  0  },
  note:     { positive:  5, neutral: 0,  negative:  0, no_response:  0  },
  stage_change: { positive: 10, neutral: 5, negative: 0, no_response: 0 },
  assignment:   { positive:  0, neutral: 0, negative: 0, no_response: 0 },
};

const clampScore = (s) => Math.max(0, Math.min(100, s));

// ── Build filter from query ───────────────────────────────────
const buildLeadFilter = (q) => {
  const f = {};
  if (q.search)     f.$or = [
    { name:  new RegExp(q.search, 'i') },
    { email: new RegExp(q.search, 'i') },
    { mobile:new RegExp(q.search, 'i') },
  ];
  if (q.stage)      f.stage      = q.stage.includes(',') ? { $in: q.stage.split(',') } : q.stage;
  if (q.source)     f.source     = q.source;
  if (q.priority)   f.priority   = q.priority;
  if (q.assignedTo) f.assignedTo = q.assignedTo === 'unassigned' ? null : q.assignedTo;
  if (q.city)       f.city       = new RegExp(q.city,  'i');
  if (q.state)      f.state      = new RegExp(q.state, 'i');
  if (q.minScore)   f.score      = { ...(f.score||{}), $gte: Number(q.minScore) };
  if (q.maxScore)   f.score      = { ...(f.score||{}), $lte: Number(q.maxScore) };
  if (q.overdue)          f.nextFollowUp    = { $lt: new Date() };
  if (q.commissionStatus) f.commissionStatus = q.commissionStatus;
  if (q.referrer)         f.referrer         = q.referrer;
  if (q.hasReferrer)      f.$or = [{ referrer: { $ne: null } }, { referrerInstitution: { $ne: null } }, { referrerPartner: { $ne: null } }];
  if (q.startDate || q.endDate) {
    f.createdAt = {};
    if (q.startDate) f.createdAt.$gte = new Date(q.startDate);
    if (q.endDate)   f.createdAt.$lte = new Date(q.endDate);
  }
  return f;
};

// ── GET /api/leads ─────────────────────────────────────────────
exports.getLeads = async (req, res) => {
  try {
    const { page = 1, limit = 25, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const filter = buildLeadFilter(req.query);
    const skip   = (Number(page) - 1) * Number(limit);
    const sort   = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [data, total] = await Promise.all([
      Lead.find(filter)
        .sort(sort).skip(skip).limit(Number(limit))
        .populate('assignedTo', 'firstName lastName fullName email')
        .populate('createdBy',  'firstName lastName fullName')
        .lean(),
      Lead.countDocuments(filter),
    ]);

    res.json({ success: true, total, page: Number(page), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leads/funnel ──────────────────────────────────────
exports.getFunnelStats = async (req, res) => {
  try {
    const stages = ['new', 'contacted', 'interested', 'applied', 'enrolled', 'converted', 'lost'];
    const counts = await Lead.aggregate([
      { $group: { _id: '$stage', count: { $sum: 1 }, avgScore: { $avg: '$score' } } },
    ]);

    const map = {};
    counts.forEach(c => { map[c._id] = { count: c.count, avgScore: Math.round(c.avgScore || 0) }; });

    const funnel = stages.map(s => ({
      stage:    s,
      count:    map[s]?.count    || 0,
      avgScore: map[s]?.avgScore || 0,
    }));

    const total      = funnel.reduce((s, x) => s + x.count, 0);
    const converted  = map['converted']?.count || 0;
    const convRate   = total ? ((converted / total) * 100).toFixed(1) : '0.0';

    res.json({ success: true, data: { funnel, total, converted, conversionRate: convRate } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leads/analytics ───────────────────────────────────
exports.getAnalytics = async (req, res) => {
  try {
    const since = new Date();
    since.setMonth(since.getMonth() - 6);

    const [bySource, byPriority, trend, topAdmins, overdueCount] = await Promise.all([
      Lead.aggregate([{ $group: { _id: '$source', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Lead.aggregate([{ $group: { _id: '$priority', count: { $sum: 1 } } }]),
      Lead.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      Lead.aggregate([
        { $match: { assignedTo: { $ne: null } } },
        { $group: { _id: '$assignedTo', total: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$stage', 'converted'] }, 1, 0] } } } },
        { $sort: { converted: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'admins', localField: '_id', foreignField: '_id', as: 'admin' } },
        { $unwind: { path: '$admin', preserveNullAndEmptyArrays: true } },
      ]),
      Lead.countDocuments({ nextFollowUp: { $lt: new Date() }, stage: { $nin: ['converted', 'lost'] } }),
    ]);

    const [total, hot, warm] = await Promise.all([
      Lead.countDocuments(),
      Lead.countDocuments({ score: { $gte: 61 } }),
      Lead.countDocuments({ score: { $gte: 31, $lt: 61 } }),
    ]);

    res.json({
      success: true,
      data: { bySource, byPriority, trend, topAdmins, overdueCount, total, hot, warm, cold: total - hot - warm },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leads/:id ─────────────────────────────────────────
exports.getLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('assignedTo', 'firstName lastName fullName email')
      .populate('createdBy',  'firstName lastName fullName')
      .populate('convertedToStudent', 'fullName email status')
      .lean();
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });
    res.json({ success: true, data: lead });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/leads ────────────────────────────────────────────
exports.createLead = async (req, res) => {
  try {
    const lead = await Lead.create({ ...req.body, createdBy: req.admin._id });
    res.status(201).json({ success: true, message: 'Lead created.', data: lead });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/leads/:id ─────────────────────────────────────────
exports.updateLead = async (req, res) => {
  try {
    const prev = await Lead.findById(req.params.id).lean();
    if (!prev) return res.status(404).json({ success: false, message: 'Lead not found.' });

    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('assignedTo', 'firstName lastName fullName email');

    // Log stage change as activity
    if (req.body.stage && req.body.stage !== prev.stage) {
      await LeadActivity.create({
        lead:     lead._id,
        type:     'stage_change',
        note:     `Stage changed from "${prev.stage}" to "${req.body.stage}"`,
        outcome:  'positive',
        scoreChange: 5,
        doneBy:   req.admin._id,
      });
      await Lead.findByIdAndUpdate(lead._id, { $inc: { score: 5 } });
    }

    // Log assignment change
    if (req.body.assignedTo && String(req.body.assignedTo) !== String(prev.assignedTo)) {
      await LeadActivity.create({
        lead:   lead._id,
        type:   'assignment',
        note:   `Lead assigned to new admin.`,
        doneBy: req.admin._id,
      });
    }

    res.json({ success: true, message: 'Lead updated.', data: lead });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/leads/:id ──────────────────────────────────────
exports.deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });
    await LeadActivity.deleteMany({ lead: lead._id });
    res.json({ success: true, message: 'Lead deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/leads/:id/activities ────────────────────────────
exports.addActivity = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });

    const { type, note, outcome = 'neutral', nextFollowUpDate } = req.body;
    const scoreMap = ACTIVITY_SCORE[type] || {};
    const scoreChange = scoreMap[outcome] || 0;

    const activity = await LeadActivity.create({
      lead:  lead._id,
      type,
      note,
      outcome,
      nextFollowUpDate: nextFollowUpDate || undefined,
      scoreChange,
      doneBy: req.admin._id,
    });

    const updates = {
      score:           clampScore(lead.score + scoreChange),
      lastContactedAt: new Date(),
    };
    if (nextFollowUpDate) updates.nextFollowUp = new Date(nextFollowUpDate);

    await Lead.findByIdAndUpdate(lead._id, updates);

    res.status(201).json({ success: true, data: activity, scoreChange });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leads/:id/activities ─────────────────────────────
exports.getActivities = async (req, res) => {
  try {
    const activities = await LeadActivity.find({ lead: req.params.id })
      .sort({ createdAt: -1 })
      .populate('doneBy', 'firstName lastName fullName')
      .lean();
    res.json({ success: true, data: activities });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/leads/:id/convert ───────────────────────────────
exports.convertToStudent = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });
    if (lead.stage === 'converted') {
      return res.status(400).json({ success: false, message: 'Lead already converted.' });
    }

    const studentData = {
      fullName: lead.name,
      email:    lead.email,
      mobile:   lead.mobile,
      city:     lead.city    || '',
      state:    lead.state   || '',
      standard: lead.courseInterest || '',
      status:   'pending',
      password: lead.mobile || 'Ved@1234',
    };

    const student = await Student.create(studentData);

    await Lead.findByIdAndUpdate(lead._id, {
      stage:              'converted',
      convertedAt:        new Date(),
      convertedToStudent: student._id,
      score:              100,
    });

    await LeadActivity.create({
      lead:     lead._id,
      type:     'stage_change',
      note:     `Converted to student (ID: ${student._id})`,
      outcome:  'positive',
      scoreChange: 50,
      doneBy:   req.admin._id,
    });

    res.json({ success: true, message: 'Lead converted to student.', student });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email already registered as student.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/leads/bulk-assign ───────────────────────────────
exports.bulkAssign = async (req, res) => {
  try {
    const { ids, assignedTo } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, message: 'ids array required.' });
    }
    await Lead.updateMany({ _id: { $in: ids } }, { assignedTo: assignedTo || null });
    res.json({ success: true, message: `${ids.length} lead(s) assigned.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
