'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/whatsappController');
const { protectAdmin } = require('../middleware/authMiddleware');

router.use(protectAdmin);

router.get('/status',     ctrl.getStatus);
router.get('/qr',         ctrl.getQR);
router.post('/connect',   ctrl.connect);
router.post('/reconnect',     ctrl.reconnect);
router.post('/clear-session', ctrl.clearSession);
router.post('/disconnect',ctrl.disconnect);
router.post('/test',      ctrl.sendTest);

module.exports = router;
