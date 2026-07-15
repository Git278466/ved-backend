'use strict';

const Lead         = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const Student      = require('../models/Student');
const Admin        = require('../models/Admin');
const LeadImport   = require('../models/LeadImport');
const XLSX         = require('xlsx');
let pdfParse;
try { pdfParse = require('pdf-parse'); } catch (_) { pdfParse = null; }

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

// Canonical case/separator-insensitive key for a source value.
const _sourceKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Title-Case label from a normalized key ("social media" → "Social Media").
const _sourceLabel = (key) => key.replace(/\b\w/g, c => c.toUpperCase());
// De-duplicate a list of raw source strings into sorted Title-Case labels.
const _dedupeSources = (rawList) => {
  const seen = new Set();
  const out = [];
  for (const s of rawList) {
    const key = _sourceKey(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(_sourceLabel(key));
  }
  return out.sort((a, b) => a.localeCompare(b));
};

// ── Build filter from query ───────────────────────────────────
const buildLeadFilter = (q) => {
  const f = {};
  if (q.search)     f.$or = [
    { name:  new RegExp(q.search, 'i') },
    { email: new RegExp(q.search, 'i') },
    { mobile:new RegExp(q.search, 'i') },
  ];
  // Per-column text filters (independent of the combined `search` above —
  // used by the column-header filter row so name/mobile/email/city can be
  // filtered simultaneously with different values)
  if (q.name)       f.name       = new RegExp(q.name,   'i');
  if (q.mobile)     f.mobile     = new RegExp(q.mobile, 'i');
  if (q.email)      f.email      = new RegExp(q.email,  'i');
  if (q.stage)      f.stage      = q.stage.includes(',') ? { $in: q.stage.split(',') } : q.stage;
  // Source match is case- AND separator-insensitive so a single dropdown option
  // ("Website", "Social Media") matches every stored variant ('website',
  // 'Website', 'social_media', 'Social Media'). Non-alphanumerics become a
  // flexible separator; alphanumerics are regex-safe.
  if (q.source) {
    const pat = String(q.source).trim().replace(/[^a-z0-9]+/gi, '[\\s_-]*');
    f.source  = new RegExp('^' + pat + '$', 'i');
  }
  if (q.priority)   f.priority   = q.priority;
  if (q.assignedTo) f.assignedTo = q.assignedTo === 'unassigned' ? null : q.assignedTo;
  if (q.importedBy) f.createdBy  = q.importedBy;
  if (q.courseInterest) f.courseInterest = new RegExp(q.courseInterest, 'i');
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
  if (q.nextFollowUpFrom || q.nextFollowUpTo) {
    f.nextFollowUp = { ...(f.nextFollowUp || {}) };
    if (q.nextFollowUpFrom) f.nextFollowUp.$gte = new Date(q.nextFollowUpFrom);
    if (q.nextFollowUpTo)   f.nextFollowUp.$lte = new Date(q.nextFollowUpTo);
  }
  return f;
};

// ── GET /api/leads ─────────────────────────────────────────────
exports.getLeads = async (req, res) => {
  try {
    const { page = 1, limit = 25, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const filter = buildLeadFilter(req.query);

    // Scope: Associate Partner / Institution only see leads they created or are assigned to
    if (req.scopedAdminId) {
      const scopeCond = { $or: [
        { createdBy:  req.scopedAdminId },
        { assignedTo: req.scopedAdminId },
      ]};
      // If buildLeadFilter already set $or (e.g. for search), combine with $and
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, scopeCond];
        delete filter.$or;
      } else {
        Object.assign(filter, scopeCond);
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [data, total] = await Promise.all([
      Lead.find(filter)
        .sort(sort).skip(skip).limit(Number(limit))
        .populate('assignedTo', 'firstName lastName fullName email')
        .populate('createdBy',  'firstName lastName fullName role')
        .lean(),
      Lead.countDocuments(filter),
    ]);

    res.json({ success: true, total, page: Number(page), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leads/meta/courses — distinct course values for the filter dropdown ──
exports.getCourseOptions = async (req, res) => {
  try {
    const values = await Lead.distinct('courseInterest', { courseInterest: { $nin: [null, ''] } });
    res.json({ success: true, data: values.sort((a, b) => a.localeCompare(b)).slice(0, 300) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leads/meta/cities — distinct city values for the filter dropdown ──
exports.getCityOptions = async (req, res) => {
  try {
    const values = await Lead.distinct('city', { city: { $nin: [null, ''] } });
    res.json({ success: true, data: values.sort((a, b) => a.localeCompare(b)).slice(0, 500) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leads/meta/sources — dynamic lead sources (from actual lead data) ──
// Returns only sources that exist in leads, de-duplicated case- AND separator-
// insensitively ("Website"/"website"/"WEBSITE" → one; "social_media"/"Social Media"
// → one), each with a human label, sorted alphabetically. Nothing hardcoded.
exports.getSourceOptions = async (req, res) => {
  try {
    const raw = await Lead.distinct('source', { source: { $nin: [null, ''] } });
    const data = _dedupeSources(raw);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leads/funnel ──────────────────────────────────────
exports.getFunnelStats = async (req, res) => {
  try {
    const matchScope = req.scopedAdminId
      ? { $or: [{ createdBy: req.scopedAdminId }, { assignedTo: req.scopedAdminId }] }
      : {};
    if (req.query.assignedTo) matchScope.assignedTo = new (require('mongoose').Types.ObjectId)(req.query.assignedTo);
    if (req.query.importedBy) matchScope.createdBy  = new (require('mongoose').Types.ObjectId)(req.query.importedBy);
    const stages = ['new', 'not_answering', 'not_reachable', 'call_back', 'follow_up', 'interested', 'enrolled', 'not_interested'];
    const counts = await Lead.aggregate([
      ...(Object.keys(matchScope).length ? [{ $match: matchScope }] : []),
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
    const extraFilter = {};
    if (req.query.assignedTo) extraFilter.assignedTo = new (require('mongoose').Types.ObjectId)(req.query.assignedTo);
    if (req.query.importedBy) extraFilter.createdBy  = new (require('mongoose').Types.ObjectId)(req.query.importedBy);
    const hasExtra = Object.keys(extraFilter).length > 0;
    const extraMatch = hasExtra ? [{ $match: extraFilter }] : [];

    const overdueFilter = { nextFollowUp: { $lt: new Date() }, stage: { $nin: ['enrolled', 'not_interested', 'converted', 'lost'] }, ...extraFilter };

    const [bySource, byPriority, trend, topAdmins, overdueCount] = await Promise.all([
      Lead.aggregate([...extraMatch, { $group: { _id: '$source', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Lead.aggregate([...extraMatch, { $group: { _id: '$priority', count: { $sum: 1 } } }]),
      Lead.aggregate([
        { $match: { createdAt: { $gte: since }, ...extraFilter } },
        { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      Lead.aggregate([
        { $match: { assignedTo: { $ne: null }, ...extraFilter } },
        { $group: { _id: '$assignedTo', total: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$stage', 'converted'] }, 1, 0] } } } },
        { $sort: { converted: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'admins', localField: '_id', foreignField: '_id', as: 'admin' } },
        { $unwind: { path: '$admin', preserveNullAndEmptyArrays: true } },
      ]),
      Lead.countDocuments(overdueFilter),
    ]);

    const [total, hot, warm] = await Promise.all([
      Lead.countDocuments(extraFilter),
      Lead.countDocuments({ score: { $gte: 61 }, ...extraFilter }),
      Lead.countDocuments({ score: { $gte: 31, $lt: 61 }, ...extraFilter }),
    ]);

    // Merge source variants case/separator-insensitively so the analytics chart
    // shows the same de-duplicated sources as the filter dropdown. Same
    // {_id, count} shape → frontend unchanged (backward compatible).
    const _srcMerged = {};
    for (const r of bySource) {
      const key = _sourceKey(r._id) || '__unknown__';
      _srcMerged[key] = (_srcMerged[key] || 0) + r.count;
    }
    const bySourceDeduped = Object.entries(_srcMerged)
      .map(([key, count]) => ({ _id: key === '__unknown__' ? 'Unknown' : _sourceLabel(key), count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      data: { bySource: bySourceDeduped, byPriority, trend, topAdmins, overdueCount, total, hot, warm, cold: total - hot - warm },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leads/:id ─────────────────────────────────────────
exports.getLead = async (req, res) => {
  try {
    // Owner scoping: scoped roles (Institution / Associate Partner) may only
    // read a lead they created or are assigned to. Admin / Super Admin have no
    // scopedAdminId → unrestricted (unchanged behaviour).
    const q = { _id: req.params.id };
    if (req.scopedAdminId) {
      q.$or = [{ createdBy: req.scopedAdminId }, { assignedTo: req.scopedAdminId }];
    }
    const lead = await Lead.findOne(q)
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
    const ENUM_FIELDS = ['source', 'stage', 'priority', 'institutionStatus', 'commissionStatus', 'referrerType'];
    const body = { ...req.body, createdBy: req.admin._id };
    for (const field of ENUM_FIELDS) {
      if (body[field] === '' || body[field] === null) delete body[field];
    }
    const lead = await Lead.create(body);
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

    // Strip empty strings for enum fields so MongoDB uses the stored value instead of failing validation
    const ENUM_FIELDS = ['source', 'stage', 'priority', 'institutionStatus', 'commissionStatus', 'referrerType'];
    const updateBody = { ...req.body };
    for (const field of ENUM_FIELDS) {
      if (updateBody[field] === '' || updateBody[field] === null) delete updateBody[field];
    }

    // Prevent non-admin roles from accidentally clearing assignedTo (e.g. associate partner editing a lead
    // whose assigned admin is not in their local cache, causing the field to arrive as null)
    const _role = req.admin.role;
    const _canReassign = _role && (_role.isSystem === true || _role.name === 'Admin');
    if (!_canReassign && (updateBody.assignedTo === null || updateBody.assignedTo === '' || updateBody.assignedTo === undefined)) {
      delete updateBody.assignedTo;
    }

    const lead = await Lead.findByIdAndUpdate(req.params.id, updateBody, { new: true, runValidators: true })
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

/* ── GET /api/leads/export  →  Excel file ────────────────────────
   Supports same filters as getLeads (stage, source, priority,
   search, startDate, endDate, etc.)  — no pagination.
──────────────────────────────────────────────────────────────── */
exports.exportLeads = async (req, res) => {
  try {
    const filter = buildLeadFilter(req.query);
    if (req.scopedAdminId) {
      const scopeCond = { $or: [{ createdBy: req.scopedAdminId }, { assignedTo: req.scopedAdminId }] };
      if (filter.$or) { filter.$and = [{ $or: filter.$or }, scopeCond]; delete filter.$or; }
      else Object.assign(filter, scopeCond);
    }
    const leads  = await Lead.find(filter)
      .sort({ createdAt: -1 })
      .populate('assignedTo', 'firstName lastName email')
      .lean();

    const STAGE_LABELS = { new:'New', not_answering:'Not Answering', not_reachable:'Not Reachable', call_back:'Call Back', interested:'Interested', enrolled:'Enrolled', follow_up:'Follow Up', not_interested:'Not Interested' };
    // Build rows
    const rows = leads.map((l, i) => ({
      'S.No':           i + 1,
      'Name':           l.name            || '',
      'Email':          l.email           || '',
      'Mobile':         l.mobile          || '',
      'City':           l.city            || '',
      'State':          l.state           || '',
      'Course Interest':l.courseInterest  || '',
      'Response':       STAGE_LABELS[l.stage] || l.stage || '',
      'Source':         l.source          || '',
      'Priority':       l.priority        || '',
      'Score':          l.score           ?? '',
      'Assigned To':    l.assignedTo
                          ? ((l.assignedTo.firstName||'')+' '+(l.assignedTo.lastName||'')).trim()
                          : 'Unassigned',
      'Next Follow-up': l.nextFollowUp
                          ? new Date(l.nextFollowUp).toLocaleDateString('en-IN')
                          : '',
      'Tags':           (l.tags || []).join(', '),
      'Notes':          l.notes           || '',
      'Created At':     new Date(l.createdAt).toLocaleDateString('en-IN'),
    }));

    const ws  = XLSX.utils.json_to_sheet(rows);

    // Auto column width
    const colWidths = Object.keys(rows[0] || {}).map(key => ({
      wch: Math.max(key.length, ...rows.map(r => String(r[key] || '').length)) + 2,
    }));
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const date = new Date().toISOString().slice(0,10);
    res.setHeader('Content-Disposition', 'attachment; filename="leads-' + date + '.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── POST /api/leads/import ─────────────────────────────────────
   Accepts multipart/form-data with a file field named 'file'.
   Supports: .xlsx, .xls, .csv, .pdf
   Returns:  { success, imported, skipped, totalRows, blankRowsIgnored,
               summary{category:count}, skippedRows[], errors[], preview[],
               leadIds[], message }
───────────────────────────────────────────────────────────────── */

// Column aliases shared by header-row detection and field mapping.
// Exact (normalized) matches are claimed first; substring matches are a
// fallback for still-unmapped fields only, so a "Contact Number" column can
// never hijack the Name field when a real Name column exists.
const IMPORT_FIELD_ALIASES = {
  name:  ['name','full name','fullname','student name','lead name','candidate name','contact person','contact'],
  email: ['email','email address','email id','mail'],
  mobile:['mobile','mobile number','mobile no','phone','contact number','contact no','phone number','whatsapp','whatsapp number','mob','cell'],
  city:  ['city','town','district'],
  state: ['state','province'],
  courseInterest: ['course','course interest','interested course','course name','program','programme'],
  source:['source','lead source'],
  priority:['priority'],
  score: ['score','lead score'],
  notes: ['notes','note','remarks','comment','comments'],
  date:  ['date','lead date','enquiry date','created date','entry date'],
};

const VALID_PRIORITY = ['low','medium','high'];

const _normHeader = (k) => String(k == null ? '' : k).toLowerCase().replace(/[^a-z0-9]/g, '');

// Copy each merged range's top-left value into the covered cells so rows
// under a merged Name/City cell don't parse as blank.
function _expandMerges(ws) {
  for (const m of ws['!merges'] || []) {
    const src = ws[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })];
    if (!src || src.v === undefined || src.v === null || String(src.v).trim() === '') continue;
    for (let R = m.s.r; R <= m.e.r; R++) {
      for (let C = m.s.c; C <= m.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws[addr];
        if (!cell || cell.v === undefined || cell.v === null || String(cell.v).trim() === '') {
          ws[addr] = { t: src.t, v: src.v, w: src.w };
        }
      }
    }
  }
}

/* Extract data rows from the first non-empty sheet.
   Handles: title/blank rows above the real header (auto-detected by scoring
   rows against known column aliases), merged cells, duplicate headers,
   whitespace-only phantom rows, and real Excel row numbers for messages. */
function _extractSheetRows(wb) {
  let ws = null, sheetName = '';
  for (const sn of wb.SheetNames) {
    const s = wb.Sheets[sn];
    if (!s || !s['!ref']) continue;
    const probe = XLSX.utils.sheet_to_json(s, { header: 1, defval: '', blankrows: false });
    if (probe.some(r => r.some(c => String(c == null ? '' : c).trim() !== ''))) { ws = s; sheetName = sn; break; }
  }
  if (!ws) return { rows: [], headers: [], blankRowsIgnored: 0, sheetName: '' };

  _expandMerges(ws);

  const startRow = XLSX.utils.decode_range(ws['!ref']).s.r;   // 0-based sheet row of aoa[0]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true });

  // Header row = the row (among the first 10) with the most cells that
  // exactly match a known alias. Falls back to the first row (old behavior).
  const allAliases = new Set();
  for (const aliases of Object.values(IMPORT_FIELD_ALIASES)) {
    for (const a of aliases) allAliases.add(_normHeader(a));
  }
  let headerIdx = 0, bestScore = 0;
  for (let r = 0; r < Math.min(aoa.length, 10); r++) {
    const score = (aoa[r] || []).reduce((s, c) => s + (allAliases.has(_normHeader(c)) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; headerIdx = r; }
  }

  // De-duplicate header names the same way sheet_to_json does ("Name_1", …)
  const seen = {};
  const headers = (aoa[headerIdx] || []).map(h => {
    let k = String(h == null ? '' : h).trim();
    if (!k) return '';
    if (seen[k] != null) k = k + '_' + (++seen[k]); else seen[k] = 0;
    return k;
  });

  // Last row that actually holds data — trailing phantom rows are ignored
  const nonBlank = (arr) => (arr || []).some(v => String(v == null ? '' : v).trim() !== '');
  let lastData = headerIdx;
  for (let r = aoa.length - 1; r > headerIdx; r--) {
    if (nonBlank(aoa[r])) { lastData = r; break; }
  }

  const rows = [];
  let blankRowsIgnored = 0;
  for (let r = headerIdx + 1; r <= lastData; r++) {
    const arr = aoa[r] || [];
    if (!nonBlank(arr)) { blankRowsIgnored++; continue; }
    const data = {};
    headers.forEach((h, c) => { if (h) data[h] = arr[c] === undefined ? '' : arr[c]; });
    rows.push({ rowNum: startRow + r + 1, data });   // 1-based Excel row number
  }
  return { rows, headers, blankRowsIgnored, sheetName };
}

// Exact-match pass first, substring fallback second; each header can be
// claimed by only one field.
function _buildFieldMap(headers) {
  const fieldMap = {};
  const claimed  = new Set();
  for (const [field, aliases] of Object.entries(IMPORT_FIELD_ALIASES)) {
    for (const h of headers) {
      if (!h || claimed.has(h)) continue;
      if (aliases.some(a => _normHeader(h) === _normHeader(a))) { fieldMap[field] = h; claimed.add(h); break; }
    }
  }
  for (const [field, aliases] of Object.entries(IMPORT_FIELD_ALIASES)) {
    if (fieldMap[field]) continue;
    for (const h of headers) {
      if (!h || claimed.has(h)) continue;
      if (aliases.some(a => _normHeader(h).includes(_normHeader(a)))) { fieldMap[field] = h; claimed.add(h); break; }
    }
  }
  return fieldMap;
}

// Mobile cells may arrive as numbers or scientific-notation text
// ("9.88E+09") — render them as plain digit strings without altering
// genuinely textual values ("+91 98765 43210" passes through unchanged).
function _cleanMobile(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return v.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
  let s = String(v).trim();
  if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(s)) s = Number(s).toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\..*$/, '');
  return s;
}

// Excel serial numbers, dd/mm/yyyy (India-first), and ISO strings.
function _parseLeadDate(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d) ? undefined : d;
  }
  const s = String(v).trim();
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    let d = Number(dmy[1]), m = Number(dmy[2]);
    const y = Number(dmy[3].length === 2 ? '20' + dmy[3] : dmy[3]);
    if (m > 12 && d <= 12) { const t = d; d = m; m = t; }   // mm/dd written by mistake
    const dt = new Date(y, m - 1, d);
    return isNaN(dt) ? undefined : dt;
  }
  const dt = new Date(s);
  return isNaN(dt) ? undefined : dt;
}

exports.importLeads = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success:false, message:'No file uploaded.' });
    const assignedTo   = req.body.assignedTo || null;
    // Optional per-import override source (any value); else use each row's own.
    const globalSource = req.body.source ? String(req.body.source).trim() : null;

    const ext  = req.file.originalname.split('.').pop().toLowerCase();
    let parsedRows = [], headers = [], blankRowsIgnored = 0;

    // ── Parse file ──────────────────────────────────────────────
    if (['xlsx','xls','csv'].includes(ext)) {
      const wb = XLSX.read(req.file.buffer, { type:'buffer', dateNF:'yyyy-mm-dd' });
      const extracted = _extractSheetRows(wb);
      parsedRows       = extracted.rows;
      headers          = extracted.headers;
      blankRowsIgnored = extracted.blankRowsIgnored;
    } else if (ext === 'pdf') {
      if (!pdfParse) return res.status(400).json({ success:false, message:'PDF parsing library not available. Please use Excel/CSV.' });
      const data = await pdfParse(req.file.buffer);
      parsedRows = _parsePdfText(data.text).map((d, i) => ({ rowNum: i + 1, data: d }));
      headers    = ['name', 'mobile', 'email', 'city', 'course'];
    } else {
      return res.status(400).json({ success:false, message:'Unsupported format. Use .xlsx, .xls, .csv, or .pdf' });
    }

    if (!parsedRows.length) return res.status(400).json({ success:false, message:'File is empty or has no parseable rows.' });

    const fieldMap = _buildFieldMap(headers);

    // No Name column at all → fail loudly instead of skipping every row with
    // an identical per-row error. Still records the batch for audit.
    if (!fieldMap.name) {
      const msg = 'Could not find a "Name" column. Detected columns: '
        + (headers.filter(Boolean).join(', ') || 'none')
        + '. Make sure the header row includes a Name column (see the template).';
      await LeadImport.create({
        importedBy: req.admin._id, fileName: req.file.originalname,
        totalRows: parsedRows.length, imported: 0, skipped: parsedRows.length,
        importErrors: [msg], status: 'failed', leads: [],
      });
      console.warn('[LeadImport] ' + req.file.originalname + ' FAILED: ' + msg);
      return res.status(400).json({ success:false, message: msg, totalRows: parsedRows.length });
    }

    let imported = 0, skipped = 0;
    const errors = [], preview = [], createdLeadIds = [], skippedRows = [];
    const summary = {};   // { category: count }
    const DEBUG = process.env.LEAD_IMPORT_DEBUG === '1';

    const recordSkip = (rowNum, info, category, reason) => {
      skipped++;
      summary[category] = (summary[category] || 0) + 1;
      skippedRows.push({ row: rowNum, name: info.name || '', mobile: info.mobile || '', email: info.email || '', category, reason });
      errors.push('Row ' + rowNum + ': ' + reason);
      console.warn('[LeadImport] Row ' + rowNum + ' SKIPPED [' + category + ']: ' + reason);
    };

    for (const { rowNum, data: row } of parsedRows) {
      const get = (field) => {
        const h = fieldMap[field];
        if (!h) return '';
        const v = row[h];
        return v === undefined || v === null ? '' : String(v).trim();
      };

      const name   = get('name');
      const mobile = _cleanMobile(fieldMap.mobile ? row[fieldMap.mobile] : '');
      const email  = get('email');

      if (DEBUG) console.log('[LeadImport] Row ' + rowNum + ' parsed: ' + JSON.stringify({ name, mobile, email }));

      if (!name) {
        const hint = (mobile || email)
          ? ' (row has mobile: ' + (mobile || '—') + ', email: ' + (email || '—') + ')'
          : '';
        recordSkip(rowNum, { name, mobile, email }, 'Missing Name', 'Name is required' + hint);
        continue;
      }

      // Preserve the exact source from the Excel row (trimmed); fall back to
      // 'csv_import' only when the row has no source at all. New/unique sources
      // are thus added automatically without any hardcoded list.
      const source   = globalSource || get('source') || 'csv_import';
      const priority = VALID_PRIORITY.includes(get('priority').toLowerCase()) ? get('priority').toLowerCase() : 'medium';
      // Clamp to the schema's 0-100 range so an out-of-range score cell can't
      // fail validation and skip an otherwise valid lead.
      const score    = Math.max(0, Math.min(100, Number(get('score')) || 10));
      const leadDate = _parseLeadDate(fieldMap.date ? row[fieldMap.date] : undefined);

      try {
        const lead = await Lead.create({
          name,
          email:          email  || undefined,
          mobile:         mobile || undefined,
          city:           get('city')   || undefined,
          state:          get('state')  || undefined,
          courseInterest: get('courseInterest') || undefined,
          notes:          get('notes')  || undefined,
          source, stage: 'new', priority, score,
          createdBy:  req.admin?._id,
          assignedTo: assignedTo || undefined,
          // Preserve the file's business date separately; DO NOT backdate
          // createdAt, so freshly imported leads always appear at the top of
          // the list (sorted by createdAt desc).
          ...(leadDate && { leadDate }),
        });
        imported++;
        createdLeadIds.push(lead._id);
        if (DEBUG) console.log('[LeadImport] Row ' + rowNum + ' imported → ' + lead._id);
        if (preview.length < 5) preview.push({ name, email, mobile, stage: 'new', source });
      } catch (err) {
        const category = err.name === 'ValidationError' ? 'Validation Failed'
                       : err.code === 11000            ? 'Duplicate (Database)'
                       : 'Database Error';
        recordSkip(rowNum, { name, mobile, email }, category, '"' + name + '": ' + err.message);
      }
    }

    console.log('[LeadImport] ' + req.file.originalname
      + ' → totalRows=' + parsedRows.length + ' imported=' + imported + ' skipped=' + skipped
      + (blankRowsIgnored ? ' blankRowsIgnored=' + blankRowsIgnored : '')
      + (Object.keys(summary).length ? ' reasons=' + JSON.stringify(summary) : ''));

    // ── Save import batch record ─────────────────────────────────
    const batchStatus = imported === 0 ? 'failed' : skipped > 0 ? 'partial' : 'completed';
    await LeadImport.create({
      importedBy: req.admin._id,
      fileName:   req.file.originalname,
      totalRows:  parsedRows.length,
      imported,
      skipped,
      importErrors: errors.slice(0, 50),
      status:       batchStatus,
      leads:      createdLeadIds,
    });

    res.json({ success:true, imported, skipped,
      totalRows: parsedRows.length,
      blankRowsIgnored,
      summary,
      skippedRows: skippedRows.slice(0, 500),
      errors: errors.slice(0, 100),
      preview,
      leadIds: createdLeadIds,
      message: 'Imported ' + imported + ' lead(s)' + (skipped ? ', skipped ' + skipped : '') + '.' });

  } catch (err) {
    console.error('[LeadImport] FAILED: ' + err.message);
    res.status(500).json({ success:false, message: err.message });
  }
};

/* ── GET /api/leads/import-history ──────────────────────────────
   Admin/SuperAdmin: all batches.
   Associate Partner: only their own batches.
─────────────────────────────────────────────────────────────── */
exports.getImportHistory = async (req, res) => {
  try {
    const isScoped = req.admin?.role?.name?.toLowerCase() === 'associate partner';
    const filter   = isScoped ? { importedBy: req.admin._id } : {};

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    if (req.query.apId && !isScoped) filter.importedBy = req.query.apId;
    if (req.query.search) filter.fileName = new RegExp(req.query.search, 'i');

    const [batches, total] = await Promise.all([
      LeadImport.find(filter)
        .populate('importedBy', 'firstName lastName email code role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LeadImport.countDocuments(filter),
    ]);

    res.json({ success: true, data: batches, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── POST /api/leads/export-and-delete ───────────────────────────
   Admin / Super Admin only.
   Exports matching leads to XLSX, then permanently deletes them.
   Body: { stage, startDate, endDate }
──────────────────────────────────────────────────────────────── */
exports.exportAndDeleteLeads = async (req, res) => {
  try {
    const { stage, startDate, endDate, importedBy } = req.body;
    const filter = {};

    if (stage && stage !== 'all') {
      filter.stage = Array.isArray(stage) ? { $in: stage } : stage;
    }
    if (importedBy) {
      filter.createdBy = importedBy;
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate)   filter.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    const leads = await Lead.find(filter)
      .sort({ createdAt: -1 })
      .populate('assignedTo', 'firstName lastName email')
      .lean();

    if (!leads.length) {
      return res.status(400).json({ success: false, message: 'No leads found matching the criteria.' });
    }

    const STAGE_LABELS2 = { new:'New', not_answering:'Not Answering', not_reachable:'Not Reachable', call_back:'Call Back', interested:'Interested', enrolled:'Enrolled', follow_up:'Follow Up', not_interested:'Not Interested' };
    const rows = leads.map((l, i) => ({
      'S.No':           i + 1,
      'Name':           l.name            || '',
      'Email':          l.email           || '',
      'Mobile':         l.mobile          || '',
      'City':           l.city            || '',
      'State':          l.state           || '',
      'Course Interest':l.courseInterest  || '',
      'Response':       STAGE_LABELS2[l.stage] || l.stage || '',
      'Source':         l.source          || '',
      'Priority':       l.priority        || '',
      'Score':          l.score           ?? '',
      'Assigned To':    l.assignedTo
                          ? ((l.assignedTo.firstName||'')+' '+(l.assignedTo.lastName||'')).trim()
                          : 'Unassigned',
      'Next Follow-up': l.nextFollowUp
                          ? new Date(l.nextFollowUp).toLocaleDateString('en-IN')
                          : '',
      'Tags':           (l.tags || []).join(', '),
      'Notes':          l.notes           || '',
      'Created At':     new Date(l.createdAt).toLocaleDateString('en-IN'),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0] || {}).map(key => ({
      wch: Math.max(key.length, ...rows.map(r => String(r[key] || '').length)) + 2,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const leadIds = leads.map(l => l._id);
    await Promise.all([
      Lead.deleteMany({ _id: { $in: leadIds } }),
      LeadActivity.deleteMany({ lead: { $in: leadIds } }),
    ]);

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', 'attachment; filename="leads-archived-' + date + '.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('X-Deleted-Count', String(leads.length));
    res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Parse plain-text from PDF into row objects ────────────────
function _parsePdfText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const rows  = [];
  for (const line of lines) {
    const parts = line.split(/[,|\t]/).map(p => p.trim());
    if (parts.length >= 2) {
      // Skip a header line ("Name, Mobile, …") so it doesn't become a lead
      if (_normHeader(parts[0]) === 'name') continue;
      rows.push({ name: parts[0], mobile: parts[1], email: parts[2]||'', city: parts[3]||'', course: parts[4]||'' });
    }
  }
  return rows;
}

/* ── GET /api/leads/partner-progress ─────────────────────────────
   Returns lead stage breakdown for every Associate Partner admin.
   Used by the admin overview to track each partner's performance.
─────────────────────────────────────────────────────────────────── */
exports.getPartnerProgress = async (req, res) => {
  try {
    const Role = require('../models/Role');

    // 1. Find the Associate Partner role
    const apRole = await Role.findOne({ name: 'Associate Partner' }).lean();
    if (!apRole) return res.json({ success: true, data: [] });

    // 2. Get all Associate Partner admins
    const partners = await Admin.find({ role: apRole._id })
      .select('firstName lastName email code role')
      .lean();

    if (!partners.length) return res.json({ success: true, data: [] });

    const stages = ['new', 'not_answering', 'not_reachable', 'call_back', 'follow_up', 'interested', 'enrolled', 'not_interested'];

    // 3. For each partner aggregate their lead counts by stage (assigned OR created by them)
    const data = await Promise.all(partners.map(async (p) => {
      const agg = await Lead.aggregate([
        { $match: { $or: [{ assignedTo: p._id }, { createdBy: p._id }] } },
        { $group: { _id: { leadId: '$_id', stage: '$stage' } } },
        { $group: { _id: '$_id.stage', count: { $sum: 1 } } },
      ]);

      const byStage = {};
      agg.forEach(x => { byStage[x._id] = x.count; });

      const total     = agg.reduce((s, x) => s + x.count, 0);
      const converted = byStage['enrolled'] || byStage['converted'] || 0;
      const convRate  = total ? Math.round((converted / total) * 100) : 0;

      return {
        _id:       p._id,
        name:      ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || p.email,
        email:     p.email,
        code:      p.code || '',
        total,
        converted,
        convRate,
        byStage:   stages.map(s => ({ stage: s, count: byStage[s] || 0 })),
      };
    }));

    // Sort by total leads descending
    data.sort((a, b) => b.total - a.total);

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
