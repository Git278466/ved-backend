'use strict';

/**
 * MongoDB Backup Script
 * Run: node scripts/backup.js
 * Auto-scheduled: runs daily at 2:00 AM via node-cron (configured in server.js)
 *
 * Saves backups to: backend/backups/YYYY-MM-DD_HH-MM-SS/
 * Keeps last 7 backups (auto-deletes older ones)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { execSync } = require('child_process');
const fs           = require('path');
const fss          = require('fs');
const path         = require('path');

const BACKUP_DIR   = path.join(__dirname, '..', 'backups');
const MAX_BACKUPS  = 7;  // keep last 7 backups
const MONGO_URI    = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ved_foundation';

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function log(msg) {
  console.log(`[BACKUP ${new Date().toISOString()}] ${msg}`);
}

function runBackup() {
  log('Starting MongoDB backup...');

  // Ensure backup directory exists
  if (!fss.existsSync(BACKUP_DIR)) fss.mkdirSync(BACKUP_DIR, { recursive: true });

  const backupPath = path.join(BACKUP_DIR, timestamp());

  try {
    // Check if mongodump is available
    execSync('mongodump --version', { stdio: 'pipe' });
  } catch (_) {
    // mongodump not found — do JSON export using mongoose instead
    log('mongodump not found — using JSON export fallback...');
    return jsonFallbackBackup(backupPath);
  }

  try {
    const cmd = `mongodump --uri="${MONGO_URI}" --out="${backupPath}"`;
    execSync(cmd, { stdio: 'pipe' });
    log(`✅ Backup saved: ${backupPath}`);
    cleanOldBackups();
    return { success: true, path: backupPath };
  } catch (err) {
    log(`❌ Backup failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// JSON fallback — exports each collection as a JSON file
async function jsonFallbackBackup(backupPath) {
  try {
    const mongoose = require('mongoose');
    await mongoose.connect(MONGO_URI);

    fss.mkdirSync(backupPath, { recursive: true });

    const collections = await mongoose.connection.db.listCollections().toArray();
    let count = 0;

    for (const col of collections) {
      const data = await mongoose.connection.db.collection(col.name).find({}).toArray();
      const file = path.join(backupPath, col.name + '.json');
      fss.writeFileSync(file, JSON.stringify(data, null, 2));
      log(`  Exported ${col.name}: ${data.length} documents`);
      count += data.length;
    }

    await mongoose.connection.close();
    log(`✅ JSON Backup complete: ${collections.length} collections, ${count} total documents → ${backupPath}`);
    cleanOldBackups();
    return { success: true, path: backupPath };

  } catch (err) {
    log(`❌ JSON Backup failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Delete oldest backups, keep only MAX_BACKUPS
function cleanOldBackups() {
  try {
    const entries = fss.readdirSync(BACKUP_DIR)
      .map(name => ({
        name,
        path: path.join(BACKUP_DIR, name),
        time: fss.statSync(path.join(BACKUP_DIR, name)).mtimeMs,
      }))
      .filter(e => fss.statSync(e.path).isDirectory())
      .sort((a, b) => b.time - a.time);  // newest first

    // Delete anything beyond MAX_BACKUPS
    entries.slice(MAX_BACKUPS).forEach(entry => {
      fss.rmSync(entry.path, { recursive: true, force: true });
      log(`Deleted old backup: ${entry.name}`);
    });

    log(`Backup cleanup done. Keeping ${Math.min(entries.length, MAX_BACKUPS)} backups.`);
  } catch (err) {
    log(`Cleanup error: ${err.message}`);
  }
}

// Run directly: node scripts/backup.js
if (require.main === module) {
  runBackup().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { runBackup };
