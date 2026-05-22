'use strict';

const wa = require('../services/whatsappService');

exports.getStatus = (req, res) => {
  res.json({ success: true, data: wa.getStatus() });
};

exports.getQR = (req, res) => {
  const qr = wa.getQR();
  if (!qr) return res.json({ success: false, message: 'No QR available. Trigger Connect first.' });
  res.json({ success: true, qr });
};

exports.getPhoneInfo = (req, res) => {
  res.json({ success: true, data: wa.getPhoneInfo() });
};

exports.connect = (req, res) => {
  // alwaysFreshQR=true when user explicitly clicks Connect — avoids stuck-session
  const fresh = req.query.fresh === '1' || req.body?.fresh === true;
  wa.initWhatsApp(fresh);
  res.json({ success: true, message: 'WhatsApp initialization started.' });
};

exports.reconnect = async (req, res) => {
  await wa.reconnect();
  res.json({ success: true, message: 'Session cleared. Reconnecting…' });
};

exports.forceReinit = async (req, res) => {
  await wa.forceReinit();
  res.json({ success: true, message: 'Reinitializing without clearing session…' });
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
    if (!mobile || !message) {
      return res.status(400).json({ success: false, message: 'mobile and message are required.' });
    }
    const result = await wa.sendMessage(mobile, message);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
