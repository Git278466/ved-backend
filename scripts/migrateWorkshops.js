'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Workshop = require('../models/Workshop');

const TO_DELETE = ['CSR/ED1006', 'CSR/DT1007'];

const TO_ADD = [
  {
    name: 'CyberSafe India Workshop',
    shortName: 'CyberSafe',
    code: 'CSR/QS1001',
    icon: '🛡️',
    color: '#7c3aed',
    category: 'cybersecurity',
    description: 'Learn to protect yourself and your organisation from cyber threats, phishing, and online fraud.',
    highlights: ['Ethical Hacking basics', 'Phishing awareness', 'Data Privacy laws', 'Cyber crime reporting'],
    displayOrder: 1,
  },
  {
    name: 'LinkedIn Leverage Workshop',
    shortName: 'LinkedIn',
    code: 'CSR/CS1002',
    icon: '💼',
    color: '#0b63ce',
    category: 'professional',
    description: 'Build a powerful LinkedIn profile, grow your network and attract career opportunities.',
    highlights: ['Profile optimization', 'Content strategy', 'Job search tactics', 'Personal branding'],
    displayOrder: 2,
  },
];

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  // Delete unwanted workshops
  const del = await Workshop.deleteMany({ code: { $in: TO_DELETE } });
  console.log(`Deleted ${del.deletedCount} workshop(s): ${TO_DELETE.join(', ')}`);

  // Add missing workshops
  let added = 0;
  for (const w of TO_ADD) {
    const exists = await Workshop.findOne({ code: w.code });
    if (exists) {
      console.log(`Already exists — skipping: ${w.name}`);
    } else {
      await Workshop.create(w);
      added++;
      console.log(`Added: ${w.name}`);
    }
  }

  console.log(`\nDone. Deleted ${del.deletedCount}, added ${added} workshop(s).`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
