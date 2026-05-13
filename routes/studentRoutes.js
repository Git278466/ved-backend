"use strict";

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const Student = require("../models/Student");
const ctrl = require("../controllers/studentController");

const { protectAdmin } = require("../middleware/authMiddleware");
const { hasPermission, scopeToOwn } = require("../middleware/roleMiddleware");

/* =========================================================
   HELPER: CREATE STUDENT
========================================================= */
async function createStudent(req, res) {
  try {
    const {
      email,
      password,
      fullName,
      mobile,
      gender,
      city,
      state,
      standard,
      schoolName,
      percentageCgpa,
      graduationCourse,
      specialization,
      collegeName,
      graduationCgpa,
      passingYear,
      status,
      notes
    } = req.body;

    if (!email || !fullName || !mobile) {
      return res.status(400).json({
        success: false,
        message: "Email, full name and mobile are required."
      });
    }

    const exists = await Student.findOne({
      email: email.toLowerCase().trim()
    });

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "This email is already registered."
      });
    }

    if (password && password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters."
      });
    }

    // Do NOT manually hash here — Student model pre-save hook handles hashing
    const student = await Student.create({
      email: email.toLowerCase().trim(),
      password: password || undefined,
      fullName,
      mobile,
      gender: gender || "",
      city: city || "",
      state: state || "",
      standard: standard || "",
      schoolName: schoolName || "",
      percentageCgpa: percentageCgpa || "",
      graduationCourse: graduationCourse || "",
      specialization: specialization || "",
      collegeName: collegeName || "",
      graduationCgpa: graduationCgpa || "",
      passingYear: passingYear ? Number(passingYear) : undefined,
      status: status || "pending",
      notes: notes || ""
    });

    const studentObj = student.toObject();
    delete studentObj.password;

    return res.status(201).json({
      success: true,
      message: "Student created successfully.",
      student: studentObj,
      data: studentObj
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate value found. Email or certificate number already exists."
      });
    }

    console.error("Create student error:", err);

    return res.status(500).json({
      success: false,
      message: err.message || "Server error while creating student."
    });
  }
}

/* =========================================================
   PUBLIC: STUDENT REGISTER
========================================================= */
router.post("/register", async (req, res) => {
  try {
    const {
      email, password, fullName, mobile, gender,
      city, state, standard, schoolName, percentageCgpa,
      graduationCourse, specialization, collegeName,
      graduationCgpa, passingYear
    } = req.body;

    // Validation
    if (!email || !fullName || !mobile) {
      return res.status(400).json({ success: false, message: "Email, full name and mobile are required." });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
    }

    // Check duplicate
    const exists = await Student.findOne({ email: email.toLowerCase().trim() });
    if (exists) {
      return res.status(409).json({ success: false, message: "This email is already registered. Please login." });
    }

    // Create student — pre-save hook in Student model will hash the password
    const student = await Student.create({
      email:            email.toLowerCase().trim(),
      password,                          // plain text — model hashes it
      fullName,
      mobile,
      gender:           gender          || "",
      city:             city            || "",
      state:            state           || "",
      standard:         standard        || "",
      schoolName:       schoolName      || "",
      percentageCgpa:   percentageCgpa  || "",
      graduationCourse: graduationCourse|| "",
      specialization:   specialization  || "",
      collegeName:      collegeName     || "",
      graduationCgpa:   graduationCgpa  || "",
      passingYear:      passingYear ? Number(passingYear) : undefined,
      status:           "pending"
    });

    const token = jwt.sign(
      { id: student._id, type: "student" },
      process.env.JWT_SECRET || "ved_secret_key",
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    const studentObj = student.toObject();
    delete studentObj.password;

    return res.status(201).json({
      success:  true,
      message:  "Registration successful! Your application is under review.",
      token,
      student:  studentObj,
      user:     studentObj,
      userType: "student"
    });

  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "This email is already registered. Please login." });
    }
    console.error("Student register error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error during registration." });
  }
});

/* =========================================================
   PUBLIC: STUDENT LOGIN
========================================================= */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const student = await Student.findOne({
      email: email.toLowerCase().trim()
    }).select("+password");

    // No account found
    if (!student) {
      return res.status(401).json({
        success: false,
        message: "No account found with this email. Please register first."
      });
    }

    // Account exists but has no password (registered without one)
    if (!student.password) {
      return res.status(401).json({
        success: false,
        message: "This account has no password set. Please contact the admin."
      });
    }

    const isMatch = await bcrypt.compare(password, student.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password. Please try again."
      });
    }

    await Student.findByIdAndUpdate(student._id, { lastLogin: new Date() });

    const token = jwt.sign(
      { id: student._id, type: "student" },
      process.env.JWT_SECRET || "ved_secret_key",
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    const studentObj = student.toObject();
    delete studentObj.password;

    return res.status(200).json({
      success:  true,
      message:  "Login successful.",
      token,
      student:  studentObj,
      user:     studentObj,
      userType: "student"
    });

  } catch (err) {
    console.error("Student login error:", err);
    return res.status(500).json({ success: false, message: "Server error during login." });
  }
});

/* =========================================================
   ADMIN-PROTECTED ROUTES
   Dashboard must send admin token:
   Authorization: Bearer <ved_admin_token>
========================================================= */
router.use(protectAdmin);

/* IMPORTANT: special routes must be before /:id */
router.get(
  "/stats/summary",
  hasPermission("students.view"),
  scopeToOwn,
  ctrl.statsSummary
);

router.get(
  "/filter",
  hasPermission("students.view"),
  scopeToOwn,
  ctrl.filterStudents
);

router.get(
  "/filter/summary",
  hasPermission("students.view"),
  scopeToOwn,
  ctrl.filterSummary
);

router.post(
  "/bulk-approve",
  hasPermission("students.approve"),
  ctrl.bulkApprove
);

router.post(
  "/bulk-reject",
  hasPermission("students.approve"),
  ctrl.bulkReject
);

/* CRUD */
router.get(
  "/",
  hasPermission("students.view"),
  scopeToOwn,
  ctrl.getStudents
);

router.post(
  "/",
  hasPermission("students.create"),
  createStudent
);

router.get(
  "/:id",
  hasPermission("students.view"),
  ctrl.getStudent
);

router.put(
  "/:id",
  hasPermission("students.update"),
  ctrl.updateStudent
);

router.delete(
  "/:id",
  hasPermission("students.delete"),
  ctrl.deleteStudent
);

module.exports = router;