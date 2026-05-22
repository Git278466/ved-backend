'use strict';

/**
 * Generate a unique code like  RISH-7423
 * @param {mongoose.Model} Model   - Mongoose model to check uniqueness against
 * @param {string}         prefix  - First 4 letters of name (e.g. 'RISH', 'YOUT')
 * @param {string}         field   - field name (default 'code')
 */
async function generateCode(Model, prefix, field = 'code') {
  const clean = (prefix || 'XXXX')
    .replace(/[^A-Za-z]/g, '')   // letters only
    .substring(0, 4)
    .toUpperCase()
    .padEnd(4, 'X');              // pad to 4 if name is short

  for (let i = 0; i < 50; i++) {
    // Random 4-digit number: 1000–9999
    const num  = Math.floor(1000 + Math.random() * 9000);
    const code = `${clean}-${num}`;
    const exists = await Model.exists({ [field]: code });
    if (!exists) return code;
  }

  // Fallback: use last 4 digits of timestamp (guaranteed unique enough)
  return `${clean}-${Date.now().toString().slice(-4)}`;
}

/**
 * Get 4-letter prefix from a name string.
 * "Rishav Gupta" → "RISH", "Youth For India" → "YOUT"
 */
function namePrefix(name) {
  return (name || 'UNKN')
    .replace(/[^A-Za-z]/g, '')
    .substring(0, 4)
    .toUpperCase()
    .padEnd(4, 'X');
}

module.exports = generateCode;
module.exports.namePrefix = namePrefix;
