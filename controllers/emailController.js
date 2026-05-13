'use strict';

const emailSvc = require('../services/emailService');

exports.verify = async (req, res) => {
  const result = await emailSvc.verifyConnection();
  res.json({ success: result.ok, message: result.message });
};

exports.sendTest = async (req, res) => {
  try {
    const { to, subject, message } = req.body;
    if (!to || !subject || !message) {
      return res.status(400).json({ success: false, message: 'to, subject, and message are required.' });
    }
    const result = await emailSvc.sendEmail({ to, subject, html: message, text: message });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
