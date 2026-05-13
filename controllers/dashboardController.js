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

    const [
      totalStudents,
      pendingStudents,
      approvedStudents,
      rejectedStudents,
      certIssued,
      totalAdmins,
      totalRoles,
      totalInstitutions,
      totalPartners,
      donationAgg,
    ] = await Promise.all([
      Student.countDocuments(ownerFilter),
      Student.countDocuments({ ...ownerFilter, status: 'pending' }),
      Student.countDocuments({ ...ownerFilter, status: 'approved' }),
      Student.countDocuments({ ...ownerFilter, status: 'rejected' }),
      Student.countDocuments({ ...ownerFilter, certificateStatus: 'issued' }),
      Admin.countDocuments({ status: 'active' }),
      Role.countDocuments({ status: 'active' }),
      Institution.countDocuments({ status: 'active' }),
      Partner.countDocuments({ status: 'active' }),
      Donation.aggregate([
        { $match: { status: 'confirmed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    // Monthly registrations (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyTrend = await Student.aggregate([
      { $match: { ...ownerFilter, registrationDate: { $gte: sixMonthsAgo } } },
      { $group: {
        _id: { year: { $year: '$registrationDate' }, month: { $month: '$registrationDate' } },
        count: { $sum: 1 },
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    res.json({
      success: true,
      data: {
        totalStudents,
        pendingStudents,
        approvedStudents,
        rejectedStudents,
        certificatesIssued: certIssued,
        totalAdmins,
        totalRoles,
        totalInstitutions,
        totalPartners,
        totalDonationsAmount: donationAgg[0]?.total || 0,
        monthlyTrend,
      },
    });
  } catch (err) {
    console.error('dashboard/stats error:', err);
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
