'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path   = require('path');
const fs     = require('fs');

let _client    = null;
let _qrDataUrl = null;
let _status    = 'disconnected';
let _statusMsg = 'Not connected';

const AUTH_PATH  = path.join(__dirname, '..', '.wwebjs_auth');
const CACHE_PATH = path.join(__dirname, '..', '.wwebjs_cache');

/* ── Find system Chrome / Edge ─────────────────────────────────── */
function findBrowser() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log('[WhatsApp] Using browser:', p);
      return p;
    }
  }
  console.warn('[WhatsApp] No system browser found — using bundled Chromium');
  return null;
}

/* ── Clear corrupted session ───────────────────────────────────── */
function clearSession() {
  try {
    if (fs.existsSync(AUTH_PATH))  fs.rmSync(AUTH_PATH,  { recursive: true, force: true });
    if (fs.existsSync(CACHE_PATH)) fs.rmSync(CACHE_PATH, { recursive: true, force: true });
    console.log('[WhatsApp] Session cleared.');
  } catch (e) {
    console.error('[WhatsApp] Could not clear session:', e.message);
  }
}

/* ── Puppeteer args ─────────────────────────────────────────────── */
const PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu',
  '--disable-features=site-per-process',
  '--disable-site-isolation-trials',
  '--disable-blink-features=AutomationControlled',
  '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

/* ── Init ───────────────────────────────────────────────────────── */
function initWhatsApp() {
  if (_client) return;

  _status    = 'initializing';
  _statusMsg = 'Starting…';

  const executablePath = findBrowser();

  const puppeteerConfig = {
    headless:        true,
    handleSIGINT:    false,
    handleSIGTERM:   false,
    args:            PUPPETEER_ARGS,
    defaultViewport: null,
  };
  if (executablePath) puppeteerConfig.executablePath = executablePath;

  _client = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
    puppeteer: puppeteerConfig,
  });

  _client.on('qr', async (qr) => {
    _status    = 'qr_waiting';
    _statusMsg = 'Scan QR with WhatsApp';
    console.log('[WhatsApp] QR ready — waiting for scan');
    try { _qrDataUrl = await qrcode.toDataURL(qr); }
    catch (_) { _qrDataUrl = null; }
  });

  _client.on('loading_screen', (pct) => {
    _status    = 'connecting';
    _statusMsg = `Loading ${pct}%…`;
  });

  _client.on('authenticated', () => {
    _status    = 'connecting';
    _statusMsg = 'Authenticated — loading chats…';
    _qrDataUrl = null;
  });

  _client.on('ready', () => {
    _status    = 'ready';
    _statusMsg = 'Connected ✅';
    _qrDataUrl = null;
    console.log('[WhatsApp] Ready');
  });

  _client.on('auth_failure', () => {
    _status    = 'failed';
    _statusMsg = 'Auth failed — clear session and try again';
    _client    = null;
    clearSession();
  });

  _client.on('disconnected', (reason) => {
    _status    = 'disconnected';
    _statusMsg = `Disconnected (${reason})`;
    _client    = null;
  });

  // Catch init errors — auto-clear session on frame-detach errors
  _client.initialize().catch(err => {
    const msg = err?.message || '';
    console.error('[WhatsApp] Init error:', msg);
    _client = null;

    if (msg.includes('frame was detached') ||
        msg.includes('Target closed')       ||
        msg.includes('Session closed')      ||
        msg.includes('Navigation failed')) {
      clearSession();
      _status    = 'failed';
      _statusMsg = 'Session cleared. Click Connect to try again.';
    } else {
      _status    = 'failed';
      _statusMsg = msg || 'Initialization failed';
    }
  });
}

/* ── Helpers ────────────────────────────────────────────────────── */
function getStatus() {
  return { status: _status, message: _statusMsg, hasQr: !!_qrDataUrl };
}
function getQR()    { return _qrDataUrl; }
function isReady()  { return _status === 'ready' && !!_client; }

/* ── Send message ───────────────────────────────────────────────── */
async function sendMessage(to, text) {
  if (!isReady()) throw new Error('WhatsApp not connected. Please scan QR first.');
  let num = String(to).replace(/\D/g, '');
  if (num.length === 10) num = '91' + num;
  await _client.sendMessage(num + '@c.us', text);
  return { success: true };
}

/* ── Disconnect ─────────────────────────────────────────────────── */
async function disconnect() {
  if (_client) {
    try { await _client.destroy(); } catch (_) {}
    _client = null;
  }
  _status    = 'disconnected';
  _statusMsg = 'Disconnected';
  _qrDataUrl = null;
}

/* ── Reconnect (clears session for clean restart) ───────────────── */
async function reconnect() {
  await disconnect();
  clearSession();
  setTimeout(initWhatsApp, 1500);
}

module.exports = { initWhatsApp, getStatus, getQR, isReady, sendMessage, disconnect, reconnect, clearSession };
