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
  if (q.importedBy) f.createdBy  = q.importedBy;
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

// ── GET /api/leads/funnel ──────────────────────────────────────
exports.getFunnelStats = async (req, res) => {
  try {
    const matchScope = req.scopedAdminId
      ? { $or: [{ createdBy: req.scopedAdminId }, { assignedTo: req.scopedAdminId }] }
      : {};
    const stages = ['new', 'contacted', 'interested', 'applied', 'enrolled', 'converted', 'lost'];
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

    // Build rows
    const rows = leads.map((l, i) => ({
      'S.No':           i + 1,
      'Name':           l.name            || '',
      'Email':          l.email           || '',
      'Mobile':         l.mobile          || '',
      'City':           l.city            || '',
      'State':          l.state           || '',
      'Course Interest':l.courseInterest  || '',
      'Stage':          l.stage           || '',
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
   Returns:  { success, imported, skipped, errors[], data[] }
───────────────────────────────────────────────────────────────── */
exports.importLeads = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success:false, message:'No file uploaded.' });
    const assignedTo = req.body.assignedTo || null;  // optional: assign all leads to this admin

    const ext  = req.file.originalname.split('.').pop().toLowerCase();
    let rows   = [];

    // ── Parse file ──────────────────────────────────────────────
    if (['xlsx','xls','csv'].includes(ext)) {
      const wb = XLSX.read(req.file.buffer, { type:'buffer', dateNF:'yyyy-mm-dd' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
    } else if (ext === 'pdf') {
      if (!pdfParse) return res.status(400).json({ success:false, message:'PDF parsing library not available. Please use Excel/CSV.' });
      const data = await pdfParse(req.file.buffer);
      rows = _parsePdfText(data.text);
    } else {
      return res.status(400).json({ success:false, message:'Unsupported format. Use .xlsx, .xls, .csv, or .pdf' });
    }

    if (!rows.length) return res.status(400).json({ success:false, message:'File is empty or has no parseable rows.' });

    // ── Normalise column names (case-insensitive) ────────────────
    const MAP = {
      name:['name','full name','fullname','student name','lead name','contact'],
      email:['email','email address','mail'],
      mobile:['mobile','phone','contact number','phone number','mob','cell'],
      city:['city','town'],
      state:['state','province'],
      courseInterest:['course','course interest','interested course','program','programme'],
      source:['source','lead source'],
      stage:['stage','lead stage','status'],
      priority:['priority'],
      score:['score'],
      notes:['notes','note','remarks','comment'],
      date:['date','lead date','enquiry date','created date','entry date'],
    };

    const VALID_SOURCES  = ['website','referral','event','social_media','walk_in','manual','csv_import','other'];
    const VALID_STAGES   = ['new','contacted','interested','applied','enrolled','converted','lost'];
    const VALID_PRIORITY = ['low','medium','high'];

    const normalize = (key) => String(key||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const headers = Object.keys(rows[0] || {});

    // Build field → header mapping
    const fieldMap = {};
    for (const [field, aliases] of Object.entries(MAP)) {
      for (const h of headers) {
        if (aliases.some(a => normalize(h).includes(normalize(a)))) {
          if (!fieldMap[field]) fieldMap[field] = h;
        }
      }
    }

    let imported=0, skipped=0;
    const errors=[], preview=[], createdLeadIds=[];

    for (let i=0; i<rows.length; i++) {
      const row = rows[i];
      const get = (field) => String(row[fieldMap[field]] || '').trim();

      const name = get('name');
      if (!name) { skipped++; errors.push('Row ' + (i+2) + ': Name is required — skipped.'); continue; }

      const source   = VALID_SOURCES.includes(get('source').toLowerCase())  ? get('source').toLowerCase()  : 'csv_import';
      const stage    = VALID_STAGES.includes(get('stage').toLowerCase())     ? get('stage').toLowerCase()   : 'new';
      const priority = VALID_PRIORITY.includes(get('priority').toLowerCase())? get('priority').toLowerCase(): 'medium';
      const score    = Number(get('score')) || 10;
      const rawDate  = get('date');
      const leadDate = rawDate ? new Date(rawDate) : undefined;

      try {
        const lead = await Lead.create({
          name,
          email:          get('email')  || undefined,
          mobile:         get('mobile') || undefined,
          city:           get('city')   || undefined,
          state:          get('state')  || undefined,
          courseInterest: get('courseInterest') || undefined,
          notes:          get('notes')  || undefined,
          source, stage, priority, score,
          createdBy:  req.admin?._id,
          assignedTo: assignedTo || undefined,
          ...(leadDate && !isNaN(leadDate) && { createdAt: leadDate }),
        });
        imported++;
        createdLeadIds.push(lead._id);
        if (preview.length < 5) preview.push({ name, email: get('email'), mobile: get('mobile'), stage, source });
      } catch (err) {
        skipped++;
        errors.push('Row ' + (i+2) + ' ("' + name + '"): ' + err.message);
      }
    }

    // ── Save import batch record ─────────────────────────────────
    const batchStatus = imported === 0 ? 'failed' : skipped > 0 ? 'partial' : 'completed';
    await LeadImport.create({
      importedBy: req.admin._id,
      fileName:   req.file.originalname,
      totalRows:  rows.length,
      imported,
      skipped,
      importErrors: errors.slice(0, 20),
      status:       batchStatus,
      leads:      createdLeadIds,
    });

    res.json({ success:true, imported, skipped, errors: errors.slice(0,20), preview,
      message: 'Imported ' + imported + ' lead(s)' + (skipped ? ', skipped ' + skipped : '') + '.' });

  } catch (err) {
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
    const { stage, startDate, endDate } = req.body;
    const filter = {};

    if (stage && stage !== 'all') {
      filter.stage = Array.isArray(stage) ? { $in: stage } : stage;
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

    const rows = leads.map((l, i) => ({
      'S.No':           i + 1,
      'Name':           l.name            || '',
      'Email':          l.email           || '',
      'Mobile':         l.mobile          || '',
      'City':           l.city            || '',
      'State':          l.state           || '',
      'Course Interest':l.courseInterest  || '',
      'Stage':          l.stage           || '',
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

    const stages = ['new', 'contacted', 'interested', 'applied', 'enrolled', 'converted', 'lost'];

    // 3. For each partner aggregate their lead counts by stage
    const data = await Promise.all(partners.map(async (p) => {
      const agg = await Lead.aggregate([
        { $match: { assignedTo: p._id } },
        { $group: { _id: '$stage', count: { $sum: 1 } } },
      ]);

      const byStage = {};
      agg.forEach(x => { byStage[x._id] = x.count; });

      const total     = agg.reduce((s, x) => s + x.count, 0);
      const converted = byStage['converted'] || 0;
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
