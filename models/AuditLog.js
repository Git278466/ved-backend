'use strict';

const mongoose = require('mongoose');

/**
 * AuditLog — immutable record of every significant admin action.
 * Never updated or deleted — append-only.
 *
 * Captures: who, what action, on which resource, from where, and outcome.
 */
const auditLogSchema = new mongoose.Schema(
  {
    // ── Who ─────────────────────────────────────────────────────
    actor: {
      adminId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
      adminName: { type: String },          // snapshot — admin may be deleted later
      adminEmail:{ type: String },
      roleName:  { type: String },
      ip:        { type: String },
      userAgent: { type: String },
    },

    // ── What ────────────────────────────────────────────────────
    action: {
      type: String,
      required: true,
      enum: [
        // Auth
        'login', 'logout', 'login_failed', 'password_changed',
        // Students
        'student.create', 'student.update', 'student.delete',
        'student.approve', 'student.reject', 'student.bulk_approve', 'student.bulk_reject',
        // Leads
        'lead.create', 'lead.update', 'lead.delete', 'lead.convert', 'lead.bulk_assign',
        // Admins
        'admin.create', 'admin.update', 'admin.delete', 'admin.status_change',
        // Roles
        'role.create', 'role.update', 'role.delete',
        // Certificates
        'certificate.issue', 'certificate.revoke', 'certificate.delete',
        // Donations
        'donation.create', 'donation.update', 'donation.delete',
        // Institutions
        'institution.create', 'institution.update', 'institution.delete',
        // Partners
        'partner.create', 'partner.update', 'partner.delete',
        // Attendance
        'attendance.mark', 'attendance.bulk_mark', 'attendance.delete',
        // Exports
        'export.students', 'export.leads', 'export.reports',
        // Settings
        'settings.update',
        // Generic
        'other',
      ],
    },

    // ── On which resource ────────────────────────────────────────
    resource: {
      type:   { type: String },             // 'Student', 'Lead', 'Admin', etc.
      id:     { type: String },             // resource _id as string
      before: { type: mongoose.Schema.Types.Mixed }, // snapshot before change
      after:  { type: mongoose.Schema.Types.Mixed }, // snapshot after change
    },

    // ── Outcome ──────────────────────────────────────────────────
    status:  { type: String, enum: ['success', 'failure'], default: 'success' },
    message: { type: String },              // error message on failure

    // ── Request metadata ─────────────────────────────────────────
    method:  { type: String },              // GET, POST, PUT, DELETE
    path:    { type: String },              // /api/students/123
  },
  {
    timestamps: true,
    // Make immutable at DB level — no updates allowed
    // (enforced in middleware, not schema itself)
  }
);

// ── Indexes ───────────────────────────────────────────────────────
auditLogSchema.index({ 'actor.adminId': 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ 'resource.type': 1, 'resource.id': 1 });
auditLogSchema.index({ createdAt: -1 });                    // recent activity
auditLogSchema.index({ status: 1, createdAt: -1 });         // failure monitoring

// ── TTL: auto-delete logs older than 2 years ──────────────────────
// Remove this line if you want to keep logs forever.
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 63072000 }); // 730 days

module.exports = mongoose.model('AuditLog', auditLogSchema);
