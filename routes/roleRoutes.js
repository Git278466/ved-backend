'use strict';

const express = require('express');

const router = express.Router();

const ctrl = require('../controllers/roleController');

const { protectAdmin } = require('../middleware/authMiddleware');
const { hasPermission } = require('../middleware/roleMiddleware');

/* ============================================================
   ROLE ROUTES
   Base path: /api/roles
============================================================ */

// Protect all role routes
router.use(protectAdmin);

// Get all available permissions
router.get(
  '/permissions',
  hasPermission('roles.view'),
  ctrl.getAllPermissions
);

// Get all roles
router.get(
  '/',
  hasPermission('roles.view'),
  ctrl.getRoles
);

// Get single role
router.get(
  '/:id',
  hasPermission('roles.view'),
  ctrl.getRole
);

// Create role
router.post(
  '/',
  hasPermission('roles.create'),
  ctrl.createRole
);

// Update role
router.put(
  '/:id',
  hasPermission('roles.update'),
  ctrl.updateRole
);

// Delete role
router.delete(
  '/:id',
  hasPermission('roles.delete'),
  ctrl.deleteRole
);

module.exports = router;