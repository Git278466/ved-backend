'use strict';

/**
 * Master permissions list.
 * Format: "<module>.<action>"
 * Super Admin bypasses all checks — these apply to every other role.
 */
const PERMISSIONS = [
  // ── Dashboard ───────────────────────────────────────────────
  'dashboard.view',

  // ── Students ────────────────────────────────────────────────
  'students.view',
  'students.create',
  'students.update',
  'students.delete',
  'students.approve',
  'students.export',

  // ── Attendance ──────────────────────────────────────────────
  'attendance.view',
  'attendance.create',
  'attendance.update',
  'attendance.delete',

  // ── Certificates ────────────────────────────────────────────
  'certificates.view',
  'certificates.issue',
  'certificates.delete',

  // ── Roles ───────────────────────────────────────────────────
  'roles.view',
  'roles.create',
  'roles.update',
  'roles.delete',

  // ── Admin management ────────────────────────────────────────
  'admin_management.view',
  'admin_management.create',
  'admin_management.update',
  'admin_management.delete',

  // ── Institutions ────────────────────────────────────────────
  'institutions.view',
  'institutions.create',
  'institutions.update',
  'institutions.delete',

  // ── Associate partners ──────────────────────────────────────
  'associate_partners.view',
  'associate_partners.create',
  'associate_partners.update',
  'associate_partners.delete',

  // ── Leads / CRM ─────────────────────────────────────────────
  'leads.view',
  'leads.create',
  'leads.update',
  'leads.delete',
  'leads.export',

  // ── Reports ─────────────────────────────────────────────────
  'reports.view',
  'reports.export',

  // ── Donations ───────────────────────────────────────────────
  'donations.view',
  'donations.create',
  'donations.update',
  'donations.delete',

  // ── Settings ────────────────────────────────────────────────
  'settings.view',
  'settings.update',

  // ── Website content ─────────────────────────────────────────
  'website_content.view',
  'website_content.create',
  'website_content.update',

  // ── Filter presets ───────────────────────────────────────────
  'filter_presets.view',
  'filter_presets.create',
  'filter_presets.update',
  'filter_presets.delete',

  // ── Audit log (read-only access) ─────────────────────────────
  'audit_log.view',
];

module.exports = PERMISSIONS;
