'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/workshopController');
const { protectAdmin } = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

// Public routes (website reads live/upcoming workshops — intentionally open)
router.get('/',           ctrl.getAll);
router.get('/live',       ctrl.getLive);
router.get('/:id',        ctrl.getOne);

// Admin routes — now permission-gated (Super Admin bypasses; Admin has all perms)
router.post('/seed',              protectAdmin, hasPermission('workshops.create'), ctrl.seed);
router.post('/',                  protectAdmin, hasPermission('workshops.create'), ctrl.create);
router.put('/:id',                protectAdmin, hasPermission('workshops.update'), ctrl.update);
router.patch('/:id/go-live',      protectAdmin, hasPermission('workshops.update'), ctrl.goLive);
router.patch('/:id/end-live',     protectAdmin, hasPermission('workshops.update'), ctrl.endLive);
router.delete('/:id',             protectAdmin, hasPermission('workshops.delete'), ctrl.remove);

module.exports = router;
