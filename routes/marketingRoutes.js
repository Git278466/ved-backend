'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/marketingController');
const { protectAdmin } = require('../middleware/authMiddleware');

router.use(protectAdmin);

router.get('/',      ctrl.getMaterials);
router.post('/',     ctrl.createMaterial);
router.put('/:id',   ctrl.updateMaterial);
router.delete('/:id',ctrl.deleteMaterial);

module.exports = router;
