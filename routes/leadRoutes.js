'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/leadController');
const { protectAdmin } = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

router.use(protectAdmin);

// ── Special routes BEFORE /:id ────────────────────────────────
router.get('/funnel',    hasPermission('leads.view'), ctrl.getFunnelStats);
router.get('/analytics', hasPermission('leads.view'), ctrl.getAnalytics);
router.post('/bulk-assign', hasPermission('leads.update'), ctrl.bulkAssign);

// ── CRUD ──────────────────────────────────────────────────────
router.get('/',    hasPermission('leads.view'),   ctrl.getLeads);
router.post('/',   hasPermission('leads.create'), ctrl.createLead);
router.get('/:id', hasPermission('leads.view'),   ctrl.getLead);
router.put('/:id', hasPermission('leads.update'), ctrl.updateLead);
router.delete('/:id', hasPermission('leads.delete'), ctrl.deleteLead);

// ── Activities ────────────────────────────────────────────────
router.get('/:id/activities',  hasPermission('leads.view'),   ctrl.getActivities);
router.post('/:id/activities', hasPermission('leads.update'), ctrl.addActivity);

// ── Convert to student ────────────────────────────────────────
router.post('/:id/convert', hasPermission('leads.update'), ctrl.convertToStudent);

module.exports = router;
