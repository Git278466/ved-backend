'use strict';

/**
 * Master permissions list — matches frontend MODULES × PERM_TYPES matrix.
 * Format: "<module>.<action>"
 * Super Admin bypasses all checks — these apply to every other role.
 *
 * Frontend PERM_TYPES: view | create | update | delete | export | approve
 * Frontend MODULES: dashboard | students | attendance | certificates | reports
 *                   admin_management | roles | institutions | associate_partners
 *                   leads | donations | website_content | settings
 */
const PERMISSIONS = [

  // ── Dashboard ────────────────────────────────────────────────
  'dashboard.view',
  'dashboard.create',
  'dashboard.update',
  'dashboard.delete',
  'dashboard.export',
  'dashboard.approve',

  // ── Students ─────────────────────────────────────────────────
  'students.view',
  'students.create',
  'students.update',
  'students.delete',
  'students.export',
  'students.approve',

  // ── Attendance ───────────────────────────────────────────────
  'attendance.view',
  'attendance.create',
  'attendance.update',
  'attendance.delete',
  'attendance.export',
  'attendance.approve',

  // ── Certificates ─────────────────────────────────────────────
  'certificates.view',
  'certificates.create',
  'certificates.update',
  'certificates.delete',
  'certificates.issue',   // legacy action kept for compatibility
  'certificates.export',
  'certificates.approve',

  // ── Reports / Analytics ──────────────────────────────────────
  'reports.view',
  'reports.create',
  'reports.update',
  'reports.delete',
  'reports.export',
  'reports.approve',

  // ── Admin Management ─────────────────────────────────────────
  'admin_management.view',
  'admin_management.create',
  'admin_management.update',
  'admin_management.delete',
  'admin_management.export',
  'admin_management.approve',

  // ── Roles & Permissions ──────────────────────────────────────
  'roles.view',
  'roles.create',
  'roles.update',
  'roles.delete',
  'roles.export',
  'roles.approve',

  // ── Institutions ─────────────────────────────────────────────
  'institutions.view',
  'institutions.create',
  'institutions.update',
  'institutions.delete',
  'institutions.export',
  'institutions.approve',

  // ── Associate Partners ────────────────────────────────────────
  'associate_partners.view',
  'associate_partners.create',
  'associate_partners.update',
  'associate_partners.delete',
  'associate_partners.export',
  'associate_partners.approve',

  // ── Leads / CRM ──────────────────────────────────────────────
  'leads.view',
  'leads.create',
  'leads.update',
  'leads.delete',
  'leads.export',
  'leads.approve',

  // ── Referrals & Commission ───────────────────────────────────
  'referrals.view',
  'referrals.create',
  'referrals.update',
  'referrals.delete',
  'referrals.export',
  'referrals.approve',

  // ── Online Workshops ─────────────────────────────────────────
  'workshops.view',
  'workshops.create',
  'workshops.update',
  'workshops.delete',
  'workshops.export',
  'workshops.approve',

  // ── Mobilization ─────────────────────────────────────────────
  'mobilization.view',
  'mobilization.create',
  'mobilization.update',
  'mobilization.delete',
  'mobilization.export',
  'mobilization.approve',

  // ── Counselling & Certs ──────────────────────────────────────
  'counselling_cert.view',
  'counselling_cert.create',
  'counselling_cert.update',
  'counselling_cert.delete',
  'counselling_cert.export',
  'counselling_cert.approve',

  // ── Donations ────────────────────────────────────────────────
  'donations.view',
  'donations.create',
  'donations.update',
  'donations.delete',
  'donations.export',
  'donations.approve',

  // ── Website Content ──────────────────────────────────────────
  'website_content.view',
  'website_content.create',
  'website_content.update',
  'website_content.delete',
  'website_content.export',
  'website_content.approve',

  // ── Settings ─────────────────────────────────────────────────
  'settings.view',
  'settings.create',
  'settings.update',
  'settings.delete',
  'settings.export',
  'settings.approve',

  // ── Filter Presets ────────────────────────────────────────────
  'filter_presets.view',
  'filter_presets.create',
  'filter_presets.update',
  'filter_presets.delete',

  // ── CEP Partner Certificates ─────────────────────────────────
  'cep_certificates.view',
  'cep_certificates.create',
  'cep_certificates.update',
  'cep_certificates.delete',
  'cep_certificates.export',
  'cep_certificates.approve',

  // ── Audit Log ────────────────────────────────────────────────
  'audit_log.view',
];

module.exports = PERMISSIONS;
