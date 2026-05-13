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

/* =========================
   CONNECT DATABASE
========================= */
connectDB();

/* =========================
   MIDDLEWARE
========================= */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (Postman, Thunder Client, file://, curl, etc.)
      if (!origin) {
        return callback(null, true);
      }

      const allowedOrigins = [
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:5501",
        "http://localhost:5501",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:8080",
        "http://localhost:8080",
        "https://vededufoundation.in",
        "https://www.vededufoundation.in",
        "http://vededufoundation.in",
        "http://www.vededufoundation.in"
      ];

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Allow any localhost/127.0.0.1 port during development
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
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

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Gzip compression (reduces response size by ~70%) ─────────
app.use(compression());

// ── HTTP request logging ──────────────────────────────────────
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
  // Also log to file in production
  if (process.env.NODE_ENV === "production") {
    app.use(morgan("combined", {
      stream: { write: msg => logger.http(msg.trim()) }
    }));
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
app.use("/shared.js",    (_, res) => res.sendFile(path.join(ROOT, "shared.js")));
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
  setHeaders: (res, filePath) => {
    if (filePath.startsWith(path.join(ROOT, "backend"))) {
      res.status(403).end(); // block backend folder
    }
  }
}));

// Public website pages
const servePage = (url, file) => {
  app.get(url, (_, res) => res.sendFile(path.join(ROOT, file)));
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
function safeRoute(path) {
  try {
    return require(path);
  } catch (err) {
    console.error(`\n❌ ROUTE LOAD ERROR in ${path}:\n   ${err.message}\n   ${err.stack?.split('\n')[1]||''}\n`);

    const router = express.Router();

    router.get("/", (req, res) => {
      res.json({
        success: true,
        message: `${path} route placeholder working`,
        data: []
      });
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
const whatsappRoutes     = safeRoute("./routes/whatsappRoutes");
const emailRoutes        = safeRoute("./routes/emailRoutes");
const referrerRoutes             = safeRoute("./routes/referrerRoutes");
const counsellingResponseRoutes  = safeRoute("./routes/counsellingResponseRoutes");
const workshopRoutes             = safeRoute("./routes/workshopRoutes");

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
app.use("/api/whatsapp",      whatsappRoutes);
app.use("/api/email",         emailRoutes);
app.use("/api/referrers",              referrerRoutes);
app.use("/api/counselling-responses",  counsellingResponseRoutes);
app.use("/api/workshops",              workshopRoutes);

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
      process.env.JWT_SECRET || "ved_secret_key",
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
      decoded = jwt.verify(token, process.env.JWT_SECRET || "ved_secret_key");
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