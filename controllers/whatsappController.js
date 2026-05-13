'use strict';

const wa = require('../services/whatsappService');

exports.getStatus = (req, res) => {
  res.json({ success: true, data: wa.getStatus() });
};

exports.getQR = (req, res) => {
  const qr = wa.getQR();
  if (!qr) return res.json({ success: false, message: 'No QR available. Check status.' });
  res.json({ success: true, qr });
};

exports.connect = (req, res) => {
  wa.initWhatsApp();
  res.json({ success: true, message: 'WhatsApp initialization started. Fetch /qr for QR code.' });
};

exports.reconnect = async (req, res) => {
  await wa.reconnect();
  res.json({ success: true, message: 'Session cleared. Reconnecting WhatsApp...' });
};

exports.clearSession = async (req, res) => {
  await wa.disconnect();
  wa.clearSession();
  res.json({ success: true, message: 'Session cleared. Click Connect to start fresh.' });
};

exports.disconnect = async (req, res) => {
  await wa.disconnect();
  res.json({ success: true, message: 'WhatsApp disconnected.' });
};

exports.sendTest = async (req, res) => {
  try {
    const { mobile, message } = req.body;
    if (!mobile || !message) return res.status(400).json({ success: false, message: 'mobile and message required.' });
    const result = await wa.sendMessage(mobile, message);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
