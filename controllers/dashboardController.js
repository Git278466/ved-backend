'use strict';

const Student     = require('../models/Student');
const Admin       = require('../models/Admin');
const Role        = require('../models/Role');
const Attendance  = require('../models/Attendance');
const Certificate = require('../models/Certificate');
const Institution = require('../models/Institution');
const Partner     = require('../models/Partner');
const Donation    = require('../models/Donation');

// ── GET /api/dashboard/stats ──────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const ownerFilter = req.ownerFilter || {};

    // Cache-Control: clients may cache this for 60s (avoids redundant calls from
    // multiple components calling updateOverviewStats() in the same session)
    res.set('Cache-Control', 'private, max-age=60');

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // All 5 Student queries + monthly trend in a single aggregation pass
    const [studentFacets, adminRoleCounts, totalRoles, totalInstitutions, donationAgg] =
      await Promise.all([
        Student.aggregate([
          { $match: ownerFilter },
          { $facet: {
            total:    [{ $count: 'n' }],
            pending:  [{ $match: { status: 'pending'  } }, { $count: 'n' }],
            approved: [{ $match: { status: 'approved' } }, { $count: 'n' }],
            rejected: [{ $match: { status: 'rejected' } }, { $count: 'n' }],
            certs:    [{ $match: { certificateStatus: 'issued' } }, { $count: 'n' }],
            monthly:  [
              { $match: { registrationDate: { $gte: sixMonthsAgo } } },
              { $group: {
                _id:   { year: { $year: '$registrationDate' }, month: { $month: '$registrationDate' } },
                count: { $sum: 1 },
              }},
              { $sort: { '_id.year': 1, '_id.month': 1 } },
            ],
          }},
        ]),
        // Count active admins grouped by role name
        Admin.aggregate([
          { $match: { status: 'active' } },
          { $lookup: { from: 'roles', localField: 'role', foreignField: '_id', as: 'roleDoc' } },
          { $unwind: { path: '$roleDoc', preserveNullAndEmptyArrays: true } },
          { $group: { _id: '$roleDoc.name', count: { $sum: 1 } } },
        ]),
        Role.countDocuments({ status: 'active' }),
        Institution.countDocuments({ status: 'active' }),
        Donation.aggregate([
          { $match: { status: 'confirmed' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
      ]);

    // Build role → count map
    const roleCountMap = {};
    adminRoleCounts.forEach(r => { if (r._id) roleCountMap[r._id] = r.count; });

    const sf = studentFacets[0] || {};
    res.json({
      success: true,
      data: {
        totalStudents:        sf.total?.[0]?.n    || 0,
        pendingStudents:      sf.pending?.[0]?.n  || 0,
        approvedStudents:     sf.approved?.[0]?.n || 0,
        rejectedStudents:     sf.rejected?.[0]?.n || 0,
        certificatesIssued:   sf.certs?.[0]?.n    || 0,
        totalAdmins:          roleCountMap['Admin']             || 0,
        totalPartners:        roleCountMap['Associate Partner'] || 0,
        totalSuperAdmins:     roleCountMap['Super Admin']       || 0,
        totalRoles,
        totalInstitutions,
        totalDonationsAmount: donationAgg[0]?.total || 0,
        monthlyTrend:         sf.monthly           || [],
        adminRoleCounts:      roleCountMap,
      },
    });
  } catch (err) {
    console.error('dashboard/stats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/dashboard/admin-activity ─────────────────────────
// Super admin sees all admins; regular admin sees only their own stats
exports.getAdminActivity = async (req, res) => {
  try {
    const roleName  = req.admin?.role?.name || '';
    const isSuperAdmin = roleName.toLowerCase().includes('super') || req.admin?.role?.isSystem;

    // Per-admin stats aggregated from Student.statusUpdatedBy
    const activityAgg = await Student.aggregate([
      { $match: { statusUpdatedBy: { $exists: true, $ne: null } } },
      {
        $group: {
          _id:        '$statusUpdatedBy',
          approved:   { $sum: { $cond: [{ $eq: ['$status', 'approved']   }, 1, 0] } },
          rejected:   { $sum: { $cond: [{ $eq: ['$status', 'rejected']   }, 1, 0] } },
          waitlisted: { $sum: { $cond: [{ $eq: ['$status', 'waitlisted'] }, 1, 0] } },
          total:      { $sum: 1 },
          lastAction: { $max: '$statusUpdatedAt' },
        },
      },
      { $sort: { total: -1 } },
    ]);

    // Restrict to own record for non-super admins
    const filtered = isSuperAdmin
      ? activityAgg
      : activityAgg.filter(a => String(a._id) === String(req.admin._id));

    // Populate admin name + role from Admin collection
    const populated = await Admin.populate(filtered, {
      path: '_id',
      select: 'firstName lastName email status',
      populate: { path: 'role', select: 'name color icon' },
    });

    // System-wide pending count
    const [pendingTotal, todayApproved] = await Promise.all([
      Student.countDocuments({ status: 'pending' }),
      Student.countDocuments({
        status: 'approved',
        statusUpdatedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        ...(isSuperAdmin ? {} : { statusUpdatedBy: req.admin._id }),
      }),
    ]);

    res.json({
      success: true,
      data: { activity: populated, pendingTotal, todayApproved },
    });
  } catch (err) {
    console.error('admin-activity error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/dashboard/recent-activity ────────────────────────
exports.getRecentActivity = async (req, res) => {
  try {
    const [recentStudents, recentCerts] = await Promise.all([
      Student.find().sort({ createdAt: -1 }).limit(5).select('fullName email status city createdAt').lean(),
      Certificate.find().sort({ issuedDate: -1 }).limit(5)
        .populate('student', 'fullName')
        .lean(),
    ]);

    res.json({ success: true, data: { recentStudents, recentCerts } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
