'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/referrerController');
const { protectAdmin } = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

router.use(protectAdmin);

// Referrals & Commission — permission-gated (Super Admin bypasses; Admin has all perms)
router.get('/stats',                    hasPermission('referrals.view'),   ctrl.getStats);
router.get('/options',                  hasPermission('referrals.view'),   ctrl.getOptions);
router.get('/',                         hasPermission('referrals.view'),   ctrl.getAll);
router.post('/',                        hasPermission('referrals.create'), ctrl.create);
router.put('/:id',                      hasPermission('referrals.update'), ctrl.update);
router.delete('/:id',                   hasPermission('referrals.delete'), ctrl.remove);
router.get('/:id/leads',                hasPermission('referrals.view'),   ctrl.getLeads);
router.patch('/lead/:leadId/commission',hasPermission('referrals.update'), ctrl.updateLeadCommission);

module.exports = router;
