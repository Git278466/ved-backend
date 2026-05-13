'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/campaignController');
const { protectAdmin } = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

router.use(protectAdmin);

router.get('/overview',               ctrl.getOverview);
router.get('/',                       ctrl.getCampaigns);
router.post('/',  hasPermission('leads.create'), ctrl.createCampaign);
router.get('/:id',                    ctrl.getCampaign);
router.put('/:id', hasPermission('leads.update'), ctrl.updateCampaign);
router.delete('/:id', hasPermission('leads.delete'), ctrl.deleteCampaign);

router.post('/:id/launch',  hasPermission('leads.update'), ctrl.launchCampaign);
router.post('/:id/pause',   hasPermission('leads.update'), ctrl.pauseCampaign);
router.post('/:id/resume',  hasPermission('leads.update'), ctrl.resumeCampaign);
router.post('/:id/retry',   hasPermission('leads.update'), ctrl.retryFailed);
router.get('/:id/messages', ctrl.getMessages);

module.exports = router;
