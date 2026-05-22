'use strict';

const Campaign        = require('../models/Campaign');
const CampaignMessage = require('../models/CampaignMessage');
const Student         = require('../models/Student');
const whatsapp        = require('./whatsappService');
const email           = require('./emailService');

const MAX_RETRIES    = 3;
const MAX_CONCURRENT = 5;   // parallel sends per batch

/* ── Sleep helper ───────────────────────────────────────────────── */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ─────────────────────────────────────────────────────────────────
   START CAMPAIGN
   Builds recipient list → saves CampaignMessages → starts processor
───────────────────────────────────────────────────────────────── */
async function startCampaign(campaignId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status === 'running') throw new Error('Already running');

  // For WhatsApp campaigns, verify the client is ready before starting
  if (campaign.type === 'whatsapp' && !whatsapp.isReady()) {
    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'failed',
      notes: 'WhatsApp is not connected. Connect WhatsApp first before launching this campaign.',
    });
    throw new Error('WhatsApp is not connected. Please connect WhatsApp first before launching this campaign.');
  }

  // ── 1. Build recipient list ──────────────────────────────────
  const filter = _buildStudentFilter(campaign);
  const students = await Student.find(filter)
    .select('fullName email mobile')
    .lean();

  if (!students.length) {
    await Campaign.findByIdAndUpdate(campaignId, { status: 'failed', notes: 'No recipients found' });
    throw new Error('No recipients found for this campaign');
  }

  // ── 2. Remove existing pending messages (allow restart) ───────
  await CampaignMessage.deleteMany({ campaign: campaignId, status: 'pending' });

  // ── 3. Create CampaignMessage docs for all recipients ─────────
  const batchSize   = campaign.batchSize || 30;
  const messages    = students.map((s, idx) => ({
    campaign:          campaignId,
    student:           s._id,
    recipientName:     s.fullName,
    recipientEmail:    s.email    || '',
    recipientMobile:   s.mobile   || '',
    recipientWhatsapp: s.mobile   || '',
    status:            'pending',
    batchIndex:        Math.floor(idx / batchSize),
  }));

  await CampaignMessage.insertMany(messages, { ordered: false });

  const totalBatches = Math.ceil(messages.length / batchSize);

  await Campaign.findByIdAndUpdate(campaignId, {
    status:           'running',
    startedAt:        new Date(),
    recipientCount:   messages.length,
    pendingCount:     messages.length,
    sentCount:        0,
    failedCount:      0,
    currentBatchIndex:0,
    totalBatches,
  });

  // ── 4. Run processor in background ───────────────────────────
  _processCampaign(campaignId).catch(err => {
    console.error(`[Campaign ${campaignId}] Fatal error:`, err.message);
    Campaign.findByIdAndUpdate(campaignId, { status: 'failed', notes: err.message }).exec();
  });

  return { recipientCount: messages.length, totalBatches };
}

/* ─────────────────────────────────────────────────────────────────
   CORE PROCESSOR — runs batches one by one
───────────────────────────────────────────────────────────────── */
async function _processCampaign(campaignId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) return;

  const delayMs    = campaign.delayBetweenMs || 2000;
  const totalBatches = campaign.totalBatches || 0;

  for (let batchIdx = campaign.currentBatchIndex; batchIdx < totalBatches; batchIdx++) {

    // Check if paused / cancelled between batches
    const fresh = await Campaign.findById(campaignId).lean();
    if (!fresh || fresh.status === 'paused' || fresh.status === 'failed') {
      console.log(`[Campaign ${campaignId}] Paused/stopped at batch ${batchIdx}`);
      return;
    }

    // Get pending messages for this batch
    const msgs = await CampaignMessage.find({
      campaign:   campaignId,
      batchIndex: batchIdx,
      status:     { $in: ['pending', 'failed'] },
      retryCount: { $lt: MAX_RETRIES },
    }).lean();

    if (!msgs.length) {
      await Campaign.findByIdAndUpdate(campaignId, { currentBatchIndex: batchIdx + 1 });
      continue;
    }

    console.log(`[Campaign ${campaignId}] Processing batch ${batchIdx + 1}/${totalBatches} — ${msgs.length} messages`);

    // Process batch with concurrency limit
    await _processBatch(campaign, msgs);

    // Update progress
    await Campaign.findByIdAndUpdate(campaignId, { currentBatchIndex: batchIdx + 1 });

    // Delay between batches
    if (batchIdx < totalBatches - 1) await sleep(delayMs);
  }

  // ── Mark complete ─────────────────────────────────────────────
  const stats = await CampaignMessage.aggregate([
    { $match: { campaign: campaign._id } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const statMap = {};
  stats.forEach(s => { statMap[s._id] = s.count; });

  await Campaign.findByIdAndUpdate(campaignId, {
    status:         'completed',
    completedAt:    new Date(),
    sentCount:      statMap['sent']    || 0,
    failedCount:    statMap['failed']  || 0,
    pendingCount:   0,
  });

  console.log(`[Campaign ${campaignId}] Completed`);
}

/* ── Process one batch with MAX_CONCURRENT parallel sends ─────── */
async function _processBatch(campaign, messages) {
  const chunks = _chunk(messages, MAX_CONCURRENT);

  for (const chunk of chunks) {
    await Promise.all(chunk.map(msg => _sendOne(campaign, msg)));
  }
}

/* ── Send one message ────────────────────────────────────────────── */
async function _sendOne(campaign, msg) {
  await CampaignMessage.findByIdAndUpdate(msg._id, { status: 'sending' });

  try {
    const rendered = email.renderTemplate(campaign.message, {
      name:   msg.recipientName  || '',
      email:  msg.recipientEmail || '',
      mobile: msg.recipientMobile|| '',
    });

    if (campaign.type === 'whatsapp') {
      if (!msg.recipientWhatsapp) throw new Error('No WhatsApp number');
      await whatsapp.sendMessage(msg.recipientWhatsapp, rendered);

    } else if (campaign.type === 'email') {
      if (!msg.recipientEmail) throw new Error('No email address');
      const subject = email.renderTemplate(campaign.subject || 'Message from VED Foundation', {
        name: msg.recipientName || '',
      });
      await email.sendEmail({ to: msg.recipientEmail, subject, html: rendered, text: rendered });
    }

    await CampaignMessage.findByIdAndUpdate(msg._id, { status: 'sent', sentAt: new Date(), errorMessage: '' });
    await Campaign.findByIdAndUpdate(campaign._id, { $inc: { sentCount: 1, pendingCount: -1 } });

  } catch (err) {
    const retryCount = (msg.retryCount || 0) + 1;
    const finalFail  = retryCount >= MAX_RETRIES;

    await CampaignMessage.findByIdAndUpdate(msg._id, {
      status:       finalFail ? 'failed' : 'pending',
      errorMessage: err.message,
      retryCount,
    });

    if (finalFail) {
      await Campaign.findByIdAndUpdate(campaign._id, { $inc: { failedCount: 1, pendingCount: -1 } });
    }
  }
}

/* ─────────────────────────────────────────────────────────────────
   PAUSE / RESUME / RETRY FAILED
───────────────────────────────────────────────────────────────── */
async function pauseCampaign(campaignId) {
  const c = await Campaign.findById(campaignId);
  if (!c || c.status !== 'running') throw new Error('Campaign is not running');
  await Campaign.findByIdAndUpdate(campaignId, { status: 'paused' });
}

async function resumeCampaign(campaignId) {
  const c = await Campaign.findById(campaignId);
  if (!c || c.status !== 'paused') throw new Error('Campaign is not paused');
  await Campaign.findByIdAndUpdate(campaignId, { status: 'running' });
  _processCampaign(campaignId).catch(console.error);
}

async function retryFailed(campaignId) {
  await CampaignMessage.updateMany(
    { campaign: campaignId, status: 'failed', retryCount: { $lt: MAX_RETRIES } },
    { status: 'pending', errorMessage: '', $inc: { retryCount: 0 } }
  );
  const c = await Campaign.findById(campaignId);
  if (c && c.status === 'completed') {
    await Campaign.findByIdAndUpdate(campaignId, { status: 'running' });
    _processCampaign(campaignId).catch(console.error);
  }
}

/* ── Build MongoDB filter from campaign settings ─────────────────── */
function _buildStudentFilter(campaign) {
  const f = { status: 'approved' };
  if (campaign.filters) {
    if (campaign.filters.city)    f.city   = new RegExp(campaign.filters.city,  'i');
    if (campaign.filters.state)   f.state  = new RegExp(campaign.filters.state, 'i');
    if (campaign.filters.standard)f.standard = campaign.filters.standard;
    if (campaign.filters.gender)  f.gender = campaign.filters.gender;
  }
  return f;
}

/* ── Chunk array ─────────────────────────────────────────────────── */
function _chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ── Get campaign progress ───────────────────────────────────────── */
async function getCampaignProgress(campaignId) {
  const c = await Campaign.findById(campaignId).lean();
  if (!c) return null;
  const progress = c.recipientCount
    ? Math.round(((c.sentCount + c.failedCount) / c.recipientCount) * 100)
    : 0;
  return { ...c, progressPercent: progress };
}

module.exports = { startCampaign, pauseCampaign, resumeCampaign, retryFailed, getCampaignProgress };
