'use strict';

const nodemailer = require('nodemailer');

let _transporter = null;

/* ── Build transporter from env ──────────────────────────────────── */
function getTransporter() {
  if (_transporter) return _transporter;

  const cfg = {
    host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
    port:   Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };

  if (!cfg.auth.user || !cfg.auth.pass) {
    throw new Error('SMTP_USER and SMTP_PASS must be set in .env');
  }

  _transporter = nodemailer.createTransport(cfg);
  return _transporter;
}

/* ── Verify connection ───────────────────────────────────────────── */
async function verifyConnection() {
  try {
    const t = getTransporter();
    await t.verify();
    return { ok: true, message: 'SMTP connection successful' };
  } catch (err) {
    _transporter = null;
    return { ok: false, message: err.message };
  }
}

/* ── Send single email ───────────────────────────────────────────── */
async function sendEmail({ to, subject, html, text, attachments = [] }) {
  const t = getTransporter();
  const from = process.env.SMTP_FROM_NAME
    ? `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_USER}>`
    : process.env.SMTP_USER;

  const info = await t.sendMail({ from, to, subject, html, text, attachments });
  return { success: true, messageId: info.messageId };
}

/* ── Replace {{variables}} in template ──────────────────────────── */
function renderTemplate(template, vars = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '');
}

/* ── Reset transporter (after env change) ───────────────────────── */
function resetTransporter() {
  _transporter = null;
}

module.exports = { verifyConnection, sendEmail, renderTemplate, resetTransporter };
