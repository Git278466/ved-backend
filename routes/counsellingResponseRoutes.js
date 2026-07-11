'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/counsellingResponseController');
const { protectAdmin } = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

router.post('/',         ctrl.submit);           // public — anyone submits the form
// Admin reads/updates — permission-gated (Super Admin bypasses; Admin has all perms)
router.get('/stats',     protectAdmin, hasPermission('counselling_cert.view'),   ctrl.getStats);
router.get('/',          protectAdmin, hasPermission('counselling_cert.view'),   ctrl.getAll);
router.get('/:id',       protectAdmin, hasPermission('counselling_cert.view'),   ctrl.getOne);
router.patch('/:id',     protectAdmin, hasPermission('counselling_cert.update'), ctrl.update);

module.exports = router;
