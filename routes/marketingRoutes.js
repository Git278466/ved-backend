'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/marketingController');
const { protectAdmin } = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

router.use(protectAdmin);

// NOTE: there is no dedicated "marketing" permission in config/permissions.js.
// Reads stay open to any authenticated admin (promotional material is meant to
// be shared, incl. with partners). WRITE operations are gated behind
// website_content perms so lower-privilege roles cannot modify content.
// (Super Admin bypasses; Admin holds all perms.)
router.get('/',      ctrl.getMaterials);
router.post('/',     hasPermission('website_content.create'), ctrl.createMaterial);
router.put('/:id',   hasPermission('website_content.update'), ctrl.updateMaterial);
router.delete('/:id',hasPermission('website_content.delete'), ctrl.deleteMaterial);

module.exports = router;
