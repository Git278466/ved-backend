"use strict";

require("dotenv").config();

// ── Validate critical env vars on startup ────────────────────
const REQUIRED_ENV = ["MONGO_URI", "JWT_SECRET"];
REQUIRED_ENV.forEach(k => {
  if (!process.env[k]) {
    console.error(`❌ Missing required env var: ${k}. Check your .env file.`);
    process.exit(1);
  }
});
if (process.env.JWT_SECRET === "mysecretkey" || process.env.JWT_SECRET === "ved_secret_key") {
  console.warn("⚠️  WARNING: You are using a weak JWT_SECRET. Change it before going live!");
}

const express     = require("express");
const mongoose    = require("mongoose");
const cors        = require("cors");
const helmet      = require("helmet");
const morgan      = require("morgan");
const rateLimit   = require("express-rate-limit");
const compression = require("compression");
const jwt         = require("jsonwebtoken");
const bcrypt      = require("bcryptjs");
const cron        = require("node-cron");

const path      = require("path");
const connectDB = require("./config/db");
const logger    = require("./utils/logger");
const ROOT      = path.resolve(__dirname, "..");

const app = express();
app.set('trust proxy', 1);

/* =========================
   CONNECT DATABASE
========================= */
connectDB();

/* =========================
   MIDDLEWARE
========================= */
app.use(
  helmet({
    // Content-Security-Policy in REPORT-ONLY mode — browsers log violations to
    // the console but nothing is blocked, so there is ZERO risk of breaking the
    // app. This lets us observe what a future enforced policy would affect
    // before switching `reportOnly` to false. Rollback = set contentSecurityPolicy
    // back to false.
    contentSecurityPolicy: {
      reportOnly: true,
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // App relies heavily on inline <script>/onclick and inline styles.
        scriptSrc:  ["'self'", "'unsafe-inline'"],
        styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
        fontSrc:    ["'self'", "data:", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        imgSrc:     ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.vededufoundation.in", "https://vededufoundation.in"],
        frameAncestors: ["'self'"],
        objectSrc:  ["'none'"],
        baseUri:    ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
// Permissions-Policy — deny powerful features the app never uses.
app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
  next();
});

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (Postman, Thunder Client, file://, curl, etc.)
      if (!origin) {
        return callback(null, true);
      }

      // Production origins — add your Hostinger domain here
      const productionOrigins = [
        "https://vededufoundation.in",
        "https://www.vededufoundation.in",
        "http://vededufoundation.in",
        "http://www.vededufoundation.in",
      ];

      // Dev origins — only allowed when NODE_ENV !== production
      const devOrigins = [
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:5501",
        "http://localhost:5501",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
      ];

      const allowedOrigins = process.env.NODE_ENV === 'production'
        ? productionOrigins
        : [...productionOrigins, ...devOrigins];

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // In dev mode allow any localhost port
      if (process.env.NODE_ENV !== 'production' &&
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },

    credentials: true,

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// Preflight request support
app.options("*", cors());

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ── Gzip compression — only compress responses > 1KB (saves CPU on tiny payloads) ──
app.use(compression({ threshold: 1024 }));

// ── HTTP request logging ──────────────────────────────────────
if (process.env.NODE_ENV !== "test") {
  if (process.env.NODE_ENV === "production") {
    // Production: structured combined log to file only (skip noisy dev colours)
    app.use(morgan("combined", {
      stream: { write: msg => logger.http(msg.trim()) }
    }));
  } else {
    app.use(morgan("dev"));
  }
}
/* =========================
   RATE LIMIT
========================= */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later."
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later."
  }
});

app.use(globalLimiter);

/* =========================
   SERVE FRONTEND PAGES
========================= */
// Safe static assets (only specific files — backend/ folder is NOT exposed)
app.use("/icons",        express.static(path.join(ROOT, "icons")));
app.use("/manifest.json",(_, res) => res.sendFile(path.join(ROOT, "manifest.json")));
app.use("/sw.js",        (_, res) => res.sendFile(path.join(ROOT, "sw.js")));
app.use("/offline.html", (_, res) => res.sendFile(path.join(ROOT, "offline.html")));
app.use("/shared.js",    (_, res) => { res.setHeader("Cache-Control", "no-cache, must-revalidate"); res.sendFile(path.join(ROOT, "shared.js")); });
app.use("/header.html",  (_, res) => res.sendFile(path.join(ROOT, "header.html")));
app.use("/footer.html",  (_, res) => res.sendFile(path.join(ROOT, "footer.html")));

// Images & static media from root (logo, banners etc.)
const serveImg = (name) => app.get("/" + name, (_, res) => res.sendFile(path.join(ROOT, name)));
serveImg("Ved-foundationlogofinal.jpg");
serveImg("donation.png");
serveImg("Untitled design.png");
// Serve all jpg/jpeg/png/pdf from root
app.use(express.static(ROOT, {
  index: false,
  dotfiles: "ignore",
  // Safe caching policy (no asset hashing in this project, so JS/HTML are never
  // long-cached — prevents stale config.js/shared.js/dashboard). Rollback:
  // delete the three branches below, leaving only the backend-block guard.
  setHeaders: (res, filePath) => {
    if (filePath.startsWith(path.join(ROOT, "backend"))) {
      res.status(403).end(); // block backend folder
      return;
    }
    if (filePath.endsWith(".html")) {
      // HTML must always revalidate so users get the latest UI immediately
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    } else if (/[\\/](config|shared)\.js$/.test(filePath)) {
      // config.js / shared.js are NOT versioned — never long-cache them
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    } else if (/\.(jpe?g|png|gif|svg|webp|ico|woff2?|ttf|eot|otf)$/i.test(filePath)) {
      // Images & fonts rarely change — safe to cache for 30 days
      res.setHeader("Cache-Control", "public, max-age=2592000");
    }
    // Any other file keeps express-static's default (max-age=0, revalidate)
  }
}));

// Public website pages — HTML always revalidates (no stale UI)
const servePage = (url, file) => {
  app.get(url, (_, res) => {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.sendFile(path.join(ROOT, file));
  });
};
servePage("/",                    "index.html");
servePage("/index.html",          "index.html");
servePage("/register",            "registeration.html");
servePage("/registeration.html",  "registeration.html");
servePage("/login",               "login.html");
servePage("/login.html",          "login.html");
servePage("/smartclasses.html",   "smartclasses.html");
servePage("/agriculture.html",    "agriculture.html");
servePage("/solarpanel.html",     "solarpanel.html");
servePage("/donation.html",       "donation.html");
servePage("/roles.html",          "roles.html");
servePage("/student-dashboard.html", "student-dashboard.html");
servePage("/counselling-cert",        "counselling-cert.html");
servePage("/counselling-cert.html",   "counselling-cert.html");
servePage("/workshops",               "workshops.html");
servePage("/workshops.html",          "workshops.html");
servePage("/mobilization-form",       "mobilization-form.html");
servePage("/mobilization-form.html",  "mobilization-form.html");
servePage("/institution-dashboard",       "institution-dashboard.html");
servePage("/institution-dashboard.html",  "institution-dashboard.html");
servePage("/partner-certificate",             "partner-certificate.html");
servePage("/partner-certificate.html",        "partner-certificate.html");
servePage("/admin-certificate-approvals",     "admin-certificate-approvals.html");
servePage("/admin-certificate-approvals.html","admin-certificate-approvals.html");
servePage("/verify-cep-certificate",          "verify-cep-certificate.html");
servePage("/verify-cep-certificate.html",     "verify-cep-certificate.html");

/* =========================
   HEALTH ROUTES
========================= */
app.get("/api", (req, res) => {
  res.json({
    success: true,
    message: "VED Foundation Backend Running"
  });
});

app.get("/api/health", (req, res) => {
  const dbStates = { 0:"disconnected", 1:"connected", 2:"connecting", 3:"disconnecting" };
  const uptime   = process.uptime();
  const mem      = process.memoryUsage();
  res.json({
    success:     true,
    status:      "ok",
    timestamp:   new Date().toISOString(),
    uptime:      `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
    environment: process.env.NODE_ENV || "development",
    database:    dbStates[mongoose.connection.readyState] || "unknown",
    memory: {
      used:  Math.round(mem.heapUsed  / 1024 / 1024) + " MB",
      total: Math.round(mem.heapTotal / 1024 / 1024) + " MB",
    },
    version: process.env.npm_package_version || "2.0.0",
  });
});

/* =========================
   ROUTE IMPORTS SAFE
========================= */
function safeRoute(routePath) {
  try {
    return require(routePath);
  } catch (err) {
    console.error(`\n❌ ROUTE LOAD ERROR in ${routePath}:\n   ${err.message}\n   ${err.stack?.split('\n')[1]||''}\n`);

    // Fallback: handle ALL methods & paths so nothing hits the 404 handler
    const router = express.Router();
    router.all('*', (req, res) => {
      res.json({ success: true, message: `${routePath} route unavailable`, data: [], total: 0 });
    });
    return router;
  }
}

const adminRoutes = safeRoute("./routes/adminRoutes");
const roleRoutes = safeRoute("./routes/roleRoutes");
const studentRoutes = safeRoute("./routes/studentRoutes");
const attendanceRoutes = safeRoute("./routes/attendanceRoutes");
const dashboardRoutes = safeRoute("./routes/dashboardRoutes");
const certificateRoutes = safeRoute("./routes/certificateRoutes");
const institutionRoutes = safeRoute("./routes/institutionRoutes");
const partnerRoutes = safeRoute("./routes/partnerRoutes");
const donationRoutes = safeRoute("./routes/donationRoutes");
const reportRoutes = safeRoute("./routes/reportRoutes");
const filterPresetRoutes = safeRoute("./routes/filterPresetRoutes");
const leadRoutes         = safeRoute("./routes/leadRoutes");
const campaignRoutes     = safeRoute("./routes/campaignRoutes");
const emailRoutes        = safeRoute("./routes/emailRoutes");
const referrerRoutes             = safeRoute("./routes/referrerRoutes");
const counsellingResponseRoutes  = safeRoute("./routes/counsellingResponseRoutes");
const workshopRoutes             = safeRoute("./routes/workshopRoutes");
const mobilizationRoutes         = safeRoute("./routes/mobilizationRoutes");
const teamRoutes                 = safeRoute("./routes/teamRoutes");
const institutionLeadRoutes      = safeRoute("./routes/institutionLeadRoutes");
const partnerCertificateRoutes   = safeRoute("./routes/partnerCertificateRoutes");
const notificationRoutes         = safeRoute("./routes/notificationRoutes");
const marketingRoutes            = safeRoute("./routes/marketingRoutes");

/* =========================
   ADMIN UTILITIES
========================= */
const { protectAdmin } = require('./middleware/authMiddleware');
const { isSuperAdmin }  = require('./middleware/roleMiddleware');

/* ── Get or auto-create the Associate Partner role (any admin) ── */
app.get('/api/admin-utils/associate-partner-role', protectAdmin, async (req, res) => {
  try {
    const Role = require('./models/Role');
    let role = await Role.findOne({ name: 'Associate Partner' }).lean();
    if (!role) {
      role = await Role.create({
        name: 'Associate Partner',
        description: 'Associate partner — can refer leads and view their assigned data only',
        permissions: ['dashboard.view', 'associate_partners.view', 'leads.view', 'leads.create'],
        isSystem: false,
        status: 'active',
        icon: 'fa-handshake',
        color: '#7c3aed'
      });
      role = role.toObject ? role.toObject() : role;
      console.log('[seed] Associate Partner role created:', role._id);
    }
    res.json({ success: true, data: role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin-utils/backfill-codes', protectAdmin, isSuperAdmin, async (req, res) => {
  try {
    const generateCode = require('./utils/generateCode');
    const Admin        = require('./models/Admin');
    const Role         = require('./models/Role');
    const Institution  = require('./models/Institution');
    const Partner      = require('./models/Partner');
    let total = 0;

    // Remove code from Super Admins
    const superAdminRole = await Role.findOne({ name: 'Super Admin', isSystem: true }).lean();
    if (superAdminRole) {
      const r = await Admin.updateMany(
        { role: superAdminRole._id, code: { $exists: true, $ne: null } },
        { $unset: { code: '' } }
      );
      total += r.modifiedCount;
    }

    const { namePrefix } = generateCode;

    // Admins: fix missing codes AND regenerate old 4-letter prefix codes (e.g. FIRO-5558 → FIROJ-5558)
    const allAdmins = await Admin.find(
      superAdminRole ? { role: { $ne: superAdminRole._id } } : {}
    ).populate('role', 'name isSystem');

    for (const admin of allAdmins) {
      if (admin.role?.isSystem) continue;
      const prefix = namePrefix(admin.firstName || admin.email || 'ADMIN');
      const existingPrefix = (admin.code || '').split('-')[0] || '';
      // Generate if: no code, OR existing prefix is shorter than 5 chars
      if (!admin.code || existingPrefix.length < 5) {
        const code = await generateCode(Admin, prefix);
        await Admin.updateOne({ _id: admin._id }, { code });
        total++;
      }
    }

    // Institutions: fix missing codes
    const missingInst = await Institution.find({ $or: [{ code: null }, { code: { $exists: false } }] });
    for (const doc of missingInst) {
      const code = await generateCode(Institution, namePrefix(doc.name || 'INSTI'));
      await Institution.updateOne({ _id: doc._id }, { code });
      total++;
    }

    // Partners: fix missing codes AND regenerate old 4-letter prefix codes
    const allPartners = await Partner.find({});
    for (const doc of allPartners) {
      const existingPrefix = (doc.code || '').split('-')[0] || '';
      if (!doc.code || existingPrefix.length < 5) {
        const code = await generateCode(Partner, namePrefix(doc.organizationName || 'PARTN'));
        await Partner.updateOne({ _id: doc._id }, { code });
        total++;
      }
    }

    res.json({ success: true, summary: `${total} record(s) updated`, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================
   API ROUTES
========================= */
app.use("/api/admins", adminRoutes);
app.use("/api/admin", adminRoutes);

app.use("/api/roles", roleRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/certificates", certificateRoutes);
app.use("/api/institutions", institutionRoutes);
app.use("/api/partners", partnerRoutes);
app.use("/api/donations", donationRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/filter-presets", filterPresetRoutes);
app.use("/api/leads",         leadRoutes);
app.use("/api/campaigns",     campaignRoutes);
app.use("/api/email",         emailRoutes);
app.use("/api/referrers",              referrerRoutes);
app.use("/api/counselling-responses",  counsellingResponseRoutes);
app.use("/api/workshops",              workshopRoutes);
// ── Mobilization — inline handler (guaranteed to work) ───────
(function () {
  let Mob;
  try { Mob = require("./models/Mobilization"); } catch (_) {}

  // Resolve a mobilizer referral code against Admin / Institution / Partner
  async function resolveMobReferralCode(code) {
    if (!code) return null;
    const upper = code.toUpperCase().trim();
    try {
      const Admin       = require("./models/Admin");
      const Institution = require("./models/Institution");
      const Partner     = require("./models/Partner");
      const [admin, inst, partner] = await Promise.all([
        Admin.findOne({ code: upper }).select("firstName lastName code").lean(),
        Institution.findOne({ code: upper }).select("name code").lean(),
        Partner.findOne({ code: upper }).select("organizationName code").lean(),
      ]);
      if (admin)   return { type: "admin",       id: admin._id,   name: ((admin.firstName||"") + " " + (admin.lastName||"")).trim() };
      if (inst)    return { type: "institution", id: inst._id,    name: inst.name };
      if (partner) return { type: "partner",     id: partner._id, name: partner.organizationName };
    } catch (_) {}
    return null;
  }

  // POST /api/mobilization  — public
  app.post("/api/mobilization", async (req, res) => {
    if (!Mob) return res.status(503).json({ success: false, message: "Mobilization model unavailable." });
    try {
      if (!req.body.fullName) return res.status(400).json({ success: false, message: "Full name is required." });

      const body = { ...req.body };
      if (body.referralCode) {
        body.referralCode = String(body.referralCode).toUpperCase().trim();
        const ref = await resolveMobReferralCode(body.referralCode);
        if (ref) {
          body.referredByType = ref.type;
          body.referredById   = ref.id;
          body.referredByName = ref.name;
        }
      }

      const doc = await Mob.create(body);
      res.status(201).json({ success: true, message: "Registration successful! We will get in touch soon.", data: doc });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // All routes below — admin auth required (role populated for permission checks)
  const mobAuth = async (req, res, next) => {
    try {
      const h = req.headers.authorization || "";
      if (!h.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "Not authorised." });
      const decoded = jwt.verify(h.split(" ")[1], process.env.JWT_SECRET);
      if (decoded.type === "student") return res.status(403).json({ success: false, message: "Admins only." });
      const Admin = require("./models/Admin");
      const admin = await Admin.findById(decoded.id)
        .select("-password")
        .populate({ path: "role", select: "name permissions isSystem status" })
        .lean();
      if (!admin || admin.status !== "active") return res.status(401).json({ success: false, message: "Admin not found." });
      req.admin = admin;
      next();
    } catch (e) { res.status(401).json({ success: false, message: "Invalid or expired token." }); }
  };

  // Permission gate for mobilization routes. Super Admin bypasses; every
  // other role must carry the exact "mobilization.<action>" permission.
  const mobRequire = (perm) => (req, res, next) => {
    const role = req.admin && req.admin.role;
    if (!role) return res.status(403).json({ success: false, message: "No role assigned to your account." });
    if (role.isSystem === true && role.name === "Super Admin") return next();
    if (role.status === "inactive") return res.status(403).json({ success: false, message: "Your role is inactive." });
    const perms = Array.isArray(role.permissions) ? role.permissions : [];
    if (!perms.includes(perm)) {
      return res.status(403).json({ success: false, message: `Access denied. Required permission: "${perm}".` });
    }
    next();
  };

  // GET /api/mobilization  — list
  app.get("/api/mobilization", mobAuth, mobRequire("mobilization.view"), async (req, res) => {
    if (!Mob) return res.status(503).json({ success: false, message: "Mobilization model unavailable.", data: [], total: 0 });
    try {
      const { search, status, gender, skillCourse, certificateProgram, educationDest, dateFrom, dateTo, page = 1, limit = 25 } = req.query;
      const filter = {};
      if (status)             filter.status             = status;
      if (gender)             filter.gender              = gender;
      if (skillCourse)        filter.skillCourse         = new RegExp(skillCourse, "i");
      if (certificateProgram) filter.certificateProgram  = certificateProgram;
      if (educationDest)      filter.educationDest       = educationDest;
      if (dateFrom || dateTo) {
        filter.registrationDate = {};
        if (dateFrom) filter.registrationDate.$gte = new Date(dateFrom);
        if (dateTo)   filter.registrationDate.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
      }
      if (search) {
        filter.$or = [
          { fullName:     new RegExp(search, "i") },
          { mobile:       new RegExp(search, "i") },
          { guardianName: new RegExp(search, "i") },
          { skillCourse:  new RegExp(search, "i") },
          { organization: new RegExp(search, "i") },
          { aadhaar:      new RegExp(search, "i") },
        ];
      }
      const pageNum  = Math.max(1, Number(page));
      const limitNum = Math.min(100, Math.max(1, Number(limit)));
      const skip     = (pageNum - 1) * limitNum;
      const [total, data] = await Promise.all([
        Mob.countDocuments(filter),
        Mob.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      ]);
      res.json({ success: true, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum), data });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/mobilization/stats
  app.get("/api/mobilization/stats", mobAuth, mobRequire("mobilization.view"), async (req, res) => {
    if (!Mob) return res.status(503).json({ success: false, message: "Unavailable.", data: {} });
    try {
      // Single $facet aggregation replaces 4 separate countDocuments calls
      const [result] = await Mob.aggregate([
        { $facet: {
          total:     [{ $count: "n" }],
          new:       [{ $match: { status: "new" }       }, { $count: "n" }],
          contacted: [{ $match: { status: "contacted" } }, { $count: "n" }],
          enrolled:  [{ $match: { status: "enrolled" }  }, { $count: "n" }],
          byGender:  [{ $group: { _id: "$gender", count: { $sum: 1 } } }],
          byCourse:  [
            { $group: { _id: "$skillCourse", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
          byCertificateProgram: [{ $group: { _id: "$certificateProgram", count: { $sum: 1 } } }],
        }},
      ]);
      const total     = result?.total?.[0]?.n     || 0;
      const newC      = result?.new?.[0]?.n       || 0;
      const contacted = result?.contacted?.[0]?.n || 0;
      const enrolled  = result?.enrolled?.[0]?.n  || 0;
      res.json({ success: true, data: {
        total, newCount: newC, contactedCount: contacted, enrolledCount: enrolled,
        byGender: result?.byGender || [],
        byCourse: result?.byCourse || [],
        byCertificateProgram: result?.byCertificateProgram || [],
      }});
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/mobilization/export/:program — export NESCOM or IBM students as Excel
  app.get("/api/mobilization/export/:program", mobAuth, mobRequire("mobilization.export"), async (req, res) => {
    if (!Mob) return res.status(503).json({ success: false, message: "Unavailable." });
    try {
      const XLSX = require("xlsx");
      const program = (req.params.program || "").toUpperCase();
      if (!["NESCOM", "IBM", "WORKSHOP"].includes(program))
        return res.status(400).json({ success: false, message: "Invalid program. Use NESCOM, IBM or WORKSHOP." });

      const dbValue = program === "WORKSHOP" ? "Workshop" : program;
      const docs = await Mob.find({ certificateProgram: dbValue }).sort({ createdAt: -1 }).lean();
      if (!docs.length)
        return res.status(404).json({ success: false, message: `No ${program} students found.` });

      const rows = docs.map((d, i) => ({
        "S.No":                  i + 1,
        "Full Name":             d.fullName || "",
        "Guardian Name":         d.guardianName || "",
        "Guardian Contact":      d.guardianContact || "",
        "Guardian Occupation":   d.guardianOccupation || "",
        "Institution":           d.organization || "",
        "Student Mobile":        d.mobile || "",
        "Date of Birth":         d.dob ? new Date(d.dob).toLocaleDateString("en-IN") : "",
        "Gender":                d.gender || "",
        "Address":               d.address || "",
        "Aadhaar":               d.aadhaar || "",
        "Education":             d.education || "",
        "Certificate Program":   d.certificateProgram || "",
        "Mobilizer Name":        d.referredByName || "",
        "Mobilizer Code":        d.referralCode || "",
        "Status":                d.status || "",
        "Registration Date":     d.registrationDate ? new Date(d.registrationDate).toLocaleDateString("en-IN") : "",
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = Object.keys(rows[0]).map(k => ({
        wch: Math.max(k.length, ...rows.map(r => String(r[k] || "").length)) + 2,
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `${program} Students`);
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      const date = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Disposition", `attachment; filename="mobilization-${program}-${date}.xlsx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buf);
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PATCH /api/mobilization/:id
  app.patch("/api/mobilization/:id", mobAuth, mobRequire("mobilization.update"), async (req, res) => {
    if (!Mob) return res.status(503).json({ success: false, message: "Unavailable." });
    try {
      const doc = await Mob.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!doc) return res.status(404).json({ success: false, message: "Not found." });
      res.json({ success: true, data: doc });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/mobilization/:id
  app.delete("/api/mobilization/:id", mobAuth, mobRequire("mobilization.delete"), async (req, res) => {
    if (!Mob) return res.status(503).json({ success: false, message: "Unavailable." });
    try {
      const doc = await Mob.findByIdAndDelete(req.params.id);
      if (!doc) return res.status(404).json({ success: false, message: "Not found." });
      res.json({ success: true, message: "Deleted." });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // Keep the route-file-based router as backup (won't conflict since inline routes above take priority)
  app.use("/api/mobilization", mobilizationRoutes);
}());

app.use("/api/teams",                  teamRoutes);
app.use("/api/institution",            institutionLeadRoutes);
app.use("/api/cep-certificates",       partnerCertificateRoutes);
app.use("/api/notifications",          notificationRoutes);
app.use("/api/marketing-materials",    marketingRoutes);

/* =========================
   AUTH ALIAS ROUTES
========================= */
app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const Admin = require("./models/Admin");

    const admin = await Admin.findOne({
      email: email.toLowerCase().trim()
    })
      .select("+password")
      .populate({
        path: "role",
        select: "name description permissions isSystem status icon color"
      });

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    if (admin.status && admin.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Admin account is inactive"
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    await Admin.findByIdAndUpdate(admin._id, {
      lastLogin: new Date()
    });

    const token = jwt.sign(
      {
        id: admin._id,
        type: "admin"
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d"
      }
    );

    const adminObj = admin.toObject();
    delete adminObj.password;

    res.json({
      success: true,
      message: "Login successful",
      token,
      admin: adminObj,
      user: adminObj,
      userType: "admin"
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "No token provided"
      });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }

    // ── Student token ─────────────────────────────────────────
    if (decoded.type === "student") {
      const Student = require("./models/Student");
      const student = await Student.findById(decoded.id).select("-password");
      if (!student) {
        return res.status(404).json({ success: false, message: "Student not found" });
      }
      return res.json({ success: true, student, user: student, userType: "student" });
    }

    // ── Admin token ───────────────────────────────────────────
    const Admin = require("./models/Admin");
    const admin = await Admin.findById(decoded.id)
      .select("-password")
      .populate({ path: "role", select: "name description permissions isSystem status icon color" });

    if (!admin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }

    res.json({ success: true, admin, user: admin, userType: "admin" });

  } catch (err) {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
});

/* =========================
   404 HANDLER
========================= */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

/* =========================
   ERROR HANDLER
========================= */
app.use((err, req, res, next) => {
  logger.error(`Server Error: ${err.message}`, { url: req.originalUrl, method: req.method });

  res.status(err.statusCode || err.status || 500).json({
    success: false,
    message: err.message || "Internal server error"
  });
});

/* =========================
   UNHANDLED ERRORS
========================= */
process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled Promise Rejection: ${reason?.message || reason}`);
});

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  // Give logger time to write, then exit (PM2 will restart)
  setTimeout(() => process.exit(1), 1000);
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 5000;

/* ── Seed default roles on startup ────────────────────────────── */
async function seedDefaultRoles() {
  try {
    const Role        = require('./models/Role');
    const PERMISSIONS = require('./config/permissions');

    // 1. Admin role — all permissions (editable, not system)
    const adminRole = await Role.findOne({ name: 'Admin' });
    if (!adminRole) {
      await Role.create({
        name: 'Admin',
        description: 'Full-access admin — all permissions granted. Restrict via Roles & Permissions.',
        permissions: [...PERMISSIONS],
        isSystem: false,
        status: 'active',
        icon: 'fa-user-shield',
        color: '#2563eb'
      });
      console.log('[seed] Admin role created with all permissions');
    } else {
      // Ensure existing Admin role has ALL permissions (adds any missing ones)
      const missing = PERMISSIONS.filter(p => !adminRole.permissions.includes(p));
      if (missing.length) {
        await Role.updateOne(
          { _id: adminRole._id },
          { $addToSet: { permissions: { $each: missing } } }
        );
        console.log(`[seed] Admin role updated — added ${missing.length} missing permission(s)`);
      }
    }

    // 2. Associate Partner role — limited permissions
    const apRole = await Role.findOne({ name: 'Associate Partner' });
    if (!apRole) {
      await Role.create({
        name: 'Associate Partner',
        description: 'Associate partner — can refer leads and view their assigned data only',
        permissions: ['dashboard.view', 'associate_partners.view', 'leads.view', 'leads.create'],
        isSystem: false,
        status: 'active',
        icon: 'fa-handshake',
        color: '#7c3aed'
      });
      console.log('[seed] Associate Partner role created');
    }
  } catch (err) {
    console.warn('[seed] seedDefaultRoles error:', err.message);
  }
}

/* ── Auto-backfill unique codes on startup ─────────────────────── */
async function autoBackfillCodes() {
  try {
    const generateCode = require('./utils/generateCode');
    const Admin       = require('./models/Admin');
    const Role        = require('./models/Role');
    const Institution = require('./models/Institution');
    const Partner     = require('./models/Partner');

    // ── Super Admin: remove any code they have ──────────────────
    const superAdminRole = await Role.findOne({ name: 'Super Admin', isSystem: true }).lean();
    if (superAdminRole) {
      const removed = await Admin.updateMany(
        { role: superAdminRole._id, code: { $exists: true, $ne: null } },
        { $unset: { code: '' } }
      );
      if (removed.modifiedCount) console.log(`[codes] Removed code from ${removed.modifiedCount} Super Admin(s)`);
    }

    // ── Other admins: first 4 letters of firstName + random 4 digits ──
    const { namePrefix } = generateCode;

    const allAdmins = await Admin.find({
      ...(superAdminRole ? { role: { $ne: superAdminRole._id } } : {}),
    }).populate('role', 'name isSystem');

    for (const admin of allAdmins) {
      if (admin.role?.isSystem) continue;  // skip Super Admin
      const prefix = namePrefix(admin.firstName || admin.email || 'ADMI');
      // Regenerate if missing OR if code doesn't start with first-name prefix
      const needsUpdate = !admin.code || !admin.code.startsWith(prefix);
      if (!needsUpdate) continue;
      const newCode = await generateCode(Admin, prefix);
      await Admin.updateOne({ _id: admin._id }, { code: newCode });
      console.log(`[codes] Admin "${admin.firstName}" → ${newCode}`);
    }

    // ── Institutions & Partners ──────────────────────────────────
    for (const { Model, prefix, label } of [
      { Model: Institution, prefix: 'INST', label: 'Institution' },
      { Model: Partner,     prefix: 'PART', label: 'Partner' },
    ]) {
      const missing = await Model.find({ $or: [{ code: null }, { code: { $exists: false } }] });
      for (const doc of missing) {
        doc.code = await generateCode(Model, prefix);
        await Model.updateOne({ _id: doc._id }, { code: doc.code });
        console.log(`[codes] ${label} "${doc.name || doc.organizationName}" → ${doc.code}`);
      }
    }
  } catch (err) {
    console.warn('[codes] Auto-backfill error:', err.message);
  }
}

app.listen(PORT, "0.0.0.0", () => {
  const os      = require("os");
  const nets    = Object.values(os.networkInterfaces()).flat();
  const localIP = (nets.find(n => n.family === "IPv4" && !n.internal) || {}).address || "YOUR_IP";

  console.log("");
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║         VED Foundation — Server Running              ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║  API      → http://localhost:${PORT}/api              `);
  console.log(`║  Health   → http://localhost:${PORT}/api/health       `);
  console.log("║                                                      ║");
  console.log("║  ── Student Registration Link ──────────────────  ║");
  console.log(`║  Local    → http://localhost:${PORT}/register         `);
  console.log(`║  Network  → http://${localIP}:${PORT}/register  `);
  console.log("║                                                      ║");
  console.log("║  Share the Network link with students on             ║");
  console.log("║  the same WiFi / LAN network.                        ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("");

  // ── Seed default roles (Admin + Associate Partner) ────────────
  seedDefaultRoles();

  // ── Backfill unique codes for any records missing them ────────
  autoBackfillCodes();

  // ── Schedule daily backup at 2:00 AM ──────────────────────
  cron.schedule("0 2 * * *", async () => {
    logger.info("🗄️  Running scheduled daily backup...");
    try {
      const { runBackup } = require("./scripts/backup");
      const result = await runBackup();
      if (result.success) logger.info(`✅ Backup complete: ${result.path}`);
      else logger.error(`❌ Backup failed: ${result.error}`);
    } catch (err) {
      logger.error(`Backup scheduler error: ${err.message}`);
    }
  }, { timezone: "Asia/Kolkata" });

  logger.info(`VED Foundation server started on port ${PORT} [${process.env.NODE_ENV || "development"}]`);
});

module.exports = app;