'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/dashboardController');
const { protectAdmin }                    = require('../middleware/authMiddleware');
const { hasPermission, scopeToOwn } = require('../middleware/roleMiddleware');

router.use(protectAdmin);
router.use(hasPermission('dashboard.view'));

router.get('/stats',           scopeToOwn, ctrl.getStats);
router.get('/recent-activity', ctrl.getRecentActivity);

module.exports = router;
