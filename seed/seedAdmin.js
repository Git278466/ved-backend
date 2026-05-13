require('dotenv').config();

const mongoose = require('mongoose');
const Role     = require('../models/Role');
const Admin    = require('../models/Admin');
const PERMISSIONS = require('../config/permissions');

/* ============================================================
   ROLE DEFINITIONS
============================================================ */
const ROLES = [
  {
    name:        'Super Admin',
    description: 'Full system control — unrestricted access to all modules',
    permissions: PERMISSIONS,          // every permission
    isSystem:    true,
    status:      'active',
    icon:        'fa-shield-halved',
    color:       '#2563EB',
  },
  {
    name:        'Admin',
    description: 'Manage daily operations — students, attendance, certificates, donations',
    permissions: [
      'dashboard.view',
      'students.view', 'students.create', 'students.update', 'students.delete',
      'students.approve', 'students.export',
      'attendance.view', 'attendance.create', 'attendance.update', 'attendance.delete',
      'certificates.view', 'certificates.issue', 'certificates.delete',
      'institutions.view', 'institutions.create', 'institutions.update', 'institutions.delete',
      'associate_partners.view', 'associate_partners.create',
      'associate_partners.update', 'associate_partners.delete',
      'reports.view', 'reports.export',
      'donations.view', 'donations.create', 'donations.update', 'donations.delete',
      'settings.view',
      'website_content.view', 'website_content.create', 'website_content.update',
      'filter_presets.view', 'filter_presets.create', 'filter_presets.update', 'filter_presets.delete',
    ],
    isSystem: false,
    status:   'active',
    icon:     'fa-user-gear',
    color:    '#F97316',
  },
  {
    name:        'Associate Partner',
    description: 'Limited data access — view students, attendance and own partner records',
    permissions: [
      'dashboard.view',
      'students.view',
      'attendance.view',
      'certificates.view',
      'associate_partners.view', 'associate_partners.create',
      'reports.view',
      'donations.view',
      'filter_presets.view', 'filter_presets.create',
    ],
    isSystem: false,
    status:   'active',
    icon:     'fa-handshake',
    color:    '#7C3AED',
  },
  {
    name:        'Institution',
    description: 'Data entry access — register students and mark attendance for own institution',
    permissions: [
      'dashboard.view',
      'students.view', 'students.create',
      'attendance.view', 'attendance.create',
      'certificates.view',
      'institutions.view',
      'reports.view',
      'filter_presets.view', 'filter_presets.create',
    ],
    isSystem: false,
    status:   'active',
    icon:     'fa-building-columns',
    color:    '#0891B2',
  },
];

/* ============================================================
   SEED
============================================================ */
async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅  MongoDB Connected');

    /* ── Wipe existing roles & admins ─────────────────────── */
    await Role.deleteMany({});
    await Admin.deleteMany({});
    console.log('🗑   Cleared existing roles and admins');

    /* ── Create all roles ─────────────────────────────────── */
    const created = {};
    for (const roleData of ROLES) {
      const role = await Role.create(roleData);
      created[roleData.name] = role;
      console.log(`✅  Role created: ${roleData.name}`);
    }

    /* ── Create Super Admin user ──────────────────────────── */
    await Admin.create({
      firstName: 'Super',
      lastName:  'Admin',
      email:     'admin@ved.com',
      password:  'Admin@123',
      role:      created['Super Admin']._id,
      status:    'active',
    });

    console.log('\n══════════════════════════════════════');
    console.log('  Seed complete!');
    console.log('  Login → admin@ved.com / Admin@123');
    console.log('══════════════════════════════════════\n');
    console.log('Roles seeded:');
    ROLES.forEach(r => console.log(`  • ${r.name}`));

    process.exit(0);
  } catch (err) {
    console.error('❌  Seed error:', err.message);
    process.exit(1);
  }
}

seed();
