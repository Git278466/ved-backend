'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/emailController');
const { protectAdmin } = require('../middleware/authMiddleware');

router.use(protectAdmin);

router.get('/verify', ctrl.verify);
router.post('/test',  ctrl.sendTest);

module.exports = router;
