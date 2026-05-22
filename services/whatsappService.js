'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path   = require('path');
const fs     = require('fs');

let _client      = null;
let _qrDataUrl   = null;
let _status      = 'disconnected';
let _statusMsg   = 'Not connected';
let _phoneInfo   = null;
let _watchdog    = null;   // general init watchdog
let _stuckTimer  = null;   // fires if loading_screen 100% but no QR/auth

const AUTH_PATH  = path.join(__dirname, '..', '.wwebjs_auth');
const CACHE_PATH = path.join(__dirname, '..', '.wwebjs_cache');

/* ── Find Chrome / Chromium (Windows + Linux VPS) ───────────── */
function findBrowser() {
  const candidates = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // Linux VPS (Ubuntu/Debian/CentOS)
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log('[WA] Browser:', p);
      return p;
    }
  }
  console.warn('[WA] No browser found — WhatsApp will be unavailable');
  return null;
}

/* ── Clear session files ────────────────────────────────────── */
function clearSession() {
  _clearTimers();
  try {
    if (fs.existsSync(AUTH_PATH))  fs.rmSync(AUTH_PATH,  { recursive: true, force: true });
    if (fs.existsSync(CACHE_PATH)) fs.rmSync(CACHE_PATH, { recursive: true, force: true });
    console.log('[WA] Session cleared');
  } catch (e) {
    console.error('[WA] Clear error:', e.message);
  }
}

/* ── Is session old? (> 12 hours = likely expired) ─────────── */
function _isSessionStale() {
  const sessionDir = path.join(AUTH_PATH, 'session');
  if (!fs.existsSync(sessionDir)) return false;
  try {
    const stat = fs.statSync(sessionDir);
    const ageHours = (Date.now() - stat.mtimeMs) / 3600000;
    return ageHours > 12;
  } catch { return false; }
}

function _clearTimers() {
  if (_watchdog)   { clearTimeout(_watchdog);   _watchdog   = null; }
  if (_stuckTimer) { clearTimeout(_stuckTimer); _stuckTimer = null; }
}

function _set(s, msg) {
  _status = s; _statusMsg = msg;
  console.log(`[WA] ${s}: ${msg}`);
}

/* ── Puppeteer args ─────────────────────────────────────────── */
const PARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--no-first-run', '--no-zygote',
  '--disable-extensions', '--disable-background-networking',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-default-apps', '--disable-sync', '--disable-translate',
  '--disable-features=TranslateUI,BlinkGenPropertyTrees,site-per-process',
  '--disable-site-isolation-trials',
  '--disable-blink-features=AutomationControlled',
  '--window-size=1280,800', '--ignore-certificate-errors',
  '--allow-running-insecure-content',
  '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

/* ── Main init ──────────────────────────────────────────────── */
function initWhatsApp(alwaysFreshQR = false) {
  if (_client && !['failed','disconnected'].includes(_status)) {
    console.log('[WA] Already running — skip');
    return;
  }

  // Destroy stale client
  if (_client) {
    try { _client.destroy().catch(() => {}); } catch (_) {}
    _client = null;
  }
  _clearTimers();

  // If session is stale OR caller wants fresh QR, wipe it first
  if (alwaysFreshQR || _isSessionStale()) {
    console.log('[WA] Stale/forced — clearing session before connect');
    clearSession();
  }

  _set('initializing', 'Opening Chrome… (10–20 sec)');
  _qrDataUrl = null;
  _phoneInfo = null;

  const execPath = findBrowser();

  _client = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
    restartOnAuthFail: true,          // auto-retry if session auth fails
    puppeteer: {
      headless:     true,
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
      args:            PARGS,
      defaultViewport: null,
      timeout:         30000,
      ...(execPath ? { executablePath: execPath } : {}),
    },
  });

  /* ── 90-sec global watchdog ──────────────────────────────── */
  _watchdog = setTimeout(() => {
    if (['initializing','connecting','qr_waiting'].includes(_status)) {
      console.error('[WA] Global timeout — killing');
      _set('failed', 'Timeout. Click "Clear & Reconnect".');
      _destroyClient();
    }
  }, 90_000);

  /* ─── EVENTS ─────────────────────────────────────────────── */

  _client.on('loading_screen', (pct) => {
    _set('connecting', `Loading WhatsApp Web… ${pct}%`);

    // When it hits 100% but no QR/auth in 25 sec → old session stuck → auto-clear & reinit
    if (Number(pct) >= 100) {
      if (_stuckTimer) clearTimeout(_stuckTimer);
      _stuckTimer = setTimeout(() => {
        if (_status === 'connecting') {
          console.warn('[WA] Stuck at 100% — clearing stale session, getting fresh QR');
          _destroyClient();
          clearSession();
          setTimeout(() => initWhatsApp(true), 1500);
        }
      }, 25_000);
    }
  });

  _client.on('qr', async (qr) => {
    // QR appeared — cancel stuck timer, reset watchdog to 60s for scanning
    if (_stuckTimer) { clearTimeout(_stuckTimer); _stuckTimer = null; }
    if (_watchdog)   { clearTimeout(_watchdog);   _watchdog   = null; }

    _set('qr_waiting', 'Scan this QR with WhatsApp now');
    console.log('[WA] QR ready to scan');

    try { _qrDataUrl = await qrcode.toDataURL(qr, { scale: 6 }); }
    catch (e) { console.error('[WA] QR error:', e.message); }

    // QR expires in 30 sec — set a new one automatically (wwebjs fires qr event again)
    _watchdog = setTimeout(() => {
      if (_status === 'qr_waiting') {
        _set('qr_waiting', 'QR expired — new QR loading…');
        _qrDataUrl = null;
      }
    }, 30_000);
  });

  _client.on('authenticated', () => {
    if (_stuckTimer) { clearTimeout(_stuckTimer); _stuckTimer = null; }
    if (_watchdog)   { clearTimeout(_watchdog);   _watchdog   = null; }
    _set('connecting', 'Authenticated — finalising…');
    _qrDataUrl = null;
  });

  _client.on('ready', async () => {
    _clearTimers();
    _qrDataUrl = null;
    try {
      const info = _client?.info;
      _phoneInfo = { name: info?.pushname || '', number: info?.wid?.user || '' };
      _set('ready', `Connected ✅  ${_phoneInfo.name || _phoneInfo.number}`);
    } catch (_) { _set('ready', 'Connected ✅'); }
    console.log('[WA] Ready', _phoneInfo);
  });

  _client.on('auth_failure', (msg) => {
    // Session expired → auto-clear and reinit with fresh QR
    console.warn('[WA] Auth failure:', msg, '— auto-clearing and getting fresh QR');
    _clearTimers();
    _destroyClient();
    clearSession();
    _set('initializing', 'Session expired — getting fresh QR…');
    setTimeout(() => initWhatsApp(true), 2000);
  });

  _client.on('disconnected', (reason) => {
    _clearTimers();
    _set('disconnected', `Disconnected (${reason})`);
    _client = null; _qrDataUrl = null; _phoneInfo = null;
  });

  _client.initialize().catch(err => {
    _clearTimers();
    const msg = err?.message || '';
    console.error('[WA] Init error:', msg);

    const isCrash = msg.includes('frame was detached') || msg.includes('Target closed') ||
                    msg.includes('Session closed')      || msg.includes('Navigation failed') ||
                    msg.includes('net::ERR')            || msg.includes('Protocol error');
    if (isCrash) {
      clearSession();
      _set('failed', 'Browser crashed. Click "Clear & Reconnect".');
    } else {
      _set('failed', (msg || 'Init failed').substring(0, 120));
    }
    _client = null;
  });
}

/* ── Destroy client safely ──────────────────────────────────── */
function _destroyClient() {
  if (_client) {
    try { _client.destroy().catch(() => {}); } catch (_) {}
    _client = null;
  }
}

/* ── Public API ─────────────────────────────────────────────── */
function getStatus()    { return { status: _status, message: _statusMsg, hasQr: !!_qrDataUrl, phone: _phoneInfo }; }
function getQR()        { return _qrDataUrl; }
function isReady()      { return _status === 'ready' && !!_client; }
function getPhoneInfo() { return _phoneInfo; }

async function sendMessage(to, text) {
  if (!isReady()) throw new Error('WhatsApp not connected. Please scan QR first.');
  let num = String(to).replace(/\D/g, '');
  if (num.length === 10) num = '91' + num;
  if (num.length < 10)   throw new Error(`Invalid number: ${to}`);
  const sent = await _client.sendMessage(num + '@c.us', text);
  return { success: true, messageId: sent?.id?.id };
}

async function disconnect() {
  _clearTimers();
  _destroyClient();
  _status = 'disconnected'; _statusMsg = 'Disconnected';
  _qrDataUrl = null; _phoneInfo = null;
}

async function reconnect() {
  await disconnect();
  clearSession();
  await new Promise(r => setTimeout(r, 1500));
  initWhatsApp(true);
}

async function forceReinit() {
  await disconnect();
  await new Promise(r => setTimeout(r, 1000));
  initWhatsApp(false);
}

module.exports = {
  initWhatsApp, forceReinit,
  getStatus, getQR, isReady, getPhoneInfo,
  sendMessage, disconnect, reconnect, clearSession,
};
