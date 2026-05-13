'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/adminController');
const { protectAdmin }        = require('../middleware/authMiddleware');
const { hasPermission, isSuperAdmin }  = require('../middleware/roleMiddleware');

// ── PUBLIC ────────────────────────────────────────────────────
// POST /api/admins/login
router.post('/login', ctrl.login);

// ── PROTECTED ─────────────────────────────────────────────────
router.use(protectAdmin);

// Own profile
router.get('/me',                   ctrl.getMe);
router.post('/change-password',     ctrl.changePassword);

// Danger Zone — must be before /:id routes so "danger" is not treated as an ID
router.delete('/danger/clear-students', isSuperAdmin, ctrl.clearStudentData);
router.post('/danger/reset-settings',   isSuperAdmin, ctrl.resetToDefault);

// Admin CRUD (permission-gated)
router.get('/',                     hasPermission('admin_management.view'),   ctrl.getAdmins);
router.get('/:id',                  hasPermission('admin_management.view'),   ctrl.getAdmin);
router.post('/',                    hasPermission('admin_management.create'), ctrl.createAdmin);
router.put('/:id',                  hasPermission('admin_management.update'), ctrl.updateAdmin);
router.patch('/:id/role',           hasPermission('admin_management.update'), ctrl.changeRole);
router.patch('/:id/status',         hasPermission('admin_management.update'), ctrl.toggleStatus);
router.delete('/:id',               hasPermission('admin_management.delete'), ctrl.deleteAdmin);

module.exports = router;
