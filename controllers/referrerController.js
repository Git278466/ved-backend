'use strict';

const mongoose    = require('mongoose');
const Referrer    = require('../models/Referrer');
const Institution = require('../models/Institution');
const Partner     = require('../models/Partner');
const Lead        = require('../models/Lead');

// ── Tier calculation ──────────────────────────────────────────
const TIERS = [
  { name: 'Platinum', threshold: 200, multiplier: 2.0 },
  { name: 'Gold',     threshold: 150, multiplier: 1.5 },
  { name: 'Silver',   threshold: 100, multiplier: 1.0 },
  { name: 'Normal',   threshold: 50,  multiplier: 1.0 },
  { name: 'New',      threshold: 0,   multiplier: 1.0 },
];

function getTier(totalLeads) {
  const tier = TIERS.find(t => totalLeads >= t.threshold) || TIERS[TIERS.length - 1];
  const nextTier = TIERS[TIERS.indexOf(tier) - 1] || null;
  const progress = nextTier
    ? Math.min(100, Math.round(((totalLeads - tier.threshold) / (nextTier.threshold - tier.threshold)) * 100))
    : 100;
  return {
    name:           tier.name,
    multiplier:     tier.multiplier,
    threshold:      tier.threshold,
    nextTier:       nextTier ? nextTier.name : null,
    nextThreshold:  nextTier ? nextTier.threshold : null,
    leadsToNext:    nextTier ? Math.max(0, nextTier.threshold - totalLeads) : 0,
    progress,
  };
}

// GET /api/referrers  — list all three types merged with their commission stats
exports.getAll = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};

    // Fetch all three sources in parallel
    const [individuals, institutions, partners] = await Promise.all([
      Referrer.find(filter).sort({ createdAt: -1 }).lean(),
      Institution.find(filter).sort({ createdAt: -1 }).lean(),
      Partner.find(filter).sort({ createdAt: -1 }).lean(),
    ]);

    // Fetch commission stats per referrer type from leads
    const [indStats, instStats, partStats] = await Promise.all([
      Lead.aggregate([
        { $match: { referrer: { $ne: null } } },
        { $group: {
          _id: '$referrer',
          totalLeads:  { $sum: 1 },
          totalEarned: { $sum: '$commissionAmount' },
          totalPaid:   { $sum: { $cond: [{ $eq: ['$commissionStatus','paid'] }, '$commissionAmount', 0] } },
        }},
      ]),
      Lead.aggregate([
        { $match: { referrerInstitution: { $ne: null } } },
        { $group: {
          _id: '$referrerInstitution',
          totalLeads:  { $sum: 1 },
          totalEarned: { $sum: '$commissionAmount' },
          totalPaid:   { $sum: { $cond: [{ $eq: ['$commissionStatus','paid'] }, '$commissionAmount', 0] } },
        }},
      ]),
      Lead.aggregate([
        { $match: { referrerPartner: { $ne: null } } },
        { $group: {
          _id: '$referrerPartner',
          totalLeads:  { $sum: 1 },
          totalEarned: { $sum: '$commissionAmount' },
          totalPaid:   { $sum: { $cond: [{ $eq: ['$commissionStatus','paid'] }, '$commissionAmount', 0] } },
        }},
      ]),
    ]);

    const toMap = arr => Object.fromEntries(arr.map(x => [x._id.toString(), x]));
    const iMap  = toMap(indStats);
    const inMap = toMap(instStats);
    const pMap  = toMap(partStats);

    const merge = (items, type, nameKey, subKey, statsMap) => items.map(item => {
      const stats      = statsMap[item._id.toString()] || { totalLeads: 0, totalEarned: 0, totalPaid: 0 };
      const tierInfo   = getTier(stats.totalLeads);
      return {
        _id:          item._id,
        referrerType: type,
        name:         item[nameKey] || item.organizationName || item.name,
        subLabel:     subKey ? item[subKey] : null,
        mobile:       item.mobile || null,
        email:        item.email  || null,
        city:         item.city   || null,
        state:        item.state  || null,
        status:       item.status || 'active',
        totalLeads:            stats.totalLeads,
        totalCommissionEarned: stats.totalEarned,
        totalCommissionPaid:   stats.totalPaid,
        tier:         tierInfo,
        createdAt:    item.createdAt,
      };
    });

    const all = [
      ...merge(individuals,  'individual',  'name',             'mobile',        iMap),
      ...merge(institutions, 'institution', 'name',             'principalName', inMap),
      ...merge(partners,     'partner',     'organizationName', 'contactPerson', pMap),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, referrers: all, total: all.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/referrers/stats — overall commission summary
exports.getStats = async (req, res) => {
  try {
    const [indCount, instCount, partCount, leadAgg] = await Promise.all([
      Referrer.countDocuments({ status: 'active' }),
      Institution.countDocuments({ status: 'active' }),
      Partner.countDocuments({ status: 'active' }),
      Lead.aggregate([
        { $match: { $or: [{ referrer: { $ne: null } }, { referrerInstitution: { $ne: null } }, { referrerPartner: { $ne: null } }] } },
        { $group: {
          _id: null,
          totalLeads:      { $sum: 1 },
          totalAmount:     { $sum: '$totalAmount' },
          totalCommission: { $sum: '$commissionAmount' },
          totalPaid:       { $sum: { $cond: [{ $eq: ['$commissionStatus', 'paid']   }, '$commissionAmount', 0] } },
          totalPending:    { $sum: { $cond: [{ $in: ['$commissionStatus', ['pending','approved']] }, '$commissionAmount', 0] } },
        }},
      ]),
    ]);

    const agg = leadAgg[0] || { totalLeads: 0, totalAmount: 0, totalCommission: 0, totalPaid: 0, totalPending: 0 };

    res.json({ success: true, stats: {
      totalReferrers: indCount + instCount + partCount,
      totalIndividuals: indCount, totalInstitutions: instCount, totalPartners: partCount,
      ...agg, _id: undefined,
    }, tiers: TIERS });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/referrers/options — all referrer options for dropdown (all three types)
exports.getOptions = async (req, res) => {
  try {
    const [individuals, institutions, partners] = await Promise.all([
      Referrer.find({ status: 'active' }).select('name mobile').lean(),
      Institution.find({ status: 'active' }).select('name mobile city').lean(),
      Partner.find({ status: 'active' }).select('organizationName contactPerson mobile city').lean(),
    ]);

    res.json({
      success: true,
      options: {
        individuals: individuals.map(r => ({ _id: r._id, label: `${r.name} (${r.mobile||'—'})`, type: 'individual' })),
        institutions: institutions.map(i => ({ _id: i._id, label: `${i.name}${i.city ? ' — '+i.city : ''}`, type: 'institution' })),
        partners: partners.map(p => ({ _id: p._id, label: `${p.organizationName}${p.contactPerson ? ' / '+p.contactPerson : ''}`, type: 'partner' })),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/referrers
exports.create = async (req, res) => {
  try {
    const { name, mobile, email, city, state, notes } = req.body;
    if (!name || !mobile) return res.status(400).json({ success: false, message: 'Name and mobile are required.' });

    const referrer = await Referrer.create({ name, mobile, email, city, state, notes });
    res.status(201).json({ success: true, referrer });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/referrers/:id
exports.update = async (req, res) => {
  try {
    const { name, mobile, email, city, state, notes, status } = req.body;
    const referrer = await Referrer.findByIdAndUpdate(
      req.params.id,
      { name, mobile, email, city, state, notes, status },
      { new: true, runValidators: true }
    );
    if (!referrer) return res.status(404).json({ success: false, message: 'Referrer not found.' });
    res.json({ success: true, referrer });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/referrers/:id
exports.remove = async (req, res) => {
  try {
    await Referrer.findByIdAndDelete(req.params.id);
    // Unlink leads from this referrer
    await Lead.updateMany({ referrer: req.params.id }, { $set: { referrer: null } });
    res.json({ success: true, message: 'Referrer deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/referrers/:id/leads — all leads for one referrer (any type)
exports.getLeads = async (req, res) => {
  try {
    const { referrerType = 'individual' } = req.query;
    const fieldMap = {
      individual:  'referrer',
      institution: 'referrerInstitution',
      partner:     'referrerPartner',
    };
    const field = fieldMap[referrerType] || 'referrer';

    const leads = await Lead.find({ [field]: req.params.id })
      .sort({ createdAt: -1 })
      .select('name email mobile stage source referredByName totalAmount commissionPct commissionAmount commissionStatus commissionPaidAt commissionNotes createdAt')
      .lean();

    res.json({ success: true, leads });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/referrers/lead/:leadId/commission — update commission on a lead
exports.updateLeadCommission = async (req, res) => {
  try {
    const {
      referrerType, referrerId,
      totalAmount, commissionPct, commissionAmount, commissionStatus, commissionNotes,
    } = req.body;

    const updates = {};

    // Clear all referrer links first, then set the selected one
    updates.referrer            = null;
    updates.referrerInstitution = null;
    updates.referrerPartner     = null;
    updates.referredByName      = '';

    if (referrerId) {
      updates.referrerType = referrerType || 'individual';
      if (referrerType === 'institution') {
        updates.referrerInstitution = referrerId;
        const inst = await Institution.findById(referrerId).lean();
        if (inst) updates.referredByName = inst.name;
      } else if (referrerType === 'partner') {
        updates.referrerPartner = referrerId;
        const part = await Partner.findById(referrerId).lean();
        if (part) updates.referredByName = part.organizationName;
      } else {
        updates.referrer = referrerId;
        const ref = await Referrer.findById(referrerId).lean();
        if (ref) updates.referredByName = ref.name;
      }
    }

    if (totalAmount !== undefined)      updates.totalAmount      = Number(totalAmount) || 0;
    if (commissionPct !== undefined)    updates.commissionPct    = Number(commissionPct) || 0;
    if (commissionNotes !== undefined)  updates.commissionNotes  = commissionNotes;
    if (commissionStatus !== undefined) updates.commissionStatus  = commissionStatus;
    if (commissionStatus === 'paid')    updates.commissionPaidAt  = new Date();

    // Auto-calculate commissionAmount
    if (commissionAmount !== undefined) {
      updates.commissionAmount = Number(commissionAmount);
    } else {
      const ta  = updates.totalAmount  ?? 0;
      const pct = updates.commissionPct ?? 0;
      updates.commissionAmount = Math.round((ta * pct) / 100);
    }

    const lead = await Lead.findByIdAndUpdate(req.params.leadId, updates, { new: true }).lean();
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });

    // Recalculate stats on the relevant referrer record
    if (lead.referrer)            await recalcReferrer(lead.referrer);

    res.json({ success: true, lead });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Recalculate denormalised stats on Referrer
async function recalcReferrer(referrerId) {
  const oid = typeof referrerId === 'string' ? new mongoose.Types.ObjectId(referrerId) : referrerId;
  const agg = await Lead.aggregate([
    { $match: { referrer: oid } },
    { $group: {
      _id: null,
      totalLeads:            { $sum: 1 },
      totalCommissionEarned: { $sum: '$commissionAmount' },
      totalCommissionPaid:   { $sum: { $cond: [{ $eq: ['$commissionStatus', 'paid'] }, '$commissionAmount', 0] } },
    }},
  ]);
  const data = agg[0] || { totalLeads: 0, totalCommissionEarned: 0, totalCommissionPaid: 0 };
  await Referrer.findByIdAndUpdate(referrerId, {
    totalLeads:            data.totalLeads,
    totalCommissionEarned: data.totalCommissionEarned,
    totalCommissionPaid:   data.totalCommissionPaid,
  });
}
