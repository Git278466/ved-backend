'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/workshopController');
const { protectAdmin } = require('../middleware/authMiddleware');

// Public routes
router.get('/',           ctrl.getAll);
router.get('/live',       ctrl.getLive);
router.get('/:id',        ctrl.getOne);

// Admin routes
router.post('/seed',              protectAdmin, ctrl.seed);
router.post('/',                  protectAdmin, ctrl.create);
router.put('/:id',                protectAdmin, ctrl.update);
router.patch('/:id/go-live',      protectAdmin, ctrl.goLive);
router.patch('/:id/end-live',     protectAdmin, ctrl.endLive);
router.delete('/:id',             protectAdmin, ctrl.remove);

module.exports = router;
