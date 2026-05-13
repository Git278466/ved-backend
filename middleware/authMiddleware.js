'use strict';

const jwt     = require('jsonwebtoken');
const Admin   = require('../models/Admin');
const Student = require('../models/Student');

/**
 * protect
 * ───────
 * Verifies Bearer JWT.
 * - If token belongs to an Admin  → populates req.admin
 * - If token belongs to a Student → populates req.student
 * - No token → 401
 *
 * Used on admin-only routes. After this middleware:
 *   req.admin   is set for admin tokens
 *   req.student is set for student tokens
 */
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Not authorised. Please log in.',
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token missing.' });
    }

    // Verify signature
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const msg = err.name === 'TokenExpiredError'
        ? 'Session expired. Please log in again.'
        : 'Invalid token. Please log in again.';
      return res.status(401).json({ success: false, message: msg });
    }

    // ── Student token ───────────────────────────────────────────
    if (decoded.type === 'student') {
      const student = await Student.findById(decoded.id)
        .select('-password')
        .lean();

      if (!student) {
        return res.status(401).json({ success: false, message: 'Student account not found.' });
      }

      req.student     = student;
      req.admin       = null;   // explicitly null so downstream checks don't break
      req.ownerFilter = {};
      return next();
    }

    // ── Admin token (default) ───────────────────────────────────
    const admin = await Admin.findById(decoded.id)
      .select('-password')
      .populate({
        path:   'role',
        select: 'name description permissions isSystem status icon color',
      })
      .lean();

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Admin account not found.' });
    }

    if (admin.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Your account is deactivated. Contact a Super Admin.',
      });
    }

    req.admin = admin;
    next();
  } catch (err) {
    console.error('authMiddleware error:', err);
    res.status(500).json({ success: false, message: 'Server error during authentication.' });
  }
};

/**
 * protectAdmin
 * ────────────
 * Stricter version — rejects student tokens explicitly.
 * Use on admin-only pages (dashboard, roles, etc.)
 */
const protectAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authorised. Please log in.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    if (decoded.type === 'student') {
      return res.status(403).json({
        success: false,
        message: 'This section is for admins only.',
      });
    }

    const admin = await Admin.findById(decoded.id)
      .select('-password')
      .populate({ path: 'role', select: 'name description permissions isSystem status icon color' })
      .lean();

    if (!admin || admin.status !== 'active') {
      return res.status(401).json({ success: false, message: 'Admin account not found or inactive.' });
    }

    req.admin = admin;
    next();
  } catch (err) {
    console.error('protectAdmin error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * optionalAuth
 * ────────────
 * Never blocks the request.
 * Sets req.admin or req.student if a valid token is present, silently
 * ignores missing / invalid tokens.
 * Safe to use on public routes like /register.
 */
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return next();   // no token — just continue

  try {
    const token   = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type === 'student') {
      const student = await Student.findById(decoded.id).select('-password').lean();
      if (student) req.student = student;
    } else {
      const admin = await Admin.findById(decoded.id)
        .select('-password')
        .populate('role', 'name permissions isSystem')
        .lean();
      if (admin && admin.status === 'active') req.admin = admin;
    }
  } catch (_) {
    // Silently ignore invalid / expired tokens on optional routes
  }
  next();
};

module.exports = { protect, protectAdmin, optionalAuth };
