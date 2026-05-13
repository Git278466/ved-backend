# VED Foundation Backend — Setup & Fix Guide

## Root Causes Fixed

| # | Problem | Fix Applied |
|---|---|---|
| 1 | `GET /api/roles` failing | All routes now in correct paths |
| 2 | "No role assigned" on Attendance | `roleMiddleware` now handles missing role with a clear message; Super Admin bypasses all checks |
| 3 | Admin name shows but role/permissions missing | `authMiddleware` now populates the full role doc (with permissions) on every request |
| 4 | Demo data shown instead of live data | `frontend-patch.js` replaces all fake-data fallbacks with live API calls |
| 5 | CORS errors | CORS now allows localhost on any port during development |
| 6 | Login route wrong | Login is at `POST /api/admins/login` (and a `/api/auth/me` alias exists) |

---

## Quick Start

```bash
# 1. Enter backend folder
cd ved-backend

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env
# Edit .env — at minimum set MONGO_URI and JWT_SECRET

# 4. Seed the database (ALWAYS run this first)
npm run seed

# 5. Start the server
npm run dev
```

The seed script creates:
- **Super Admin** role (all 39 permissions)
- **Admin** role (standard operations)
- **Institution** role (scoped data entry)
- **Associate Partner** role (view only)
- Super Admin account: `superadmin@vedfoundation.org` / `Admin@1234`
- Sample Admin: `admin@vedfoundation.org` / `Admin@1234`
- 80 sample students, institutions, partners, donations

---

## Frontend Fix (dashboard.html)

### Step 1 — Replace CONFIG block

In your `dashboard.html`, find:
```javascript
const CONFIG = {
  BASE_URL: 'https://your-backend.com',
  ...
};
```
Replace it with:
```javascript
const CONFIG = {
  BASE_URL:  'http://localhost:5000/api',
  TOKEN_KEY: 'ved_admin_token',
  USER_KEY:  'ved_admin_user',
};
```

### Step 2 — Paste the patch code

Copy the entire contents of `frontend-patch.js` and paste it into your dashboard's `<script>` block, **after** the `CONFIG` block but **before** the `init()` call at the bottom.

The patch file replaces these functions:
- `apiFetch()` — adds auto Bearer token header
- `loginAdmin()` / auth helpers
- `fetchCurrentUser()` — loads role + permissions from backend
- `fetchRoles()` — live from MongoDB (no demo data)
- `fetchAdmins()` — live from MongoDB
- `updateOverviewStats()` — pulls from `GET /api/dashboard/stats`
- `createRole()`, `updateRole()`, `deleteRole()` — live CRUD
- `createAdmin()`, `updateAdminRecord()`, `deleteAdminRecord()` — live CRUD
- `canDo()` — works with backend role object
- `init()` — correct initialization order

### Step 3 — Wire up login form

If your dashboard has a login form, update its submit handler:
```javascript
async function handleLoginSubmit(e) {
  e.preventDefault();
  const email    = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  const result = await loginAdmin(email, password);
  if (result.success) {
    closeModal('loginModal');  // or redirect
    await init();              // reload all data with the new token
  } else {
    showToast('error', result.message);
  }
}
```

### Step 4 — Wire up logout button

```javascript
document.getElementById('logoutBtn')?.addEventListener('click', logoutAdmin);
```

---

## API Endpoint Reference

| Method | Endpoint | Auth | Permission |
|---|---|---|---|
| POST | `/api/admins/login` | ✗ | – |
| GET | `/api/auth/me` | ✓ | – |
| GET | `/api/roles` | ✓ | `roles.view` |
| GET | `/api/admins` | ✓ | `admin_management.view` |
| GET | `/api/students` | ✓ | `students.view` |
| GET | `/api/attendance` | ✓ | `attendance.view` |
| GET | `/api/certificates` | ✓ | `certificates.view` |
| GET | `/api/institutions` | ✓ | `institutions.view` |
| GET | `/api/partners` | ✓ | `associate_partners.view` |
| GET | `/api/donations` | ✓ | `donations.view` |
| GET | `/api/dashboard/stats` | ✓ | `dashboard.view` |
| GET | `/api/reports/overview` | ✓ | `reports.view` |
| GET | `/api/filter-presets` | ✓ | `filter_presets.view` |

---

## Troubleshooting

**"Using local demo data" still showing**
→ You haven't pasted `frontend-patch.js` into dashboard.html yet.
→ OR the server isn't running on port 5000.

**"No role assigned to this account"**
→ Run `npm run seed` — this ensures the Super Admin role is attached to your account.
→ OR the admin in MongoDB has a null/missing `role` field. Use MongoDB Compass or:
```bash
# Fix in Mongo shell:
db.admins.updateOne(
  { email: 'superadmin@vedfoundation.org' },
  { $set: { role: db.roles.findOne({ name: 'Super Admin' })._id } }
)
```

**CORS error in browser**
→ Add your frontend origin to `ALLOWED_ORIGINS` in `.env`:
```
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:5500
```
→ If opening dashboard.html directly from the filesystem (`file://`), the `origin` will be null — this is already allowed by the server.

**`POST /api/auth/login` 404**
→ The login endpoint is at `POST /api/admins/login`, not `/api/auth/login`.
→ The `frontend-patch.js` already uses the correct path.

**Attendance page: "Could not load data"**
→ The admin's role doesn't have `attendance.view`.
→ Run `npm run seed` to reset roles with correct permissions.
→ OR manually add the permission in MongoDB / Roles UI.
