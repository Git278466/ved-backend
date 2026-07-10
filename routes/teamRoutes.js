'use strict';

const router       = require('express').Router();
const mongoose     = require('mongoose');
const Team         = require('../models/Team');
const Lead         = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const jwt          = require('jsonwebtoken');
const Admin        = require('../models/Admin');
const { hasPermission } = require('../middleware/roleMiddleware');

/* ────────────────────────────────────────────────────────────────
   Constants
──────────────────────────────────────────────────────────────── */
const ADMIN_FIELDS   = 'firstName lastName email fullName name mobile status profileImage lastLogin role';
const CLOSED_STAGES  = ['enrolled', 'converted'];
const LOST_STAGES    = ['not_interested', 'lost'];
const OPEN_STAGES    = ['new', 'contacted', 'follow_up', 'call_back', 'not_answering', 'not_reachable', 'interested', 'applied'];
const ACTIVITY_CAP   = 200;

/* ────────────────────────────────────────────────────────────────
   Auth — populates role so hasPermission() middleware works
──────────────────────────────────────────────────────────────── */
const auth = async (req, res, next) => {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Not authorised.' });
    const decoded = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded.id).select('-password').populate('role').lean();
    if (!admin || admin.status !== 'active') return res.status(401).json({ success: false, message: 'Admin not found.' });
    req.admin = admin;
    next();
  } catch (e) { res.status(401).json({ success: false, message: 'Invalid token.' }); }
};

router.use(auth);

const canView   = hasPermission('admin_management.view');
const canCreate = hasPermission('admin_management.create');
const canUpdate = hasPermission('admin_management.update');
const canDelete = hasPermission('admin_management.delete');

/* ────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────── */
const oid = (v) => new mongoose.Types.ObjectId(String(v));

function logActivity(team, type, message, adminId) {
  team.activity.push({ type, message, by: adminId, at: new Date() });
  if (team.activity.length > ACTIVITY_CAP) team.activity = team.activity.slice(-ACTIVITY_CAP);
}

function adminName(a) {
  if (!a) return '—';
  return a.fullName || [a.firstName, a.lastName].filter(Boolean).join(' ') || a.name || a.email || '—';
}

/** Per-member lead stats for a set of member ids — single aggregation. */
async function memberLeadStats(memberIds) {
  if (!memberIds.length) return {};
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

  const rows = await Lead.aggregate([
    { $match: { assignedTo: { $in: memberIds.map(oid) } } },
    {
      $group: {
        _id: '$assignedTo',
        total:   { $sum: 1 },
        closed:  { $sum: { $cond: [{ $in: ['$stage', CLOSED_STAGES] }, 1, 0] } },
        lost:    { $sum: { $cond: [{ $in: ['$stage', LOST_STAGES] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $in: ['$stage', OPEN_STAGES] }, 1, 0] } },
        today:   { $sum: { $cond: [{ $gte: ['$createdAt', startOfDay] }, 1, 0] } },
        byStage: { $push: '$stage' },
      },
    },
  ]);

  const map = {};
  for (const r of rows) {
    const stageCounts = {};
    for (const s of r.byStage) stageCounts[s] = (stageCounts[s] || 0) + 1;
    map[String(r._id)] = {
      total: r.total, closed: r.closed, lost: r.lost, pending: r.pending, today: r.today,
      conversionRate: r.total ? Math.round((r.closed / r.total) * 100) : 0,
      stageCounts,
    };
  }
  return map;
}

/** Roll member stats up into team-level stats. */
function rollUp(team, statsMap) {
  const agg = { totalLeads: 0, pendingLeads: 0, closedLeads: 0, lostLeads: 0, todayLeads: 0, byStage: {} };
  for (const m of team.members || []) {
    const s = statsMap[String(m._id || m)];
    if (!s) continue;
    agg.totalLeads   += s.total;
    agg.pendingLeads += s.pending;
    agg.closedLeads  += s.closed;
    agg.lostLeads    += s.lost;
    agg.todayLeads   += s.today;
    for (const [st, c] of Object.entries(s.stageCounts)) agg.byStage[st] = (agg.byStage[st] || 0) + c;
  }
  agg.conversionRate = agg.totalLeads ? Math.round((agg.closedLeads / agg.totalLeads) * 100) : 0;
  agg.leadsByStage = Object.entries(agg.byStage).map(([k, v]) => ({ _id: k, count: v }));
  return agg;
}

function sanitizeTeamBody(body) {
  const out = {};
  if (body.name !== undefined)        out.name = String(body.name).trim();
  if (body.description !== undefined) out.description = String(body.description || '').trim();
  if (body.leader !== undefined)      out.leader = body.leader || null;
  if (Array.isArray(body.members))    out.members = [...new Set(body.members.map(String))];
  if (body.status !== undefined && ['active', 'inactive'].includes(body.status)) out.status = body.status;
  if (body.distributionType !== undefined &&
      ['round_robin', 'equal', 'manual', 'capacity', 'priority'].includes(body.distributionType)) {
    out.distributionType = body.distributionType;
  }
  if (body.maxLeadsPerMember !== undefined) {
    const n = parseInt(body.maxLeadsPerMember, 10);
    out.maxLeadsPerMember = Number.isFinite(n) && n > 0 ? n : 0;
  }
  if (body.rules && typeof body.rules === 'object') {
    out.rules = {
      skipInactive:     body.rules.skipInactive !== false,
      autoRedistribute: body.rules.autoRedistribute === true,
    };
  }
  if (Array.isArray(body.tags)) out.tags = body.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 20);
  return out;
}

/* ────────────────────────────────────────────────────────────────
   GET /  — list teams with stats, search, filter, sort, pagination
   Query: q, status, sort(newest|oldest|members|leads), page, limit
──────────────────────────────────────────────────────────────── */
router.get('/', canView, async (req, res) => {
  try {
    const { q, status, sort = 'newest' } = req.query;
    const page  = Math.max(parseInt(req.query.page, 10)  || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);

    const filter = {};
    if (status && ['active', 'inactive'].includes(status)) filter.status = status;
    if (q) {
      const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { description: rx }, { tags: rx }];
    }

    const sortMap = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, members: { createdAt: -1 } };
    const total = await Team.countDocuments(filter);
    let teams = await Team.find(filter)
      .populate('leader',    ADMIN_FIELDS)
      .populate('members',   ADMIN_FIELDS)
      .populate('createdBy', 'firstName lastName email fullName name')
      .sort(sortMap[sort] || sortMap.newest)
      .lean();

    // stats for every member across all teams — one aggregation
    const allMemberIds = [...new Set(teams.flatMap(t => (t.members || []).map(m => String(m._id))))];
    const statsMap = await memberLeadStats(allMemberIds);

    let data = teams.map(t => {
      const stats = rollUp(t, statsMap);
      const { activity, ...rest } = t;   // keep list payload light
      return { ...rest, ...stats, memberCount: (t.members || []).length };
    });

    if (sort === 'members') data.sort((a, b) => b.memberCount - a.memberCount);
    if (sort === 'leads')   data.sort((a, b) => b.totalLeads - a.totalLeads);

    const paged = data.slice((page - 1) * limit, page * limit);
    res.json({ success: true, data: paged, total, page, pages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* ────────────────────────────────────────────────────────────────
   GET /:id — team details with per-member stats
──────────────────────────────────────────────────────────────── */
router.get('/:id', canView, async (req, res) => {
  try {
    const team = await Team.findById(req.params.id)
      .populate('leader',  ADMIN_FIELDS)
      .populate({ path: 'members', select: ADMIN_FIELDS, populate: { path: 'role', select: 'name' } })
      .populate('createdBy', 'firstName lastName email fullName name')
      .lean();
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });

    const statsMap = await memberLeadStats((team.members || []).map(m => String(m._id)));
    const stats    = rollUp(team, statsMap);

    const members = (team.members || []).map(m => ({
      ...m,
      stats: statsMap[String(m._id)] || { total: 0, closed: 0, lost: 0, pending: 0, today: 0, conversionRate: 0, stageCounts: {} },
    }));

    const { activity, ...rest } = team;
    res.json({ success: true, data: { ...rest, ...stats, members, memberCount: members.length } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* ────────────────────────────────────────────────────────────────
   GET /:id/leads — paginated leads assigned to team members
   Query: q, stage, page, limit
──────────────────────────────────────────────────────────────── */
router.get('/:id/leads', canView, async (req, res) => {
  try {
    const team = await Team.findById(req.params.id).select('members').lean();
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });

    const page  = Math.max(parseInt(req.query.page, 10)  || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);

    const filter = { assignedTo: { $in: team.members } };
    if (req.query.stage) filter.stage = req.query.stage;
    if (req.query.q) {
      const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { mobile: rx }, { email: rx }];
    }

    const total = await Lead.countDocuments(filter);
    const leads = await Lead.find(filter)
      .select('name mobile email source stage priority assignedTo createdAt updatedAt')
      .populate('assignedTo', 'firstName lastName fullName name email')
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({ success: true, data: leads, total, page, pages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* ────────────────────────────────────────────────────────────────
   GET /:id/analytics — distribution, conversion, top performers,
   response time
──────────────────────────────────────────────────────────────── */
router.get('/:id/analytics', canView, async (req, res) => {
  try {
    const team = await Team.findById(req.params.id).populate('members', ADMIN_FIELDS).lean();
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });

    const memberIds = (team.members || []).map(m => String(m._id));
    const statsMap  = await memberLeadStats(memberIds);
    const stats     = rollUp(team, statsMap);

    const perMember = (team.members || []).map(m => {
      const s = statsMap[String(m._id)] || { total: 0, closed: 0, pending: 0, conversionRate: 0 };
      return {
        _id: m._id, name: adminName(m), status: m.status,
        total: s.total, closed: s.closed, pending: s.pending, conversionRate: s.conversionRate,
      };
    });

    const topPerformers = [...perMember].sort((a, b) => b.closed - a.closed || b.total - a.total).slice(0, 5);

    // avg first-response time (hours) per member: lead.createdAt → first activity
    let responseTime = [];
    try {
      const rows = await LeadActivity.aggregate([
        { $match: { doneBy: { $in: memberIds.map(oid) } } },
        { $sort: { createdAt: 1 } },
        { $group: { _id: '$lead', firstAt: { $first: '$createdAt' }, by: { $first: '$doneBy' } } },
        { $lookup: { from: 'leads', localField: '_id', foreignField: '_id', as: 'lead' } },
        { $unwind: '$lead' },
        { $project: { by: 1, diffH: { $divide: [{ $subtract: ['$firstAt', '$lead.createdAt'] }, 3600000] } } },
        { $match: { diffH: { $gte: 0 } } },
        { $group: { _id: '$by', avgHours: { $avg: '$diffH' }, count: { $sum: 1 } } },
      ]);
      const byId = Object.fromEntries(rows.map(r => [String(r._id), r]));
      responseTime = (team.members || [])
        .filter(m => byId[String(m._id)])
        .map(m => ({ _id: m._id, name: adminName(m), avgHours: Math.round(byId[String(m._id)].avgHours * 10) / 10, count: byId[String(m._id)].count }));
    } catch (_) { /* analytics extras are best-effort */ }

    res.json({ success: true, data: { summary: stats, perMember, topPerformers, responseTime } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* ────────────────────────────────────────────────────────────────
   GET /:id/activity — team activity timeline (newest first)
──────────────────────────────────────────────────────────────── */
router.get('/:id/activity', canView, async (req, res) => {
  try {
    const team = await Team.findById(req.params.id)
      .select('activity name')
      .populate('activity.by', 'firstName lastName fullName name email')
      .lean();
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });
    res.json({ success: true, data: [...(team.activity || [])].reverse() });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* ────────────────────────────────────────────────────────────────
   POST / — create team
──────────────────────────────────────────────────────────────── */
router.post('/', canCreate, async (req, res) => {
  try {
    const body = sanitizeTeamBody(req.body);
    if (!body.name) return res.status(400).json({ success: false, message: 'Team name is required.' });

    const dupe = await Team.findOne({ name: new RegExp(`^${body.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (dupe) return res.status(400).json({ success: false, message: 'A team with this name already exists.' });

    const team = new Team({ ...body, createdBy: req.admin._id });
    logActivity(team, 'team_created', `Team "${team.name}" created`, req.admin._id);
    await team.save();
    res.status(201).json({ success: true, data: team });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* ────────────────────────────────────────────────────────────────
   PUT /:id — update team
──────────────────────────────────────────────────────────────── */
router.put('/:id', canUpdate, async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });

    const body = sanitizeTeamBody(req.body);
    if (body.name === '') return res.status(400).json({ success: false, message: 'Team name is required.' });

    const oldLeader = String(team.leader || '');
    const oldStatus = team.status;
    Object.assign(team, body);

    if (body.leader !== undefined && String(body.leader || '') !== oldLeader) {
      logActivity(team, 'leader_changed', 'Team lead changed', req.admin._id);
    }
    if (body.status !== undefined && body.status !== oldStatus) {
      logActivity(team, 'status_changed', `Team marked ${body.status}`, req.admin._id);
    }
    logActivity(team, 'team_updated', `Team "${team.name}" updated`, req.admin._id);

    await team.save();
    const populated = await Team.findById(team._id)
      .populate('leader', ADMIN_FIELDS)
      .populate('members', ADMIN_FIELDS);
    res.json({ success: true, data: populated });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* ────────────────────────────────────────────────────────────────
   PATCH /:id/status — activate / deactivate
──────────────────────────────────────────────────────────────── */
router.patch('/:id/status', canUpdate, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive.' });
    }
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });

    team.status = status;
    logActivity(team, 'status_changed', `Team marked ${status}`, req.admin._id);
    await team.save();
    res.json({ success: true, data: team });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* ────────────────────────────────────────────────────────────────
   POST /:id/members — add members (bulk)
   DELETE /:id/members — remove members (bulk)
──────────────────────────────────────────────────────────────── */
router.post('/:id/members', canUpdate, async (req, res) => {
  try {
    const ids = [...new Set((req.body.memberIds || []).map(String))];
    if (!ids.length) return res.status(400).json({ success: false, message: 'memberIds is required.' });

    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });

    const existing = new Set(team.members.map(String));
    const added = ids.filter(id => !existing.has(id));
    if (!added.length) return res.status(400).json({ success: false, message: 'All selected admins are already members.' });

    const admins = await Admin.find({ _id: { $in: added } }).select('firstName lastName fullName name email').lean();
    team.members.push(...admins.map(a => a._id));
    logActivity(team, 'member_added', `${admins.map(adminName).join(', ')} added to team`, req.admin._id);
    await team.save();

    res.json({ success: true, message: `${admins.length} member(s) added.`, data: team });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/:id/members', canUpdate, async (req, res) => {
  try {
    const ids = new Set((req.body.memberIds || []).map(String));
    if (!ids.size) return res.status(400).json({ success: false, message: 'memberIds is required.' });

    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });

    const removed = await Admin.find({ _id: { $in: [...ids] } }).select('firstName lastName fullName name email').lean();
    team.members = team.members.filter(m => !ids.has(String(m)));
    if (team.leader && ids.has(String(team.leader))) team.leader = null;
    logActivity(team, 'member_removed', `${removed.map(adminName).join(', ')} removed from team`, req.admin._id);
    await team.save();

    res.json({ success: true, message: `${removed.length} member(s) removed.`, data: team });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* ────────────────────────────────────────────────────────────────
   POST /:id/assign-leads — distribution engine
   Body: { stage?, leadIds?, memberId?, distribution?, maxPerMember?, skipInactive? }
   Distributions: round_robin | equal | capacity | priority | manual
──────────────────────────────────────────────────────────────── */
router.post('/:id/assign-leads', canUpdate, async (req, res) => {
  try {
    const { leadIds, stage, memberId } = req.body;
    const team = await Team.findById(req.params.id).populate('members', 'status firstName lastName fullName name').lean();
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });
    if (team.status === 'inactive') return res.status(400).json({ success: false, message: 'Team is inactive. Activate it before assigning leads.' });
    if (!team.members.length) return res.status(400).json({ success: false, message: 'Team has no members.' });

    const distribution = req.body.distribution || team.distributionType || 'round_robin';
    const skipInactive = req.body.skipInactive !== undefined ? !!req.body.skipInactive : (team.rules?.skipInactive !== false);
    const maxPer = parseInt(req.body.maxPerMember, 10) > 0
      ? parseInt(req.body.maxPerMember, 10)
      : (team.maxLeadsPerMember || 0);

    // ── Eligible members ──────────────────────────────────────
    let pool = team.members;
    if (skipInactive) pool = pool.filter(m => m.status === 'active');
    if (!pool.length) return res.status(400).json({ success: false, message: 'No active members available (inactive members are skipped).' });

    // ── Leads to assign ───────────────────────────────────────
    const filter = {};
    if (leadIds && leadIds.length) {
      filter._id = { $in: leadIds };
    } else {
      filter.$or = [{ assignedTo: null }, { assignedTo: { $exists: false } }];
      if (stage) filter.stage = stage;
    }
    let leads = await Lead.find(filter).select('_id priority createdAt').lean();
    if (!leads.length) return res.status(400).json({ success: false, message: 'No unassigned leads found.' });

    // ── Manual: everything goes to one chosen member ──────────
    if (distribution === 'manual') {
      if (!memberId || !team.members.some(m => String(m._id) === String(memberId))) {
        return res.status(400).json({ success: false, message: 'Manual assignment requires a team member (memberId).' });
      }
      if (maxPer > 0) {
        const current = await Lead.countDocuments({ assignedTo: memberId, stage: { $in: OPEN_STAGES } });
        const room = Math.max(maxPer - current, 0);
        if (!room) return res.status(400).json({ success: false, message: 'Selected member is at their max lead capacity.' });
        leads = leads.slice(0, room);
      }
      await Lead.bulkWrite(leads.map(l => ({ updateOne: { filter: { _id: l._id }, update: { assignedTo: memberId } } })));
      await Team.updateOne({ _id: team._id }, {
        $push: { activity: { $each: [{ type: 'lead_assigned', message: `${leads.length} lead(s) manually assigned`, by: req.admin._id, at: new Date() }], $slice: -ACTIVITY_CAP } },
      });
      return res.json({ success: true, message: `${leads.length} leads assigned.`, assigned: leads.length });
    }

    // ── Current open-lead counts (capacity + max cap) ─────────
    const counts = {};
    const countRows = await Lead.aggregate([
      { $match: { assignedTo: { $in: pool.map(m => oid(m._id)) }, stage: { $in: OPEN_STAGES } } },
      { $group: { _id: '$assignedTo', n: { $sum: 1 } } },
    ]);
    for (const r of countRows) counts[String(r._id)] = r.n;
    for (const m of pool) counts[String(m._id)] = counts[String(m._id)] || 0;

    if (distribution === 'priority') {
      const rank = { high: 0, medium: 1, low: 2 };
      leads.sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || new Date(a.createdAt) - new Date(b.createdAt));
    }

    const ops = [];
    let skippedFull = 0;

    if (distribution === 'capacity') {
      // always hand the next lead to the member with the fewest open leads
      for (const lead of leads) {
        const sorted = pool
          .map(m => String(m._id))
          .filter(id => maxPer === 0 || counts[id] < maxPer)
          .sort((a, b) => counts[a] - counts[b]);
        if (!sorted.length) { skippedFull++; continue; }
        counts[sorted[0]]++;
        ops.push({ updateOne: { filter: { _id: lead._id }, update: { assignedTo: sorted[0] } } });
      }
    } else if (distribution === 'equal') {
      // split into equal contiguous chunks
      const ids = pool.map(m => String(m._id));
      const per = Math.ceil(leads.length / ids.length);
      leads.forEach((lead, i) => {
        const target = ids[Math.min(Math.floor(i / per), ids.length - 1)];
        if (maxPer > 0 && counts[target] >= maxPer) { skippedFull++; return; }
        counts[target]++;
        ops.push({ updateOne: { filter: { _id: lead._id }, update: { assignedTo: target } } });
      });
    } else {
      // round_robin (also the fallback for priority-sorted leads)
      const ids = pool.map(m => String(m._id));
      let i = 0;
      for (const lead of leads) {
        let placed = false;
        for (let tries = 0; tries < ids.length; tries++) {
          const target = ids[i % ids.length]; i++;
          if (maxPer > 0 && counts[target] >= maxPer) continue;
          counts[target]++;
          ops.push({ updateOne: { filter: { _id: lead._id }, update: { assignedTo: target } } });
          placed = true;
          break;
        }
        if (!placed) skippedFull++;
      }
    }

    if (!ops.length) return res.status(400).json({ success: false, message: 'All members are at max capacity — nothing assigned.' });
    await Lead.bulkWrite(ops);

    const label = { round_robin: 'round robin', equal: 'equal distribution', capacity: 'capacity based', priority: 'priority' }[distribution] || distribution;
    await Team.updateOne({ _id: team._id }, {
      $push: { activity: { $each: [{ type: 'lead_assigned', message: `${ops.length} lead(s) assigned via ${label}`, by: req.admin._id, at: new Date() }], $slice: -ACTIVITY_CAP } },
    });

    let msg = `${ops.length} leads assigned across ${pool.length} member(s) (${label}).`;
    if (skippedFull) msg += ` ${skippedFull} skipped — members at max capacity.`;
    res.json({ success: true, message: msg, assigned: ops.length, skipped: skippedFull });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* ────────────────────────────────────────────────────────────────
   DELETE /:id — delete team
──────────────────────────────────────────────────────────────── */
router.delete('/:id', canDelete, async (req, res) => {
  try {
    const team = await Team.findByIdAndDelete(req.params.id);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });
    res.json({ success: true, message: 'Team deleted.' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
