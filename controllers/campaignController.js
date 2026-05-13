'use strict';

const Campaign        = require('../models/Campaign');
const CampaignMessage = require('../models/CampaignMessage');
const Student         = require('../models/Student');
const processor       = require('../services/campaignProcessor');

/* ── List campaigns ─────────────────────────────────────────────── */
exports.getCampaigns = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, type } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type)   filter.type   = type;

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      Campaign.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit))
        .populate('createdBy', 'firstName lastName fullName').lean(),
      Campaign.countDocuments(filter),
    ]);
    res.json({ success: true, total, page: Number(page), data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── Get single campaign + stats ────────────────────────────────── */
exports.getCampaign = async (req, res) => {
  try {
    const c = await processor.getCampaignProgress(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Campaign not found' });
    res.json({ success: true, data: c });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── Create campaign ────────────────────────────────────────────── */
exports.createCampaign = async (req, res) => {
  try {
    const { name, type, message, subject, mediaUrl, mediaType,
            recipientType, filters, batchSize, delayBetweenMs, scheduledAt } = req.body;

    if (!name || !type || !message) {
      return res.status(400).json({ success: false, message: 'name, type and message are required.' });
    }

    // Preview recipient count
    const filter  = { status: 'approved' };
    if (filters?.city)    filter.city     = new RegExp(filters.city,  'i');
    if (filters?.state)   filter.state    = new RegExp(filters.state, 'i');
    if (filters?.standard)filter.standard = filters.standard;
    if (filters?.gender)  filter.gender   = filters.gender;
    const recipientCount = await Student.countDocuments(filter);

    const campaign = await Campaign.create({
      name, type, message, subject, mediaUrl, mediaType,
      recipientType: recipientType || 'all',
      filters:       filters       || {},
      batchSize:     batchSize     || 30,
      delayBetweenMs:delayBetweenMs|| 2000,
      scheduledAt:   scheduledAt   || null,
      recipientCount,
      status:        scheduledAt   ? 'queued' : 'draft',
      createdBy:     req.admin._id,
    });

    res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── Update draft campaign ──────────────────────────────────────── */
exports.updateCampaign = async (req, res) => {
  try {
    const c = await Campaign.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    if (!['draft','queued'].includes(c.status)) {
      return res.status(400).json({ success: false, message: 'Only draft/queued campaigns can be edited.' });
    }
    const updated = await Campaign.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── Delete campaign ────────────────────────────────────────────── */
exports.deleteCampaign = async (req, res) => {
  try {
    const c = await Campaign.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    if (c.status === 'running') {
      return res.status(400).json({ success: false, message: 'Pause the campaign before deleting.' });
    }
    await CampaignMessage.deleteMany({ campaign: c._id });
    await c.deleteOne();
    res.json({ success: true, message: 'Campaign deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── Send / launch campaign ─────────────────────────────────────── */
exports.launchCampaign = async (req, res) => {
  try {
    const result = await processor.startCampaign(req.params.id);
    res.json({ success: true, message: 'Campaign launched.', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/* ── Pause ──────────────────────────────────────────────────────── */
exports.pauseCampaign = async (req, res) => {
  try {
    await processor.pauseCampaign(req.params.id);
    res.json({ success: true, message: 'Campaign paused.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/* ── Resume ─────────────────────────────────────────────────────── */
exports.resumeCampaign = async (req, res) => {
  try {
    await processor.resumeCampaign(req.params.id);
    res.json({ success: true, message: 'Campaign resumed.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/* ── Retry failed ───────────────────────────────────────────────── */
exports.retryFailed = async (req, res) => {
  try {
    await processor.retryFailed(req.params.id);
    res.json({ success: true, message: 'Retrying failed messages.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/* ── Get message-level details ──────────────────────────────────── */
exports.getMessages = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = { campaign: req.params.id };
    if (status) filter.status = status;
    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      CampaignMessage.find(filter).sort({ createdAt: 1 }).skip(skip).limit(Number(limit)).lean(),
      CampaignMessage.countDocuments(filter),
    ]);
    res.json({ success: true, total, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── Overview stats ─────────────────────────────────────────────── */
exports.getOverview = async (req, res) => {
  try {
    const [total, running, completed, failed] = await Promise.all([
      Campaign.countDocuments(),
      Campaign.countDocuments({ status: 'running' }),
      Campaign.countDocuments({ status: 'completed' }),
      Campaign.countDocuments({ status: 'failed' }),
    ]);
    const msgStats = await CampaignMessage.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const msgs = {};
    msgStats.forEach(s => { msgs[s._id] = s.count; });
    res.json({ success: true, data: { total, running, completed, failed, messages: msgs } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
