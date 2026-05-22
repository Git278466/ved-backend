'use strict';

/**
 * isSuperAdmin(role)
 * Returns true when the role object is the Super Admin system role.
 */
const checkSuperAdmin = (role) =>
  role && role.isSystem === true && role.name === 'Super Admin';

/**
 * hasPermission(permission)
 * ─────────────────────────
 * Middleware factory. Checks whether req.admin.role includes the permission.
 * Super Admin always passes. Admins with no role get a clear 403.
 *
 * Usage:
 *   router.get('/route', protect, hasPermission('students.view'), handler)
 */
const hasPermission = (permission) => (req, res, next) => {
  // Must come after protect middleware
  if (!req.admin) {
    return res.status(401).json({ success: false, message: 'Not authenticated.' });
  }

  const role = req.admin.role;

  // ── No role at all ────────────────────────────────────────
  if (!role) {
    return res.status(403).json({
      success: false,
      message: 'No role is assigned to your account. Contact a Super Admin.',
    });
  }

  // ── Super Admin bypasses every check ─────────────────────
  if (checkSuperAdmin(role)) {
    return next();
  }

  // ── Role is inactive ─────────────────────────────────────
  if (role.status === 'inactive') {
    return res.status(403).json({
      success: false,
      message: 'Your assigned role is inactive. Contact a Super Admin.',
    });
  }

  // ── Check permission array ────────────────────────────────
  const perms = Array.isArray(role.permissions) ? role.permissions : [];
  if (!perms.includes(permission)) {
    return res.status(403).json({
      success: false,
      message: `Access denied. Required permission: "${permission}".`,
    });
  }

  next();
};

/**
 * isSuperAdmin middleware
 * Hard-gate for Super-Admin-only routes.
 */
const isSuperAdmin = (req, res, next) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: 'Not authenticated.' });
  }
  if (checkSuperAdmin(req.admin.role)) return next();
  return res.status(403).json({ success: false, message: 'Super Admin access required.' });
};

/**
 * scopeToOwn
 * Institution / Associate Partner roles can only see their own submitted data.
 * Injects req.ownerFilter = { submittedBy: req.admin._id } for scoped roles,
 * or {} for everyone else.
 */
const scopeToOwn = (req, res, next) => {
  const scopedRoles = ['Institution', 'Associate Partner'];
  const role = req.admin?.role;
  const isScoped = !!(role && scopedRoles.includes(role.name));

  req.ownerFilter   = isScoped ? { submittedBy: req.admin._id } : {};
  req.scopedAdminId = isScoped ? req.admin._id : null;   // used by leads, attendance
  next();
};

module.exports = { hasPermission, isSuperAdmin, scopeToOwn };
