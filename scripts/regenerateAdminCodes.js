'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose    = require('mongoose');
require('../models/Role');        // register schema before populate
const Admin       = require('../models/Admin');
const generateCode = require('../utils/generateCode');
const { namePrefix } = generateCode;

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected\n');

  // Get all non-super-admin admins (those with a code)
  const admins = await Admin.find({ code: { $exists: true, $ne: null } })
    .populate('role', 'name isSystem')
    .lean();

  let updated = 0;
  for (const admin of admins) {
    // Skip Super Admin (system role, no code needed)
    if (admin.role?.isSystem) continue;

    const oldCode = admin.code || '';
    const prefix  = namePrefix(admin.firstName || admin.email || 'ADMIN');

    // Only regenerate if prefix length < 5 (old 4-letter codes like FIRO-5558)
    const existingPrefix = oldCode.split('-')[0] || '';
    if (existingPrefix.length >= 5) {
      console.log(`  SKIP  ${oldCode.padEnd(12)} — already 5-letter prefix`);
      continue;
    }

    const newCode = await generateCode(Admin, prefix);
    await Admin.updateOne({ _id: admin._id }, { code: newCode });
    console.log(`  ✅  ${oldCode.padEnd(12)} → ${newCode}  (${admin.firstName} ${admin.lastName || ''})`);
    updated++;
  }

  console.log(`\nDone. ${updated} code(s) regenerated.`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
