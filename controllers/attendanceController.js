'use strict';

const Attendance = require('../models/Attendance');
const Student    = require('../models/Student');
// Student already imported — used for scoping attendance by owner

const syncStudentCounts = async (studentId) => {
  const [presentCount, totalAttendance] = await Promise.all([
    Attendance.countDocuments({ student: studentId, status: 'present' }),
    Attendance.countDocuments({ student: studentId }),
  ]);
  await Student.findByIdAndUpdate(studentId, { presentCount, totalAttendance });
};

// ── GET /api/attendance ───────────────────────────────────────
exports.getAttendance = async (req, res) => {
  try {
    const { student, date, status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (student) filter.student = student;
    if (status)  filter.status  = status;
    if (date) {
      const d = new Date(date);
      filter.date = { $gte: d, $lt: new Date(d.getTime() + 86400000) };
    }

    // Scope: Associate Partner / Institution see only attendance for their own students
    if (req.scopedAdminId) {
      const myStudentIds = await Student
        .find({ submittedBy: req.scopedAdminId }, '_id')
        .lean()
        .then(s => s.map(x => x._id));
      filter.student = student
        ? (myStudentIds.some(id => id.toString() === student) ? student : null)
        : { $in: myStudentIds };
      if (filter.student === null) {
        return res.json({ success: true, total: 0, data: [] });
      }
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Attendance.countDocuments(filter);
    const data  = await Attendance.find(filter)
      .populate('student',  'fullName email mobile city')
      .populate('markedBy', 'firstName lastName')
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({ success: true, total, page: Number(page), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/attendance ──────────────────────────────────────
exports.markAttendance = async (req, res) => {
  try {
    const { student, date, status, remarks, session } = req.body;
    if (!student || !date || !status) {
      return res.status(400).json({ success: false, message: 'student, date, and status are required.' });
    }

    const record = await Attendance.findOneAndUpdate(
      { student, date: new Date(date), session: session || '' },
      { status, remarks, markedBy: req.admin._id, session: session || '' },
      { upsert: true, new: true }
    );

    await syncStudentCounts(student);
    res.status(201).json({ success: true, message: 'Attendance marked.', data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/attendance/bulk ─────────────────────────────────
exports.bulkMark = async (req, res) => {
  try {
    const { records, date, session } = req.body;
    if (!Array.isArray(records) || !date) {
      return res.status(400).json({ success: false, message: 'records array and date are required.' });
    }

    const ops = records.map(r => ({
      updateOne: {
        filter: { student: r.student, date: new Date(date), session: session || '' },
        update: { $set: { status: r.status, remarks: r.remarks || '', markedBy: req.admin._id, session: session || '' } },
        upsert: true,
      },
    }));

    await Attendance.bulkWrite(ops);
    const studentIds = [...new Set(records.map(r => r.student))];
    await Promise.all(studentIds.map(syncStudentCounts));

    res.json({ success: true, message: `Attendance marked for ${records.length} student(s).` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/attendance/:id ───────────────────────────────────
exports.updateAttendance = async (req, res) => {
  try {
    const record = await Attendance.findByIdAndUpdate(
      req.params.id,
      { ...req.body, markedBy: req.admin._id },
      { new: true, runValidators: true }
    ).populate('student', 'fullName');

    if (!record) return res.status(404).json({ success: false, message: 'Attendance record not found.' });
    await syncStudentCounts(record.student._id);
    res.json({ success: true, message: 'Updated.', data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/attendance/:id ────────────────────────────────
exports.deleteAttendance = async (req, res) => {
  try {
    const record = await Attendance.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Record not found.' });
    await syncStudentCounts(record.student);
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
