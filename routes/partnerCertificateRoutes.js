'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const QRCode  = require('qrcode');

const PartnerCertificateRequest = require('../models/PartnerCertificateRequest');
const CEPCertificate            = require('../models/CEPCertificate');
const Notification              = require('../models/Notification');
const Admin                     = require('../models/Admin');
const Role                      = require('../models/Role');

const { protectAdmin }  = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

/* ── Helpers ─────────────────────────────────────────────────────── */

function genCertNumber() {
  return `CEP-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
}

function genVerificationId() {
  return crypto.randomBytes(16).toString('hex');
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host  = req.headers['x-forwarded-host']  || req.get('host') || 'localhost:5000';
  return `${proto}://${host}`;
}

async function bulkNotify(recipientIds, payload) {
  if (!recipientIds.length) return;
  await Notification.insertMany(
    recipientIds.map(id => ({ recipient: id, ...payload })),
    { ordered: false }
  ).catch(() => {});
}

/* ══════════════════════════════════════════════════════════════════
   PUBLIC — verify certificate (no auth needed)
══════════════════════════════════════════════════════════════════ */
router.get('/verify/:verificationId', async (req, res) => {
  try {
    const cert = await CEPCertificate
      .findOne({ verificationId: req.params.verificationId })
      .populate('issuedBy', 'firstName lastName')
      .lean();
    if (!cert) return res.status(404).json({ success: false, message: 'Certificate not found.' });
    res.json({ success: true, data: cert });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ══════════════════════════════════════════════════════════════════
   All routes below require admin JWT
══════════════════════════════════════════════════════════════════ */
router.use(protectAdmin);

/* ── PARTNER: Submit certificate request ─────────────────────────── */
router.post('/request', async (req, res) => {
  try {
    const { institutionName, registeredAddress, registrationDate, remarks } = req.body;

    if (!institutionName?.trim() || !registeredAddress?.trim() || !registrationDate) {
      return res.status(400).json({
        success: false,
        message: 'Institution name, registered address, and registration date are required.'
      });
    }

    const admin       = await Admin.findById(req.admin._id).lean();
    const partnerName = `${admin.firstName} ${admin.lastName}`.trim();
    const partnerCode = admin.code || '';
    const requestNumber = `PREQ-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

    const request = await PartnerCertificateRequest.create({
      requestNumber,
      partner:           req.admin._id,
      partnerName,
      partnerCode,
      institutionName:   institutionName.trim(),
      registeredAddress: registeredAddress.trim(),
      registrationDate:  new Date(registrationDate),
      remarks:           remarks?.trim() || '',
    });

    // Notify all non-AP admins (Super Admin + Admin roles)
    const apRole = await Role.findOne({ name: 'Associate Partner' }).lean();
    const adminsToNotify = await Admin.find({
      status: 'active',
      _id: { $ne: req.admin._id },
      ...(apRole ? { role: { $ne: apRole._id } } : {})
    }).select('_id').lean();

    await bulkNotify(adminsToNotify.map(a => a._id), {
      type:    'cert_request',
      title:   'New CEP Certificate Request',
      message: `${partnerName} (${partnerCode || 'N/A'}) submitted a certificate request for "${institutionName}".`,
      data:    { requestId: request._id, requestNumber }
    });

    res.status(201).json({ success: true, message: 'Certificate request submitted successfully.', data: request });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Duplicate request number. Please retry.' });
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── PARTNER: Get own requests ───────────────────────────────────── */
router.get('/my-requests', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip   = (Number(page) - 1) * Number(limit);
    const filter = { partner: req.admin._id };

    const [total, data] = await Promise.all([
      PartnerCertificateRequest.countDocuments(filter),
      PartnerCertificateRequest.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('certificate', 'certificateNumber verificationId issuedDate qrCode verifyUrl status')
        .lean()
    ]);

    res.json({ success: true, total, page: Number(page), data });
  } catch (err) {
    console.error('[CEP /my-requests ERROR]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── PARTNER: Get own certificate detail by CEPCertificate _id ───── */
router.get('/my-certificate/:id', async (req, res) => {
  try {
    const cert = await CEPCertificate
      .findById(req.params.id)
      .populate({ path: 'request', select: 'partner' })
      .lean();

    if (!cert) return res.status(404).json({ success: false, message: 'Certificate not found.' });
    if (String(cert.request?.partner) !== String(req.admin._id)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    res.json({ success: true, data: cert });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ══════════════════════════════════════════════════════════════════
   ADMIN routes
══════════════════════════════════════════════════════════════════ */

/* ── List all requests (with filters) ───────────────────────────── */
router.get('/admin/requests', hasPermission('cep_certificates.view'), async (req, res) => {
  try {
    const { status, search, page = 1, limit = 25, dateFrom, dateTo } = req.query;
    const filter = {};

    if (status && status !== 'all') filter.status = status;
    if (dateFrom || dateTo) {
      filter.submittedAt = {};
      if (dateFrom) filter.submittedAt.$gte = new Date(dateFrom);
      if (dateTo)   filter.submittedAt.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
    }
    if (search) {
      filter.$or = [
        { partnerName:     new RegExp(search, 'i') },
        { partnerCode:     new RegExp(search, 'i') },
        { institutionName: new RegExp(search, 'i') },
        { requestNumber:   new RegExp(search, 'i') },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [total, data, pendingCount] = await Promise.all([
      PartnerCertificateRequest.countDocuments(filter),
      PartnerCertificateRequest.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('reviewedBy', 'firstName lastName')
        .populate('certificate', 'certificateNumber verificationId status')
        .lean(),
      PartnerCertificateRequest.countDocuments({ status: 'pending' })
    ]);

    res.json({
      success: true, total, pendingCount,
      page: Number(page), pages: Math.ceil(total / Number(limit)), data
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── Get single request detail ───────────────────────────────────── */
router.get('/admin/requests/:id', hasPermission('cep_certificates.view'), async (req, res) => {
  try {
    const request = await PartnerCertificateRequest.findById(req.params.id)
      .populate('partner',    'firstName lastName email mobile code')
      .populate('reviewedBy', 'firstName lastName')
      .populate('certificate')
      .lean();
    if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });
    res.json({ success: true, data: request });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── Approve → generate CEP certificate ─────────────────────────── */
router.put('/admin/requests/:id/approve', hasPermission('cep_certificates.approve'), async (req, res) => {
  try {
    const request = await PartnerCertificateRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Request is already ${request.status}.` });
    }

    // Generate certificate artifacts
    const certNumber     = genCertNumber();
    const verificationId = genVerificationId();
    const baseUrl        = getBaseUrl(req);
    const verifyUrl      = `${baseUrl}/verify-cep-certificate.html?id=${verificationId}`;
    const qrCode         = await QRCode.toDataURL(verifyUrl, {
      width: 200, margin: 1,
      color: { dark: '#1a1a1a', light: '#ffffff' }
    });

    const cert = await CEPCertificate.create({
      request:           request._id,
      certificateNumber: certNumber,
      verificationId,
      partnerName:       request.partnerName,
      partnerCode:       request.partnerCode,
      institutionName:   request.institutionName,
      registeredAddress: request.registeredAddress,
      registrationDate:  request.registrationDate,
      issuedBy:          req.admin._id,
      qrCode,
      verifyUrl,
    });

    request.status      = 'approved';
    request.reviewedAt  = new Date();
    request.reviewedBy  = req.admin._id;
    request.certificate = cert._id;
    await request.save();

    // Notify the partner
    await Notification.create({
      recipient: request.partner,
      type:    'cert_approved',
      title:   'Your CEP Certificate is Ready!',
      message: `Certificate ${certNumber} approved and ready for download.`,
      data:    { requestId: request._id, certificateId: cert._id, certNumber, verificationId }
    });

    res.json({ success: true, message: 'Certificate approved and generated.', data: { request, certificate: cert } });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Certificate number conflict. Please retry.' });
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── Reject / reset request ──────────────────────────────────────── */
router.put('/admin/requests/:id/reject', hasPermission('cep_certificates.approve'), async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    if (!rejectionReason?.trim()) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
    }

    const request = await PartnerCertificateRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });

    // If approved, also delete the linked certificate so partner can re-apply fresh
    if (request.status === 'approved' && request.certificate) {
      await CEPCertificate.findByIdAndDelete(request.certificate);
      request.certificate = null;
    }

    request.status          = 'rejected';
    request.rejectionReason = rejectionReason.trim();
    request.reviewedAt      = new Date();
    request.reviewedBy      = req.admin._id;
    await request.save();

    await Notification.create({
      recipient: request.partner,
      type:    'cert_rejected',
      title:   'Certificate Request Rejected',
      message: `Your request was rejected. Reason: ${rejectionReason}`,
      data:    { requestId: request._id }
    });

    res.json({ success: true, message: 'Request rejected.', data: request });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── Allow partner to edit their approved request ───────────────── */
router.put('/admin/requests/:id/allow-edit', hasPermission('cep_certificates.approve'), async (req, res) => {
  try {
    const request = await PartnerCertificateRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });
    if (request.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Only approved requests can be unlocked for edit.' });
    }

    request.editAllowed   = true;
    request.editAllowedAt = new Date();
    request.editAllowedBy = req.admin._id;
    await request.save();

    await Notification.create({
      recipient: request.partner,
      type:    'cert_edit_allowed',
      title:   'You Can Now Edit Your Certificate Details',
      message: 'Admin has allowed you to update your institution details. Please resubmit your certificate request.',
      data:    { requestId: request._id }
    });

    res.json({ success: true, message: 'Edit permission granted to partner.', data: request });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── List all issued CEP certificates ────────────────────────────── */
router.get('/admin/certificates', hasPermission('cep_certificates.view'), async (req, res) => {
  try {
    const { status, search, page = 1, limit = 25 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { certificateNumber: new RegExp(search, 'i') },
        { partnerName:       new RegExp(search, 'i') },
        { partnerCode:       new RegExp(search, 'i') },
        { institutionName:   new RegExp(search, 'i') },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [total, data] = await Promise.all([
      CEPCertificate.countDocuments(filter),
      CEPCertificate.find(filter)
        .sort({ issuedDate: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('issuedBy', 'firstName lastName')
        .lean()
    ]);
    res.json({ success: true, total, page: Number(page), pages: Math.ceil(total / Number(limit)), data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── Delete cert + hard-delete request so partner can re-apply fresh ── */
router.delete('/admin/requests/:requestId/certificate', hasPermission('cep_certificates.delete'), async (req, res) => {
  try {
    const reason = req.body?.revokeReason?.trim() || 'Certificate deleted by admin.';

    const request = await PartnerCertificateRequest.findById(req.params.requestId).lean();
    if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });

    // Hard delete the linked certificate
    const certToDelete = request.certificate || req.body?.certId;
    if (certToDelete) {
      await CEPCertificate.findByIdAndDelete(certToDelete);
    }

    // Hard delete the request so it's gone from history
    await PartnerCertificateRequest.findByIdAndDelete(req.params.requestId);

    // Notify partner
    if (request.partner) {
      await bulkNotify([request.partner], {
        type:    'cert_deleted',
        title:   'Your CEP Certificate Was Removed',
        message: `${reason} You may submit a new certificate request to re-apply.`,
        data:    {},
      });
    }

    res.json({ success: true, message: 'Certificate deleted. Partner can now re-apply.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── Delete a request (any status) ─────────────────────────────── */
router.delete('/admin/requests/:id', hasPermission('cep_certificates.delete'), async (req, res) => {
  try {
    const request = await PartnerCertificateRequest.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });

    const reason = req.body?.revokeReason?.trim() || 'Removed by admin.';

    if (request.status === 'approved') {
      // Approved: delete the cert + reset request to rejected so partner can re-apply
      if (request.certificate) {
        await CEPCertificate.findByIdAndDelete(request.certificate);
      }
      await PartnerCertificateRequest.findByIdAndUpdate(req.params.id, {
        $set: {
          status:          'rejected',
          rejectionReason: `${reason} You may submit a new request to re-apply.`,
          certificate:     null,
          reviewedAt:      new Date(),
          reviewedBy:      req.admin._id,
        }
      });
      // Notify partner
      if (request.partner) {
        await bulkNotify([request.partner], {
          type:    'cert_deleted',
          title:   'Your CEP Certificate Was Removed',
          message: `${reason} You may submit a new certificate request to re-apply.`,
          data:    { requestId: request._id },
        });
      }
      return res.json({ success: true, message: 'Certificate deleted. Partner can now re-apply.' });
    }

    // Pending / rejected: hard delete the request (and cert if any)
    if (request.certificate) {
      await CEPCertificate.findByIdAndDelete(request.certificate);
    }
    await PartnerCertificateRequest.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Request deleted successfully.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
