'use strict';

const express     = require('express');
const router      = express.Router();
const Certificate = require('../models/Certificate');
const Student     = require('../models/Student');
const { protectAdmin }       = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

router.use(protectAdmin);

router.get('/', hasPermission('certificates.view'), async (req, res) => {
  try {
    const { student, status, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (student) filter.student = student;
    if (status)  filter.status  = status;
    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Certificate.countDocuments(filter);
    const data  = await Certificate.find(filter)
      .populate('student', 'fullName email city standard')
      .populate('issuedBy', 'firstName lastName')
      .sort({ issuedDate: -1 }).skip(skip).limit(Number(limit));
    res.json({ success: true, total, page: Number(page), data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/:id', hasPermission('certificates.view'), async (req, res) => {
  try {
    const cert = await Certificate.findById(req.params.id)
      .populate('student', 'fullName email')
      .populate('issuedBy', 'firstName lastName');
    if (!cert) return res.status(404).json({ success: false, message: 'Certificate not found.' });
    res.json({ success: true, data: cert });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', hasPermission('certificates.issue'), async (req, res) => {
  try {
    const { student, courseCompleted, expiryDate, remarks } = req.body;
    if (!student) return res.status(400).json({ success: false, message: 'student ID required.' });

    const studentDoc = await Student.findById(student);
    if (!studentDoc) return res.status(404).json({ success: false, message: 'Student not found.' });
    if (studentDoc.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Only approved students can receive certificates.' });
    }

    const certNumber = `VED-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const cert = await Certificate.create({
      student, certificateNumber: certNumber,
      courseCompleted: courseCompleted || studentDoc.standard,
      expiryDate, remarks, issuedBy: req.admin._id,
    });
    await Student.findByIdAndUpdate(student, {
      certificateIssued: true, certificateNumber: certNumber,
      certificateIssuedAt: new Date(), certificateStatus: 'issued',
    });
    res.status(201).json({ success: true, message: 'Certificate issued.', data: cert });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Certificate number conflict. Retry.' });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', hasPermission('certificates.delete'), async (req, res) => {
  try {
    const cert = await Certificate.findById(req.params.id);
    if (!cert) return res.status(404).json({ success: false, message: 'Certificate not found.' });
    cert.status = 'revoked';
    await cert.save();
    await Student.findByIdAndUpdate(cert.student, { certificateIssued: false, certificateStatus: 'pending' });
    res.json({ success: true, message: 'Certificate revoked.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
