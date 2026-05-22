'use strict';

const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const ctrl    = require('../controllers/leadController');
const { protectAdmin } = require('../middleware/authMiddleware');
const { hasPermission, scopeToOwn } = require('../middleware/roleMiddleware');

// multer: store file in memory (max 10 MB), accept only spreadsheet/pdf types
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|csv|pdf)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .xlsx, .xls, .csv, .pdf files are allowed.'), ok);
  },
});

router.use(protectAdmin);

// ── Special routes BEFORE /:id ────────────────────────────────
router.get('/funnel',           hasPermission('leads.view'), scopeToOwn, ctrl.getFunnelStats);
router.get('/analytics',        hasPermission('leads.view'), scopeToOwn, ctrl.getAnalytics);
router.get('/export',           hasPermission('leads.export'), scopeToOwn, ctrl.exportLeads);
router.get('/partner-progress', hasPermission('leads.view'), ctrl.getPartnerProgress);
router.post('/import',          hasPermission('leads.create'), upload.single('file'), ctrl.importLeads);
router.post('/bulk-assign', hasPermission('leads.update'), ctrl.bulkAssign);

// ── CRUD ──────────────────────────────────────────────────────
router.get('/',    hasPermission('leads.view'),   scopeToOwn, ctrl.getLeads);
router.post('/',   hasPermission('leads.create'), ctrl.createLead);
router.get('/:id', hasPermission('leads.view'),   scopeToOwn, ctrl.getLead);
router.put('/:id', hasPermission('leads.update'), scopeToOwn, ctrl.updateLead);
router.delete('/:id', hasPermission('leads.delete'), ctrl.deleteLead);

// ── Activities ────────────────────────────────────────────────
router.get('/:id/activities',  hasPermission('leads.view'),   ctrl.getActivities);
router.post('/:id/activities', hasPermission('leads.update'), ctrl.addActivity);

// ── Convert to student ────────────────────────────────────────
router.post('/:id/convert', hasPermission('leads.update'), ctrl.convertToStudent);

module.exports = router;
