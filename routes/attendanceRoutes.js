'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/attendanceController');
const { protectAdmin }       = require('../middleware/authMiddleware');
const { hasPermission, scopeToOwn } = require('../middleware/roleMiddleware');

router.use(protectAdmin);

router.get(  '/',        hasPermission('attendance.view'),   scopeToOwn, ctrl.getAttendance);
router.post( '/',        hasPermission('attendance.create'), ctrl.markAttendance);
router.post( '/bulk',    hasPermission('attendance.create'), ctrl.bulkMark);
router.put(  '/:id',     hasPermission('attendance.update'), ctrl.updateAttendance);
router.delete('/:id',    hasPermission('attendance.delete'), ctrl.deleteAttendance);

module.exports = router;
