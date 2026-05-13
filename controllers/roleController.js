'use strict';

const Role = require('../models/Role');
const Admin = require('../models/Admin');
const PERMISSIONS = require('../config/permissions');

/* ============================================================
   HELPERS
============================================================ */
function normalizePermissions(input = []) {
  if (!input) return [];

  // If frontend sends object:
  // { students: ["view", "add"], roles: ["view"] }
  if (!Array.isArray(input) && typeof input === 'object') {
    const arr = [];

    Object.entries(input).forEach(([module, actions]) => {
      if (Array.isArray(actions)) {
        actions.forEach(action => {
          arr.push(`${module}.${action}`);
        });
      }
    });

    return arr;
  }

  // If frontend sends already array:
  // ["students.view", "students.add"]
  if (Array.isArray(input)) {
    return input;
  }

  return [];
}

function permissionsToObject(permissionArray = []) {
  const obj = {};

  if (!Array.isArray(permissionArray)) return obj;

  permissionArray.forEach(permission => {
    const [module, action] = String(permission).split('.');

    if (!module || !action) return;

    if (!obj[module]) obj[module] = [];
    obj[module].push(action);
  });

  return obj;
}

function validatePermissions(permissionArray = []) {
  if (!Array.isArray(PERMISSIONS) || PERMISSIONS.length === 0) {
    return [];
  }

  return permissionArray.filter(p => !PERMISSIONS.includes(p));
}

async function addUserCount(role) {
  const obj = role.toObject ? role.toObject() : { ...role };

  obj.userCount = await Admin.countDocuments({
    role: obj._id
  });

  // For frontend compatibility
  obj.permissionObject = permissionsToObject(obj.permissions || []);

  return obj;
}

/* ============================================================
   GET /api/roles
============================================================ */
exports.getRoles = async (req, res) => {
  try {
    const roles = await Role.find()
      .sort({ createdAt: 1 });

    const rolesWithCount = await Promise.all(
      roles.map(role => addUserCount(role))
    );

    return res.status(200).json({
      success: true,
      count: rolesWithCount.length,
      data: rolesWithCount,
      roles: rolesWithCount
    });

  } catch (err) {
    console.error('getRoles error:', err);

    return res.status(500).json({
      success: false,
      message: err.message || 'Server error while loading roles.'
    });
  }
};

/* ============================================================
   GET /api/roles/permissions
============================================================ */
exports.getAllPermissions = (_req, res) => {
  return res.status(200).json({
    success: true,
    data: PERMISSIONS,
    permissions: PERMISSIONS
  });
};

/* ============================================================
   GET /api/roles/:id
============================================================ */
exports.getRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found.'
      });
    }

    const roleObj = await addUserCount(role);

    return res.status(200).json({
      success: true,
      data: roleObj,
      role: roleObj
    });

  } catch (err) {
    console.error('getRole error:', err);

    return res.status(500).json({
      success: false,
      message: err.message || 'Server error while loading role.'
    });
  }
};

/* ============================================================
   POST /api/roles
============================================================ */
exports.createRole = async (req, res) => {
  try {
    const {
      name,
      description,
      permissions = [],
      status,
      icon,
      color
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Role name is required.'
      });
    }

    const normalizedPermissions = normalizePermissions(permissions);
    const invalid = validatePermissions(normalizedPermissions);

    if (invalid.length) {
      return res.status(400).json({
        success: false,
        message: `Invalid permissions: ${invalid.join(', ')}`
      });
    }

    const role = await Role.create({
      name: String(name).trim(),
      description: description || '',
      permissions: normalizedPermissions,
      status: status || 'active',
      icon: icon || 'fa-shield',
      color: color || '#2563EB',
      createdBy: req.admin?._id || null
    });

    const roleObj = await addUserCount(role);

    return res.status(201).json({
      success: true,
      message: 'Role created.',
      data: roleObj,
      role: roleObj
    });

  } catch (err) {
    console.error('createRole error:', err);

    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Role name already exists.'
      });
    }

    return res.status(500).json({
      success: false,
      message: err.message || 'Server error while creating role.'
    });
  }
};

/* ============================================================
   PUT /api/roles/:id
============================================================ */
exports.updateRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found.'
      });
    }

    const {
      name,
      description,
      permissions,
      status,
      icon,
      color
    } = req.body;

    if (permissions !== undefined) {
      const normalizedPermissions = normalizePermissions(permissions);
      const invalid = validatePermissions(normalizedPermissions);

      if (invalid.length) {
        return res.status(400).json({
          success: false,
          message: `Invalid permissions: ${invalid.join(', ')}`
        });
      }

      role.permissions = normalizedPermissions;
    }

    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(400).json({
          success: false,
          message: 'Role name cannot be empty.'
        });
      }

      role.name = String(name).trim();
    }

    if (description !== undefined) role.description = description;
    if (status !== undefined) role.status = status;
    if (icon !== undefined) role.icon = icon;
    if (color !== undefined) role.color = color;

    await role.save();

    const roleObj = await addUserCount(role);

    return res.status(200).json({
      success: true,
      message: 'Role updated.',
      data: roleObj,
      role: roleObj
    });

  } catch (err) {
    console.error('updateRole error:', err);

    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Role name already exists.'
      });
    }

    return res.status(500).json({
      success: false,
      message: err.message || 'Server error while updating role.'
    });
  }
};

/* ============================================================
   DELETE /api/roles/:id
============================================================ */
exports.deleteRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found.'
      });
    }

    if (role.isSystem || role.name === 'Super Admin') {
      return res.status(403).json({
        success: false,
        message: 'System roles cannot be deleted.'
      });
    }

    const count = await Admin.countDocuments({
      role: role._id
    });

    if (count > 0) {
      return res.status(409).json({
        success: false,
        message: `${count} admin(s) still use this role.`
      });
    }

    await role.deleteOne();

    return res.status(200).json({
      success: true,
      message: 'Role deleted.'
    });

  } catch (err) {
    console.error('deleteRole error:', err);

    return res.status(500).json({
      success: false,
      message: err.message || 'Server error while deleting role.'
    });
  }
};