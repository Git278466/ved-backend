'use strict';

/**
 * Field-level AES-256-GCM encryption for sensitive PII.
 *
 * Usage:
 *   const { encrypt, decrypt, hashForSearch } = require('./encryption');
 *
 *   // Before storing
 *   doc.mobile = encrypt(rawMobile);
 *
 *   // After reading
 *   const plainMobile = decrypt(doc.mobile);
 *
 *   // For searchable lookup (one-way hash — consistent across calls)
 *   doc.mobileHash = hashForSearch(rawMobile);
 *   await Model.findOne({ mobileHash });
 *
 * Requires env:
 *   FIELD_ENCRYPT_KEY  — 64 hex chars (32-byte key)
 *   NODE_ENV
 */

const crypto = require('crypto');

const ALGO       = 'aes-256-gcm';
const IV_LENGTH  = 16;   // bytes
const TAG_LENGTH = 16;   // bytes
const PREFIX     = 'enc:'; // marks encrypted strings

// ── Key derivation ────────────────────────────────────────────────
function _getKey() {
  const hexKey = process.env.FIELD_ENCRYPT_KEY;
  if (!hexKey || hexKey.length !== 64) {
    // In development, use a derived key from JWT secret so setup is zero-friction.
    // In production FIELD_ENCRYPT_KEY must be set.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FIELD_ENCRYPT_KEY must be set in production (64 hex chars = 32 bytes).');
    }
    const fallback = process.env.JWT_SECRET || 'ved_secret_key_default_change_me';
    return crypto.createHash('sha256').update(fallback).digest();
  }
  return Buffer.from(hexKey, 'hex');
}

/**
 * encrypt(plainText) → "enc:<iv_hex>:<tag_hex>:<ciphertext_hex>"
 * Returns original value untouched if null/undefined/already encrypted.
 */
function encrypt(plainText) {
  if (plainText == null || plainText === '') return plainText;
  if (typeof plainText !== 'string') plainText = String(plainText);
  if (plainText.startsWith(PREFIX)) return plainText; // already encrypted

  try {
    const key = _getKey();
    const iv  = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGO, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (err) {
    console.error('[Encryption] encrypt failed:', err.message);
    return plainText; // fail-open so data is not lost
  }
}

/**
 * decrypt(cipherText) → plain string
 * Returns original value if not encrypted.
 */
function decrypt(cipherText) {
  if (cipherText == null || cipherText === '') return cipherText;
  if (typeof cipherText !== 'string') return cipherText;
  if (!cipherText.startsWith(PREFIX)) return cipherText; // plain text

  try {
    const parts = cipherText.slice(PREFIX.length).split(':');
    if (parts.length !== 3) return cipherText;

    const [ivHex, tagHex, dataHex] = parts;
    const key = _getKey();
    const iv  = Buffer.from(ivHex,  'hex');
    const tag = Buffer.from(tagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);

    return decipher.update(Buffer.from(dataHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
  } catch (err) {
    console.error('[Encryption] decrypt failed:', err.message);
    return cipherText; // return as-is if decryption fails
  }
}

/**
 * hashForSearch(value) → consistent hex string for indexed lookup.
 * One-way — cannot be reversed. Use alongside encrypted field for lookup.
 */
function hashForSearch(value) {
  if (value == null || value === '') return '';
  const secret = process.env.FIELD_ENCRYPT_KEY || process.env.JWT_SECRET || 'ved_hash_secret';
  return crypto.createHmac('sha256', secret).update(String(value).toLowerCase().trim()).digest('hex');
}

/**
 * isEncrypted(value) — check if a field value is already encrypted.
 */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, hashForSearch, isEncrypted };
