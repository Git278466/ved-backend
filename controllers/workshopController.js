'use strict';

const Workshop = require('../models/Workshop');

// GET /api/workshops  — public, returns all active workshops
exports.getAll = async (req, res) => {
  try {
    const workshops = await Workshop.find({ isActive: true })
      .sort({ displayOrder: 1, createdAt: 1 })
      .select('-createdBy -__v')
      .lean();
    res.json({ success: true, workshops });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/workshops/live  — public, returns currently live workshops
exports.getLive = async (req, res) => {
  try {
    const live = await Workshop.find({ isLive: true, isActive: true })
      .select('name shortName icon color isLive meetingLink meetingPlatform meetingId liveStartedAt')
      .lean();
    res.json({ success: true, live });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/workshops/:id  — public
exports.getOne = async (req, res) => {
  try {
    const w = await Workshop.findById(req.params.id).lean();
    if (!w) return res.status(404).json({ success: false, message: 'Workshop not found.' });
    res.json({ success: true, workshop: w });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/workshops  — admin only
exports.create = async (req, res) => {
  try {
    const w = await Workshop.create({ ...req.body, createdBy: req.admin._id });
    res.status(201).json({ success: true, workshop: w });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/workshops/:id  — admin only
exports.update = async (req, res) => {
  try {
    const w = await Workshop.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!w) return res.status(404).json({ success: false, message: 'Workshop not found.' });
    res.json({ success: true, workshop: w });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PATCH /api/workshops/:id/go-live  — admin: start live session
exports.goLive = async (req, res) => {
  try {
    const { meetingLink, meetingPlatform, meetingId, meetingPassword } = req.body;
    if (!meetingLink) return res.status(400).json({ success: false, message: 'Meeting link is required to go live.' });

    const w = await Workshop.findByIdAndUpdate(
      req.params.id,
      {
        isLive: true, status: 'live',
        liveStartedAt: new Date(),
        meetingLink, meetingPlatform: meetingPlatform || 'google_meet',
        meetingId: meetingId || '', meetingPassword: meetingPassword || '',
      },
      { new: true }
    );
    if (!w) return res.status(404).json({ success: false, message: 'Workshop not found.' });
    res.json({ success: true, message: `"${w.name}" is now LIVE!`, workshop: w });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PATCH /api/workshops/:id/end-live  — admin: end live session
exports.endLive = async (req, res) => {
  try {
    const { recordingLink } = req.body;
    const updates = {
      isLive: false, status: 'completed',
      recordingAvailable: !!recordingLink,
    };
    if (recordingLink) updates.recordingLink = recordingLink;

    const w = await Workshop.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!w) return res.status(404).json({ success: false, message: 'Workshop not found.' });
    res.json({ success: true, message: `"${w.name}" session ended.`, workshop: w });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/workshops/:id  — admin only
exports.remove = async (req, res) => {
  try {
    await Workshop.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Workshop deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/workshops/seed  — admin: upsert default VED workshops by code
exports.seed = async (req, res) => {
  try {
    const defaults = [
      { name:'CyberSafe India Workshop',                     shortName:'CyberSafe',   code:'CSR/QS1001', icon:'🛡️', color:'#7c3aed', category:'cybersecurity', description:'Learn to protect yourself and your organisation from cyber threats, phishing, and online fraud.', highlights:['Ethical Hacking basics','Phishing awareness','Data Privacy laws','Cyber crime reporting'], displayOrder:1 },
      { name:'LinkedIn Leverage Workshop',                   shortName:'LinkedIn',    code:'CSR/CS1002', icon:'💼', color:'#0b63ce', category:'professional',  description:'Build a powerful LinkedIn profile, grow your network and attract career opportunities.', highlights:['Profile optimization','Content strategy','Job search tactics','Personal branding'], displayOrder:2 },
      { name:'Digital Edge Workshop',                        shortName:'Digital Edge',code:'CSR/DM1003', icon:'📱', color:'#f7941d', category:'digital',       description:'Master digital marketing tools — SEO, social media, email campaigns and analytics.', highlights:['SEO fundamentals','Social media ads','Email marketing','Google Analytics'], displayOrder:3 },
      { name:'CodeStart Workshop',                           shortName:'CodeStart',   code:'CSR/WD1004', icon:'💻', color:'#16a34a', category:'technology',   description:'Start your coding journey from scratch — HTML, CSS, JavaScript and web development basics.', highlights:['HTML & CSS basics','JavaScript intro','Build a website','Career in tech'], displayOrder:4 },
      { name:'Mastering the Art of Confident Communication', shortName:'Communication',code:'CSR/RN1005', icon:'🎤', color:'#dc2626', category:'softskills',  description:'Develop powerful communication skills for interviews, presentations and everyday leadership.', highlights:['Public speaking','Interview techniques','Body language','Conflict resolution'], displayOrder:5 },
    ];

    let added = 0;
    for (const w of defaults) {
      const exists = await Workshop.findOne({ code: w.code });
      if (!exists) { await Workshop.create(w); added++; }
    }
    res.json({ success: true, message: added > 0 ? `${added} workshop(s) added successfully.` : 'All default workshops already exist.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
