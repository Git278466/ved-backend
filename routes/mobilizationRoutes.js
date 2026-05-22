'use strict';

const express        = require('express');
const router         = express.Router();
const Mobilization   = require('../models/Mobilization');
const Admin          = require('../models/Admin');
const Institution    = require('../models/Institution');
const Partner        = require('../models/Partner');
const { protectAdmin } = require('../middleware/authMiddleware');

// ── Validate referral code — check Admin / Institution / Partner ──
async function resolveReferralCode(code) {
  if (!code) return null;
  const upper = code.toUpperCase().trim();
  const [admin, inst, partner] = await Promise.all([
    Admin.findOne({ code: upper }).select('firstName lastName code').lean(),
    Institution.findOne({ code: upper }).select('name code').lean(),
    Partner.findOne({ code: upper }).select('organizationName code').lean(),
  ]);
  if (admin)   return { type: 'admin',       id: admin._id,   name: ((admin.firstName||'') + ' ' + (admin.lastName||'')).trim() };
  if (inst)    return { type: 'institution', id: inst._id,    name: inst.name };
  if (partner) return { type: 'partner',     id: partner._id, name: partner.organizationName };
  return null;
}

// POST /api/mobilization — public, anyone can submit
router.post('/', async (req, res) => {
  try {
    const {
      fullName, guardianName, guardianContact, guardianOccupation,
      organization, mobile,
      dob, gender, address, aadhaar,
      education, skillCourse, futureCourse, degreeMode, educationDest,
      declarationAccepted, registrationDate,
      referralCode,
    } = req.body;

    if (!fullName) {
      return res.status(400).json({ success: false, message: 'Full name is required.' });
    }

    // Resolve referral code if provided
    let referredByType = '';
    let referredById   = undefined;
    let referredByName = '';
    if (referralCode) {
      const ref = await resolveReferralCode(referralCode);
      if (!ref) {
        return res.status(400).json({ success: false, message: `Referral code "${referralCode.toUpperCase()}" is invalid. Please check and try again.` });
      }
      referredByType = ref.type;
      referredById   = ref.id;
      referredByName = ref.name;
    }

    const doc = await Mobilization.create({
      fullName, guardianName, guardianContact, guardianOccupation,
      organization, mobile,
      dob, gender, address, aadhaar,
      education, skillCourse, futureCourse, degreeMode, educationDest,
      declarationAccepted,
      registrationDate: registrationDate || new Date(),
      referralCode:  referralCode ? referralCode.toUpperCase().trim() : undefined,
      referredByType,
      referredById,
      referredByName,
    });
    res.status(201).json({ success: true, message: 'Registration successful! We will get in touch soon.', data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/mobilization/validate-referral?code=XXX — public, used by frontend
router.get('/validate-referral', async (req, res) => {
  try {
    const ref = await resolveReferralCode(req.query.code || '');
    if (!ref) return res.json({ success: false, message: 'Invalid referral code.' });
    res.json({ success: true, type: ref.type, name: ref.name });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// All routes below require admin auth
router.use(protectAdmin);

// GET /api/mobilization — list all submissions with full filtering
router.get('/', async (req, res) => {
  try {
    const {
      search, status, gender, skillCourse, educationDest,
      dateFrom, dateTo,
      page = 1, limit = 50,
    } = req.query;

    const filter = {};
    if (status)        filter.status        = status;
    if (gender)        filter.gender        = gender;
    if (skillCourse)   filter.skillCourse   = new RegExp(skillCourse, 'i');
    if (educationDest) filter.educationDest = educationDest;

    // Date range on registrationDate
    if (dateFrom || dateTo) {
      filter.registrationDate = {};
      if (dateFrom) filter.registrationDate.$gte = new Date(dateFrom);
      if (dateTo)   filter.registrationDate.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
    }

    if (search) {
      filter.$or = [
        { fullName:      new RegExp(search, 'i') },
        { mobile:        new RegExp(search, 'i') },
        { guardianName:  new RegExp(search, 'i') },
        { organization:  new RegExp(search, 'i') },
        { skillCourse:   new RegExp(search, 'i') },
        { aadhaar:       new RegExp(search, 'i') },
        { address:       new RegExp(search, 'i') },
      ];
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip  = (pageNum - 1) * limitNum;
    const total = await Mobilization.countDocuments(filter);
    const data  = await Mobilization.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
      data,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/mobilization/stats
router.get('/stats', async (req, res) => {
  try {
    const [total, newCount, contactedCount, enrolledCount, byGender, byDest, byCourse] = await Promise.all([
      Mobilization.countDocuments(),
      Mobilization.countDocuments({ status: 'new' }),
      Mobilization.countDocuments({ status: 'contacted' }),
      Mobilization.countDocuments({ status: 'enrolled' }),
      Mobilization.aggregate([{ $group: { _id: '$gender',        count: { $sum: 1 } } }]),
      Mobilization.aggregate([{ $group: { _id: '$educationDest', count: { $sum: 1 } } }]),
      Mobilization.aggregate([{ $group: { _id: '$skillCourse',   count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 8 }]),
    ]);
    res.json({ success: true, data: { total, newCount, contactedCount, enrolledCount, byGender, byDest, byCourse } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/mobilization/:id — update status / notes
router.patch('/:id', async (req, res) => {
  try {
    const doc = await Mobilization.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/mobilization/:id
router.delete('/:id', async (req, res) => {
  try {
    const doc = await Mobilization.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, message: 'Deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
