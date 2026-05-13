'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/counsellingResponseController');
const { protectAdmin } = require('../middleware/authMiddleware');

router.post('/',         ctrl.submit);           // public — anyone submits
router.get('/stats',     protectAdmin, ctrl.getStats);
router.get('/',          protectAdmin, ctrl.getAll);
router.get('/:id',       protectAdmin, ctrl.getOne);
router.patch('/:id',     protectAdmin, ctrl.update);

module.exports = router;
