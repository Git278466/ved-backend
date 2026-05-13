'use strict';

const CounsellingResponse = require('../models/CounsellingResponse');

// POST /api/counselling-responses  — public
exports.submit = async (req, res) => {
  try {
    const { userType, fullName, email, mobile, counsellingAnswers, programName, completionDate, preferredMode, message } = req.body;

    if (!userType) {
      return res.status(400).json({ success: false, message: 'userType is required.' });
    }

    const entry = await CounsellingResponse.create({
      userType, fullName, email, mobile, counsellingAnswers: counsellingAnswers || [],
      programName, completionDate: completionDate || null, preferredMode: preferredMode || 'online', message,
    });

    res.status(201).json({ success: true, message: 'Submission received! We will process your certificate request soon.', id: entry._id });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// GET /api/counselling-responses  — admin only
exports.getAll = async (req, res) => {
  try {
    const { status, userType, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status)   filter.certificateStatus = status;
    if (userType) filter.userType = userType;

    const skip  = (page - 1) * limit;
    const [items, total] = await Promise.all([
      CounsellingResponse.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      CounsellingResponse.countDocuments(filter),
    ]);

    res.json({ success: true, items, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/counselling-responses/stats  — admin only
exports.getStats = async (req, res) => {
  try {
    const [total, byStatus, byType] = await Promise.all([
      CounsellingResponse.countDocuments(),
      CounsellingResponse.aggregate([{ $group: { _id: '$certificateStatus', count: { $sum: 1 } } }]),
      CounsellingResponse.aggregate([{ $group: { _id: '$userType', count: { $sum: 1 } } }]),
    ]);
    const toMap = arr => Object.fromEntries(arr.map(x => [x._id, x.count]));
    res.json({ success: true, stats: { total, byStatus: toMap(byStatus), byType: toMap(byType) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/counselling-responses/:id  — admin only
exports.getOne = async (req, res) => {
  try {
    const item = await CounsellingResponse.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/counselling-responses/:id  — admin only
exports.update = async (req, res) => {
  try {
    const { certificateStatus, adminNotes, certificateNumber } = req.body;
    const updates = {};
    if (certificateStatus)  updates.certificateStatus = certificateStatus;
    if (adminNotes !== undefined) updates.adminNotes = adminNotes;
    if (certificateNumber)  updates.certificateNumber = certificateNumber;
    if (certificateStatus === 'issued') {
      updates.reviewedAt = new Date();
      if (req.admin) updates.reviewedBy = req.admin._id;
      if (!certificateNumber) updates.certificateNumber = 'VEDCERT-' + Date.now();
    }

    const item = await CounsellingResponse.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
