'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/referrerController');
const { protectAdmin } = require('../middleware/authMiddleware');

router.use(protectAdmin);

router.get('/stats',                    ctrl.getStats);
router.get('/options',                  ctrl.getOptions);
router.get('/',                         ctrl.getAll);
router.post('/',                        ctrl.create);
router.put('/:id',                      ctrl.update);
router.delete('/:id',                   ctrl.remove);
router.get('/:id/leads',               ctrl.getLeads);
router.patch('/lead/:leadId/commission', ctrl.updateLeadCommission);

module.exports = router;
