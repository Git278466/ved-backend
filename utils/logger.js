'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LEVELS = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };
const COLORS = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', http: '\x1b[35m', debug: '\x1b[37m', reset: '\x1b[0m' };

function timestamp() {
  return new Date().toISOString();
}

function formatLine(level, message, meta) {
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  return `[${timestamp()}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

function writeToFile(filename, line) {
  const filePath = path.join(LOG_DIR, filename);
  fs.appendFile(filePath, line + '\n', err => {
    if (err) console.error('Logger write error:', err.message);
  });
}

function log(level, message, meta) {
  const line = formatLine(level, message, meta);

  // Console output with color
  const color = COLORS[level] || COLORS.reset;
  console.log(`${color}${line}${COLORS.reset}`);

  // Always write to combined.log
  writeToFile('combined.log', line);

  // Error & warn also go to error.log
  if (LEVELS[level] <= LEVELS.warn) {
    writeToFile('error.log', line);
  }
}

// Delete log files older than 7 days
function cleanOldLogs() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    fs.readdirSync(LOG_DIR).forEach(file => {
      const fp = path.join(LOG_DIR, file);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(fp);
    });
  } catch (_) {}
}

// Run cleanup once on startup
cleanOldLogs();

const logger = {
  error: (msg, meta) => log('error', msg, meta),
  warn:  (msg, meta) => log('warn',  msg, meta),
  info:  (msg, meta) => log('info',  msg, meta),
  http:  (msg, meta) => log('http',  msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
};

module.exports = logger;
