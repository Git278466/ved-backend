'use strict';

/**
 * Fix all role permissions to the correct set.
 * Run: node scripts/fixRoles.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose   = require('mongoose');
const Role       = require('../models/Role');
const PERMISSIONS = require('../config/permissions');

const ROLE_DEFINITIONS = [
  {
    name: 'Super Admin',
    description: 'Full system control — unrestricted access to all modules',
    permissions: PERMISSIONS,   // every permission in the master list
    icon: 'fa-shield-halved',
    color: '#2563EB',
    isSystem: true,
    status: 'active',
  },
  {
    name: 'Admin',
    description: 'Manage daily operations — students, attendance, certificates, donations',
    permissions: [
      'dashboard.view',
      // Students
      'students.view', 'students.create', 'students.update', 'students.delete',
      'students.approve', 'students.export',
      // Attendance
      'attendance.view', 'attendance.create', 'attendance.update', 'attendance.delete',
      'attendance.export',
      // Certificates
      'certificates.view', 'certificates.create', 'certificates.issue',
      'certificates.delete', 'certificates.export',
      // Institutions
      'institutions.view', 'institutions.create', 'institutions.update', 'institutions.delete',
      'institutions.export',
      // Associate Partners
      'associate_partners.view', 'associate_partners.create',
      'associate_partners.update', 'associate_partners.delete',
      // Leads / CRM
      'leads.view', 'leads.create', 'leads.update', 'leads.delete', 'leads.export',
      // Reports
      'reports.view', 'reports.export',
      // Donations
      'donations.view', 'donations.create', 'donations.update', 'donations.delete',
      'donations.export',
      // Settings
      'settings.view', 'settings.update',
      // Website content
      'website_content.view', 'website_content.create', 'website_content.update',
      'website_content.delete',
      // Filter presets
      'filter_presets.view', 'filter_presets.create', 'filter_presets.update',
      'filter_presets.delete',
      // Read-only role/admin view
      'roles.view',
      'admin_management.view',
    ],
    icon: 'fa-user-gear',
    color: '#F97316',
    isSystem: false,
    status: 'active',
  },
  {
    name: 'Associate Partner',
    description: 'Partner access — refer students, view institutions & track performance',
    permissions: [
      'dashboard.view',
      // Students — view & add (they refer students)
      'students.view', 'students.create',
      // Attendance — view only
      'attendance.view',
      // Certificates — view only
      'certificates.view',
      // Institutions — view (so they can see partner institutions)
      'institutions.view',
      // Own partner records
      'associate_partners.view', 'associate_partners.create',
      // Leads / CRM — they refer leads
      'leads.view', 'leads.create', 'leads.update',
      // Reports — view only
      'reports.view',
      // Donations — view only
      'donations.view',
      // Filter presets
      'filter_presets.view', 'filter_presets.create',
    ],
    icon: 'fa-handshake',
    color: '#7C3AED',
    isSystem: false,
    status: 'active',
  },
  {
    name: 'Institution',
    description: 'Institution access — register & manage own students, attendance and leads',
    permissions: [
      'dashboard.view',
      // Students — view, add, edit (for own institution)
      'students.view', 'students.create', 'students.update',
      // Attendance — view, add, edit
      'attendance.view', 'attendance.create', 'attendance.update',
      // Certificates — view only
      'certificates.view',
      // Institutions — view own
      'institutions.view',
      // Leads / CRM — they refer students
      'leads.view', 'leads.create', 'leads.update',
      // Reports — view only
      'reports.view',
      // Filter presets
      'filter_presets.view', 'filter_presets.create',
    ],
    icon: 'fa-building-columns',
    color: '#0891B2',
    isSystem: false,
    status: 'active',
  },
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('📦  Connected to MongoDB\n');

    for (const def of ROLE_DEFINITIONS) {
      // Keep only valid permissions from the master list
      const validPerms = def.permissions.filter(p => PERMISSIONS.includes(p));
      const dropped    = def.permissions.filter(p => !PERMISSIONS.includes(p));
      if (dropped.length) console.warn(`  ⚠️  Dropped unknown perms for "${def.name}":`, dropped);

      const existing = await Role.findOne({ name: def.name });
      if (existing) {
        existing.permissions = validPerms;
        existing.description = def.description;
        existing.icon        = def.icon;
        existing.color       = def.color;
        existing.status      = def.status;
        await existing.save();
        console.log(`✅  "${def.name}" updated → ${validPerms.length} permissions`);
      } else {
        await Role.create({
          name:        def.name,
          description: def.description,
          permissions: validPerms,
          icon:        def.icon,
          color:       def.color,
          isSystem:    def.isSystem || false,
          status:      def.status,
        });
        console.log(`✅  "${def.name}" created → ${validPerms.length} permissions`);
      }
    }

    console.log('\n🎉  All roles fixed successfully!');
  } catch (err) {
    console.error('❌  Error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
