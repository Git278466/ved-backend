'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/institutionLeadController');
const { protectInstitution } = require('../middleware/authMiddleware');

router.use(protectInstitution);

// Dashboard stats
router.get('/dashboard', ctrl.getDashboard);

// Lead list + export
router.get('/leads/export', ctrl.exportLeads);
router.get('/leads',        ctrl.getLeads);
router.get('/leads/:id',    ctrl.getLeadById);

// Lead actions
router.patch('/leads/:id/status',   ctrl.updateLeadStatus);
router.post('/leads/:id/followup',  ctrl.addFollowUp);
router.post('/leads/:id/convert',   ctrl.convertLead);

// Reports & commission
router.get('/reports',    ctrl.getReports);
router.get('/commission', ctrl.getCommission);

module.exports = router;
