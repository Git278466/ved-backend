'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/emailController');
const { protectAdmin } = require('../middleware/authMiddleware');
const { isAdminOrSuperAdmin } = require('../middleware/roleMiddleware');

router.use(protectAdmin);
// Email verify / test is a settings-level integration action — Admin & Super Admin only.
router.use(isAdminOrSuperAdmin);

router.get('/verify', ctrl.verify);
router.post('/test',  ctrl.sendTest);

module.exports = router;
