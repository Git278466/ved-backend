'use strict';

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const Role = require('../models/Role');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const Certificate = require('../models/Certificate');
const CounsellingResponse = require('../models/CounsellingResponse');
const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const Donation = require('../models/Donation');
const FilterPreset = require('../models/FilterPreset');
const AuditLog = require('../models/AuditLog');

/* ============================================================
   HELPERS
============================================================ */
const signToken = (id) =>
  jwt.sign(
    { id, type: 'admin' },
    process.env.JWT_SECRET || 'ved_secret_key',
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    }
  );

const safeAdmin = (admin) => {
  const obj = typeof admin.toObject === 'function' ? admin.toObject() : { ...admin };
  delete obj.password;
  return obj;
};

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

async function resolveRole(role) {
  if (!role) return null;

  if (typeof role === 'object' && role._id) {
    role = role._id;
  }

  const roleValue = String(role).trim();

  if (isObjectId(roleValue)) {
    return await Role.findById(roleValue);
  }

  return await Role.findOne({
    name: new RegExp(`^${roleValue}$`, 'i'),
  });
}

/* ============================================================
   POST /api/admins/login
============================================================ */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.',
      });
    }

    const admin = await Admin.findOne({
      email: email.toLowerCase().trim(),
    })
      .select('+password')
      .populate({
        path: 'role',
        select: 'name description permissions isSystem status icon color',
      });

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    if (admin.status && admin.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Account deactivated. Contact a Super Admin.',
      });
    }

    const isMatch = await admin.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    await Admin.findByIdAndUpdate(admin._id, {
      lastLogin: new Date(),
    });

    const token = signToken(admin._id);

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      admin: safeAdmin(admin),
      user: safeAdmin(admin),
      userType: 'admin',
    });
  } catch (err) {
    console.error('login error:', err);

    return res.status(500).json({
      success: false,
      message: 'Server error during login.',
      error: err.message,
    });
  }
};

/* ============================================================
   GET /api/admins/me
============================================================ */
exports.getMe = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: req.admin,
      admin: req.admin,
      user: req.admin,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/* ============================================================
   GET /api/admins
============================================================ */
exports.getAdmins = async (req, res) => {
  try {
    const { search, role, status, page = 1, limit = 50 } = req.query;

    const filter = {};

    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [
        { firstName: re },
        { lastName: re },
        { email: re },
      ];
    }

    if (role) {
      const roleDoc = await resolveRole(role);

      if (roleDoc) {
        filter.role = roleDoc._id;
      }
    }

    if (status) {
      filter.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const total = await Admin.countDocuments(filter);

    const admins = await Admin.find(filter)
      .select('-password')
      .populate('role', 'name description permissions isSystem status icon color')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    return res.json({
      success: true,
      total,
      page: Number(page),
      data: admins,
      admins,
    });
  } catch (err) {
    console.error('getAdmins error:', err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/* ============================================================
   GET /api/admins/:id
============================================================ */
exports.getAdmin = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id)
      .select('-password')
      .populate('role', 'name description permissions isSystem status icon color');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found.',
      });
    }

    return res.json({
      success: true,
      data: admin,
      admin,
    });
  } catch (err) {
    console.error('getAdmin error:', err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/* ============================================================
   POST /api/admins
============================================================ */
exports.createAdmin = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      name,
      email,
      password,
      role,
      status,
      mobile,
    } = req.body;

    const finalFirstName = firstName || (name ? String(name).split(' ')[0] : '');
    const finalLastName = lastName || (name ? String(name).split(' ').slice(1).join(' ') : '');

    if (!finalFirstName || !finalLastName || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'firstName, lastName, email, password, and role are required.',
      });
    }

    const roleDoc = await resolveRole(role);

    if (!roleDoc) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Send valid role ObjectId or role name.',
      });
    }

    const admin = await Admin.create({
      firstName: finalFirstName,
      lastName: finalLastName,
      email: email.toLowerCase().trim(),
      password,
      role: roleDoc._id,
      status: status || 'active',
      mobile,
      createdBy: req.admin?._id || null,
    });

    const populated = await Admin.findById(admin._id)
      .select('-password')
      .populate('role', 'name description permissions isSystem status icon color');

    return res.status(201).json({
      success: true,
      message: 'Admin created.',
      data: populated,
      admin: populated,
    });
  } catch (err) {
    console.error('createAdmin error:', err);

    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Email already in use.',
      });
    }

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/* ============================================================
   PUT /api/admins/:id
============================================================ */
exports.updateAdmin = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found.',
      });
    }

    const {
      firstName,
      lastName,
      name,
      email,
      role,
      status,
      mobile,
      password,
    } = req.body;

    if (firstName || name) {
      admin.firstName = firstName || String(name).split(' ')[0] || admin.firstName;
    }

    if (lastName || name) {
      admin.lastName = lastName || String(name).split(' ').slice(1).join(' ') || admin.lastName;
    }

    if (email) {
      admin.email = email.toLowerCase().trim();
    }

    if (role) {
      const roleDoc = await resolveRole(role);

      if (!roleDoc) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role. Send valid role ObjectId or role name.',
        });
      }

      admin.role = roleDoc._id;
    }

    if (status) {
      admin.status = status;
    }

    if (mobile) {
      admin.mobile = mobile;
    }

    if (password) {
      admin.password = password;
    }

    await admin.save();

    const populated = await Admin.findById(admin._id)
      .select('-password')
      .populate('role', 'name description permissions isSystem status icon color');

    return res.json({
      success: true,
      message: 'Admin updated.',
      data: populated,
      admin: populated,
    });
  } catch (err) {
    console.error('updateAdmin error:', err);

    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Email already in use.',
      });
    }

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/* ============================================================
   PATCH /api/admins/:id/role
============================================================ */
exports.changeRole = async (req, res) => {
  try {
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({
        success: false,
        message: 'role is required.',
      });
    }

    const roleDoc = await resolveRole(role);

    if (!roleDoc) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Send valid role ObjectId or role name.',
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      req.params.id,
      { role: roleDoc._id },
      { new: true, runValidators: true }
    )
      .select('-password')
      .populate('role', 'name description permissions isSystem status icon color');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found.',
      });
    }

    return res.json({
      success: true,
      message: 'Role changed.',
      data: admin,
      admin,
    });
  } catch (err) {
    console.error('changeRole error:', err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/* ============================================================
   PATCH /api/admins/:id/status
============================================================ */
exports.toggleStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'status must be active or inactive.',
      });
    }

    const admin = await Admin.findById(req.params.id).populate('role', 'isSystem name');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found.',
      });
    }

    if (admin.role?.isSystem && admin.role?.name === 'Super Admin') {
      return res.status(403).json({
        success: false,
        message: 'Super Admin status cannot be changed.',
      });
    }

    admin.status = status;
    await admin.save();

    return res.json({
      success: true,
      message: `Admin ${status}.`,
    });
  } catch (err) {
    console.error('toggleStatus error:', err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/* ============================================================
   DELETE /api/admins/:id
============================================================ */
exports.deleteAdmin = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id).populate('role', 'isSystem name');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found.',
      });
    }

    if (admin.role?.isSystem && admin.role?.name === 'Super Admin') {
      return res.status(403).json({
        success: false,
        message: 'Super Admin cannot be deleted.',
      });
    }

    if (req.admin && admin._id.toString() === req.admin._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete your own account.',
      });
    }

    await admin.deleteOne();

    return res.json({
      success: true,
      message: 'Admin deleted.',
    });
  } catch (err) {
    console.error('deleteAdmin error:', err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/* ============================================================
   DELETE /api/admins/danger/clear-students  (Super Admin only)
============================================================ */
exports.clearStudentData = async (req, res) => {
  try {
    const results = await Promise.all([
      Student.deleteMany({}),
      Attendance.deleteMany({}),
      Certificate.deleteMany({}),
      CounsellingResponse.deleteMany({}),
      Lead.deleteMany({}),
      LeadActivity.deleteMany({}),
      Donation.deleteMany({}),
    ]);

    const counts = {
      students:             results[0].deletedCount,
      attendance:           results[1].deletedCount,
      certificates:         results[2].deletedCount,
      counsellingResponses: results[3].deletedCount,
      leads:                results[4].deletedCount,
      leadActivities:       results[5].deletedCount,
      donations:            results[6].deletedCount,
    };

    console.warn(`[DANGER] clearStudentData by admin ${req.admin._id}:`, counts);

    return res.json({
      success: true,
      message: 'All student data has been cleared.',
      deleted: counts,
    });
  } catch (err) {
    console.error('clearStudentData error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ============================================================
   POST /api/admins/danger/reset-settings  (Super Admin only)
============================================================ */
exports.resetToDefault = async (req, res) => {
  try {
    const results = await Promise.all([
      FilterPreset.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);

    const counts = {
      filterPresets: results[0].deletedCount,
      auditLogs:     results[1].deletedCount,
    };

    console.warn(`[DANGER] resetToDefault by admin ${req.admin._id}:`, counts);

    return res.json({
      success: true,
      message: 'Settings reset to default.',
      cleared: counts,
    });
  } catch (err) {
    console.error('resetToDefault error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ============================================================
   POST /api/admins/change-password
============================================================ */
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Both passwords are required.',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters.',
      });
    }

    const admin = await Admin.findById(req.admin._id).select('+password');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found.',
      });
    }

    const ok = await admin.comparePassword(currentPassword);

    if (!ok) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect.',
      });
    }

    admin.password = newPassword;
    await admin.save();

    return res.json({
      success: true,
      message: 'Password changed.',
    });
  } catch (err) {
    console.error('changePassword error:', err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};