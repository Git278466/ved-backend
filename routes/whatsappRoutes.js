'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/whatsappController');
const { protectAdmin } = require('../middleware/authMiddleware');
const { isAdminOrSuperAdmin } = require('../middleware/roleMiddleware');

router.use(protectAdmin);
// WhatsApp is a system integration (connect / clear-session / send). Restrict
// to Admin & Super Admin — lower-privilege roles must not control it.
router.use(isAdminOrSuperAdmin);

router.get('/status',       ctrl.getStatus);
router.get('/qr',           ctrl.getQR);
router.get('/phone-info',   ctrl.getPhoneInfo);
router.post('/connect',     ctrl.connect);
router.post('/reconnect',   ctrl.reconnect);
router.post('/force-reinit',ctrl.forceReinit);
router.post('/clear-session', ctrl.clearSession);
router.post('/disconnect',  ctrl.disconnect);
router.post('/test',        ctrl.sendTest);

module.exports = router;
