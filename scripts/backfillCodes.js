'use strict';

/**
 * Migration: assign codes using role-name first 4 letters as prefix.
 * Format: ADMI-001 (Admin), ASSO-001 (Associate Partner), INST-001 (Institution admin)
 *
 * Run: node scripts/backfillCodes.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose     = require('mongoose');
const generateCode = require('../utils/generateCode');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('📦  Connected to MongoDB\n');

    const Admin       = require('../models/Admin');
    const Role        = require('../models/Role');
    const Institution = require('../models/Institution');
    const Partner     = require('../models/Partner');

    // ── Super Admin: no code ──────────────────────────────────────
    const saRole = await Role.findOne({ name: 'Super Admin', isSystem: true }).lean();
    if (saRole) {
      const r = await Admin.updateMany({ role: saRole._id }, { $unset: { code: '' } });
      if (r.modifiedCount) console.log(`✅  Removed code from ${r.modifiedCount} Super Admin(s)`);
    }

    // ── Admin users: prefix = first 5 letters of role name ────────
    const roles = await Role.find({ isSystem: { $ne: true } }).lean();
    const prefixMap = {};
    roles.forEach(r => {
      prefixMap[r._id.toString()] = r.name.replace(/[^A-Za-z]/g,'').substring(0,5).toUpperCase() || 'ADMIN';
    });

    const admins = await Admin.find(
      saRole ? { role: { $ne: saRole._id } } : {}
    ).populate('role', 'name isSystem');

    for (const admin of admins) {
      if (admin.role?.isSystem) continue;
      const prefix = prefixMap[admin.role?._id?.toString()] || 'ADMIN';
      const expectedPattern = new RegExp('^' + prefix + '-\\d+$');
      if (!admin.code || !expectedPattern.test(admin.code)) {
        if (admin.code) await Admin.updateOne({ _id: admin._id }, { $unset: { code: '' } });
        const code = await generateCode(Admin, prefix);
        await Admin.updateOne({ _id: admin._id }, { code });
        console.log(`✅  ${admin.firstName || admin.email} [${admin.role?.name}] → ${code}`);
      } else {
        console.log(`✓   ${admin.firstName || admin.email} [${admin.role?.name}] → ${admin.code} (already correct)`);
      }
    }

    // ── Institution records: INST-XXX ────────────────────────────
    const insts = await Institution.find({ $or: [{ code: null }, { code: { $exists: false } }] });
    for (const doc of insts) {
      doc.code = await generateCode(Institution, 'INST');
      await doc.save();
      console.log(`✅  Institution "${doc.name}" → ${doc.code}`);
    }

    // ── Partner records: first 5 letters of org name ─────────────
    const { namePrefix } = generateCode;
    const partners = await Partner.find({});
    for (const doc of partners) {
      const existingPrefix = (doc.code || '').split('-')[0] || '';
      if (!doc.code || existingPrefix.length < 5) {
        const prefix = namePrefix(doc.organizationName || 'PARTN');
        doc.code = await generateCode(Partner, prefix);
        await doc.save();
        console.log(`✅  Partner "${doc.organizationName}" → ${doc.code}`);
      } else {
        console.log(`✓   Partner "${doc.organizationName}" → ${doc.code} (already correct)`);
      }
    }

    console.log('\n🎉  Backfill complete!');
  } catch (err) {
    console.error('❌  Error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
