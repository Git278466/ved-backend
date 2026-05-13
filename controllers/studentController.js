'use strict';

const Student     = require('../models/Student');
const Attendance  = require('../models/Attendance');
const Certificate = require('../models/Certificate');

// ── Build MongoDB filter from query params ────────────────────
const buildFilter = (q, ownerFilter = {}) => {
  const f = { ...ownerFilter };

  if (q.search) f.$text = { $search: q.search };
  if (q.city)    f.city    = new RegExp(q.city, 'i');
  if (q.state)   f.state   = new RegExp(q.state, 'i');
  if (q.country) f.country = new RegExp(q.country, 'i');
  if (q.pincode) f.pincode = q.pincode;

  if (q.course)  f.standard = q.course.includes(',') ? { $in: q.course.split(',') } : q.course;
  if (q.stream)  f.stream   = q.stream;

  if (q.gender)          f.gender          = q.gender;
  if (q.category)        f.category        = q.category;
  if (q.institutionType) f.institutionType = q.institutionType;

  if (q.status) {
    f.status = q.status.includes(',') ? { $in: q.status.split(',') } : q.status;
  }
  if (q.certificateStatus) f.certificateStatus = q.certificateStatus;

  if (q.startDate || q.endDate) {
    f.registrationDate = {};
    if (q.startDate) f.registrationDate.$gte = new Date(q.startDate);
    if (q.endDate)   f.registrationDate.$lte = new Date(q.endDate);
  }

  return f;
};

// ── GET /api/students ─────────────────────────────────────────
exports.getStudents = async (req, res) => {
  try {
    const { page = 1, limit = 20, sortBy = 'registrationDate', sortOrder = 'desc' } = req.query;
    const filter = buildFilter(req.query, req.ownerFilter);
    const skip   = (Number(page) - 1) * Number(limit);
    const sort   = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [data, total] = await Promise.all([
      Student.find(filter).sort(sort).skip(skip).limit(Number(limit)).lean(),
      Student.countDocuments(filter),
    ]);

    res.json({ success: true, total, page: Number(page), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/students/filter ──────────────────────────────────
exports.filterStudents = async (req, res) => {
  try {
    const { page = 1, limit = 20, sortBy = 'registrationDate', sortOrder = 'desc' } = req.query;
    const filter = buildFilter(req.query, req.ownerFilter);
    const skip   = (Number(page) - 1) * Number(limit);
    const sort   = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [students, total] = await Promise.all([
      Student.find(filter).sort(sort).skip(skip).limit(Number(limit)).lean(),
      Student.countDocuments(filter),
    ]);

    res.json({ success: true, total, page: Number(page), students });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/students/filter/summary ─────────────────────────
exports.filterSummary = async (req, res) => {
  try {
    const filter = buildFilter(req.query, req.ownerFilter);

    const [total, approved, pending, rejected, certIssued, cities, states] = await Promise.all([
      Student.countDocuments(filter),
      Student.countDocuments({ ...filter, status: 'approved' }),
      Student.countDocuments({ ...filter, status: 'pending' }),
      Student.countDocuments({ ...filter, status: 'rejected' }),
      Student.countDocuments({ ...filter, certificateStatus: 'issued' }),
      Student.distinct('city', filter),
      Student.distinct('state', filter),
    ]);

    const [courseBreakdown, genderBreakdown] = await Promise.all([
      Student.aggregate([{ $match: filter }, { $group: { _id: '$standard', count: { $sum: 1 } } }]),
      Student.aggregate([{ $match: filter }, { $group: { _id: '$gender',   count: { $sum: 1 } } }]),
    ]);

    res.json({
      success: true,
      data: {
        total, approved, pending, rejected,
        certificatesIssued: certIssued,
        cities: cities.filter(Boolean).length,
        states: states.filter(Boolean).length,
        courses: courseBreakdown.length,
        courseBreakdown, genderBreakdown,
        attendancePercent: 0,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/students/stats/summary ──────────────────────────
exports.statsSummary = async (req, res) => {
  try {
    const f = req.ownerFilter || {};
    const [total, approved, pending, rejected, certIssued] = await Promise.all([
      Student.countDocuments(f),
      Student.countDocuments({ ...f, status: 'approved' }),
      Student.countDocuments({ ...f, status: 'pending' }),
      Student.countDocuments({ ...f, status: 'rejected' }),
      Student.countDocuments({ ...f, certificateStatus: 'issued' }),
    ]);
    res.json({ success: true, data: { total, approved, pending, rejected, certificatesIssued: certIssued } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/students/:id ─────────────────────────────────────
exports.getStudent = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id).lean();
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
    res.json({ success: true, data: student });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/students (public registration) ──────────────────
exports.createStudent = async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.admin) data.submittedBy = req.admin._id;
    const student = await Student.create(data);
    res.status(201).json({ success: true, message: 'Student registered.', data: student });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/students/:id ─────────────────────────────────────
exports.updateStudent = async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(
      req.params.id, req.body, { new: true, runValidators: true }
    );
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
    res.json({ success: true, message: 'Student updated.', data: student });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/students/:id ──────────────────────────────────
exports.deleteStudent = async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
    await Promise.all([
      Attendance.deleteMany({ student: student._id }),
      Certificate.deleteMany({ student: student._id }),
    ]);
    res.json({ success: true, message: 'Student deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/students/bulk-approve ──────────────────────────
exports.bulkApprove = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, message: 'ids array is required.' });
    }
    const result = await Student.updateMany(
      { _id: { $in: ids } },
      { status: 'approved', statusUpdatedAt: new Date(), statusUpdatedBy: req.admin._id }
    );
    res.json({ success: true, message: `${result.modifiedCount} student(s) approved.`, modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/students/bulk-reject ───────────────────────────
exports.bulkReject = async (req, res) => {
  try {
    const { ids, reason } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ success: false, message: 'ids array is required.' });
    }
    const result = await Student.updateMany(
      { _id: { $in: ids } },
      { status: 'rejected', statusReason: reason || '', statusUpdatedAt: new Date(), statusUpdatedBy: req.admin._id }
    );
    res.json({ success: true, message: `${result.modifiedCount} student(s) rejected.`, modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
