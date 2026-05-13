/**
 * ═══════════════════════════════════════════════════════════════
 *  VED Foundation Admin Dashboard — Frontend API Patch
 *  ───────────────────────────────────────────────────────────────
 *  INSTRUCTIONS:
 *  1. Open your dashboard.html
 *  2. Find the <script> block that starts with:
 *        const CONFIG = { BASE_URL: 'https://your-backend.com', ... }
 *  3. REPLACE the entire CONFIG block AND all the API/auth
 *     helper functions below it with this file's content.
 *  4. Make sure this code is INSIDE the existing <script> tag,
 *     NOT in a separate file (unless you add a src= reference).
 * ═══════════════════════════════════════════════════════════════
 */

/* ============================================================
   1. CONFIG
   ============================================================ */
const CONFIG = {
  // ↓ Change to your backend URL when deploying
  BASE_URL:  'http://localhost:5000/api',
  TOKEN_KEY: 'ved_admin_token',
  USER_KEY:  'ved_admin_user',
};

/* ============================================================
   2. TOKEN HELPERS
   ============================================================ */
const getToken  = ()       => localStorage.getItem(CONFIG.TOKEN_KEY) || '';
const saveToken = (token)  => localStorage.setItem(CONFIG.TOKEN_KEY, token);
const saveUser  = (user)   => localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user));
const getSavedUser = ()    => {
  try { return JSON.parse(localStorage.getItem(CONFIG.USER_KEY) || 'null'); }
  catch { return null; }
};
const clearAuth = () => {
  localStorage.removeItem(CONFIG.TOKEN_KEY);
  localStorage.removeItem(CONFIG.USER_KEY);
};

/* ============================================================
   3. CORE FETCH WRAPPER
   Every API call goes through this function.
   - Adds Authorization header automatically.
   - On 401 → clears token and shows login prompt.
   - Returns { ok, data, status } — never throws.
   ============================================================ */
async function apiFetch(method, path, body) {
  const url  = CONFIG.BASE_URL + path;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { 'Authorization': `Bearer ${getToken()}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res  = await fetch(url, opts);
    let data;
    try { data = await res.json(); }
    catch { data = { success: false, message: `HTTP ${res.status}` }; }

    if (res.status === 401) {
      // Token expired or invalid — force re-login
      clearAuth();
      showToast('warning', 'Session expired. Please log in again.');
      // If you have a login modal, open it here:
      // openLoginModal();
    }

    return { ok: res.ok, data, status: res.status };
  } catch (err) {
    // Network error (backend not running, CORS issue, etc.)
    console.warn(`API ${method} ${path} failed:`, err.message);
    return { ok: false, data: { success: false, message: err.message }, status: 0 };
  }
}

/* ============================================================
   4. AUTH — LOGIN
   Replace your existing login function with this one.
   ============================================================ */
async function loginAdmin(email, password) {
  const r = await apiFetch('POST', '/admins/login', { email, password });

  if (r.ok && r.data.success) {
    saveToken(r.data.token);
    saveUser(r.data.admin);
    return { success: true, admin: r.data.admin };
  }

  return {
    success: false,
    message: r.data?.message || 'Login failed. Check your credentials.',
  };
}

/* ============================================================
   5. AUTH — GET CURRENT USER (GET /api/auth/me)
   ============================================================ */
async function fetchCurrentUser() {
  if (!getToken()) return null;

  const r = await apiFetch('GET', '/auth/me');
  if (r.ok && r.data.success) {
    const user = r.data.data;
    saveUser(user);

    // Update the role state in the existing dashboard state object
    if (typeof state !== 'undefined') {
      state.currentUser     = user;
      state.currentUserRole = user.role || null;
    }

    updateUserUI(user);
    applySidebarPermissions();
    return user;
  }

  // Token invalid — clear and show warning
  if (r.status === 401) {
    clearAuth();
    showToast('warning', 'Session expired. Please log in again.');
  }
  return null;
}

/* ============================================================
   6. ROLES — fetch live from backend
   ============================================================ */
async function fetchRoles() {
  // Show loading skeleton while fetching
  if (document.getElementById('rolesGrid')) {
    showLoading('rolesGrid', 'Loading roles from server…');
  }

  const r = await apiFetch('GET', '/roles');

  if (r.ok && r.data.success) {
    if (typeof state !== 'undefined') {
      state.roles = r.data.data || [];
    }
    renderRolesPage();
    populateRoleDropdowns();
    renderOverviewRoleSummary();
    updateOverviewStats();
    return r.data.data;
  }

  // Only fall back to seed data if backend is genuinely unreachable
  if (r.status === 0) {
    if (typeof getSeedRoles === 'function') {
      if (typeof state !== 'undefined') state.roles = getSeedRoles();
      showToast('warning', 'Backend unreachable. Using offline data.', 'Start the backend server.');
    }
    renderRolesPage();
    populateRoleDropdowns();
    renderOverviewRoleSummary();
    updateOverviewStats();
  } else {
    showToast('error', r.data?.message || 'Failed to load roles.', `GET /api/roles → ${r.status}`);
  }

  return [];
}

/* ============================================================
   7. ADMINS — fetch live from backend
   ============================================================ */
async function fetchAdmins() {
  const r = await apiFetch('GET', '/admins');
  if (r.ok && r.data.success) {
    if (typeof state !== 'undefined') {
      state.admins = r.data.data || [];
    }
    renderAdminsTable();
    updateOverviewStats();
    return r.data.data;
  }

  if (r.status === 0 && typeof getSeedAdmins === 'function') {
    if (typeof state !== 'undefined') state.admins = getSeedAdmins();
  }
  renderAdminsTable();
  updateOverviewStats();
  return [];
}

/* ============================================================
   8. DASHBOARD STATS — GET /api/dashboard/stats
   ============================================================ */
async function fetchDashboardStats() {
  const r = await apiFetch('GET', '/dashboard/stats');
  if (r.ok && r.data.success) {
    const d = r.data.data;
    // Map backend fields → frontend stat card keys
    return {
      totalStudents:     d.totalStudents      || 0,
      pendingStudents:   d.pendingStudents     || 0,
      approvedStudents:  d.approvedStudents    || 0,
      certificatesIssued:d.certificatesIssued  || 0,
      totalAdmins:       d.totalAdmins         || 0,
      totalRoles:        d.totalRoles          || 0,
      totalInstitutions: d.totalInstitutions   || 0,
      totalPartners:     d.totalPartners       || 0,
      monthlyTrend:      d.monthlyTrend        || [],
    };
  }
  return null;
}

/* ============================================================
   9. STUDENTS — fetch live from backend
   ============================================================ */
async function fetchStudents(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r  = await apiFetch('GET', `/students${qs ? '?' + qs : ''}`);
  if (r.ok && r.data.success) {
    return { students: r.data.data || [], total: r.data.total || 0 };
  }
  showToast('error', r.data?.message || 'Failed to load students.', 'GET /api/students');
  return { students: [], total: 0 };
}

/* ============================================================
   10. ATTENDANCE — fetch live from backend
   ============================================================ */
async function fetchAttendance(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r  = await apiFetch('GET', `/attendance${qs ? '?' + qs : ''}`);
  if (r.ok && r.data.success) {
    return { records: r.data.data || [], total: r.data.total || 0 };
  }

  if (r.status === 403) {
    // Surface the exact error so the UI can show a proper message
    showToast('error', r.data?.message || 'Access denied to attendance data.');
    return { records: [], total: 0, error: r.data?.message };
  }

  showToast('error', r.data?.message || 'Failed to load attendance.', 'GET /api/attendance');
  return { records: [], total: 0 };
}

/* ============================================================
   11. LOGOUT
   ============================================================ */
function logoutAdmin() {
  clearAuth();
  if (typeof state !== 'undefined') {
    state.currentUser     = null;
    state.currentUserRole = null;
    state.roles           = [];
    state.admins          = [];
  }
  showToast('success', 'Logged out successfully.');
  // Reload page or redirect to login
  setTimeout(() => window.location.reload(), 800);
}

/* ============================================================
   12. PERMISSION HELPER
   Works with the role object returned by the backend.
   Compatible with the existing canDo() function in the dashboard.
   ============================================================ */
function canDo(module, action) {
  let role = null;

  // Try state.currentUserRole first (set after login)
  if (typeof state !== 'undefined' && state.currentUserRole) {
    role = state.currentUserRole;
  } else {
    // Fallback: read from localStorage (survives page refresh)
    const saved = getSavedUser();
    role = saved?.role || null;
  }

  if (!role) return false;

  // Super Admin always passes
  if (role.isSystem && role.name === 'Super Admin') return true;

  const permission = `${module}.${action}`;
  return Array.isArray(role.permissions) && role.permissions.includes(permission);
}

/* ============================================================
   13. INIT — replaces the existing init() function
   ============================================================ */
async function init() {
  try {
    // ── Step 1: Try to restore user from localStorage
    //            so the UI renders immediately without a flash
    const cachedUser = getSavedUser();
    if (cachedUser && getToken()) {
      if (typeof state !== 'undefined') {
        state.currentUser     = cachedUser;
        state.currentUserRole = cachedUser.role || null;
      }
      updateUserUI(cachedUser);
    }

    // ── Step 2: Load roles (needed for permission checks + dropdowns)
    await fetchRoles();

    // ── Step 3: Verify token + get fresh user data from backend
    if (getToken()) {
      await fetchCurrentUser();
    } else {
      // No token — still render with seed roles so UI isn't blank
      if (typeof state !== 'undefined' && !state.roles.length) {
        state.roles = typeof getSeedRoles === 'function' ? getSeedRoles() : [];
      }
    }

    // ── Step 4: Load admins list
    await fetchAdmins();

    // ── Step 5: Overview stats — try live backend first
    await updateOverviewStats();

    // ── Step 6: Apply sidebar permissions
    applySidebarPermissions();

  } catch (err) {
    console.error('init() error:', err);
    showToast('warning', 'Some dashboard data could not be loaded.', err.message);
  }
}

/* ============================================================
   14. OVERRIDE updateOverviewStats to use live backend data
   Paste this AFTER (and it replaces) the existing
   updateOverviewStats function in your dashboard.html
   ============================================================ */
async function updateOverviewStats() {
  const stats = await fetchDashboardStats();

  let totalStudents = 0, pendingStudents = 0, approvedStudents = 0,
      certIssued = 0, totalAdmins = 0, totalRoles = 0,
      institutions = 0, partners = 0;

  if (stats) {
    // Live data from backend
    totalStudents   = stats.totalStudents;
    pendingStudents = stats.pendingStudents;
    approvedStudents= stats.approvedStudents;
    certIssued      = stats.certificatesIssued;
    totalAdmins     = stats.totalAdmins;
    totalRoles      = stats.totalRoles;
    institutions    = stats.totalInstitutions;
    partners        = stats.totalPartners;

    // Render monthly trend chart from live data
    if (stats.monthlyTrend && stats.monthlyTrend.length) {
      renderLiveBarChart(stats.monthlyTrend);
    } else {
      renderBarChart();
    }
  } else {
    // Fallback: count from local state
    if (typeof state !== 'undefined') {
      totalAdmins = state.admins?.length || 0;
      totalRoles  = state.roles?.length  || 0;
    }
    renderBarChart();
  }

  // Update pending badge in sidebar
  const badgeEl = document.getElementById('pendingBadge');
  if (badgeEl) badgeEl.textContent = pendingStudents;

  const cards = [
    { label:'Total Students',    value:totalStudents,   icon:'fa-user-graduate', color:'blue',   trend:'+12%' },
    { label:'Pending Approvals', value:pendingStudents, icon:'fa-clock',         color:'orange', trend:'', down:true },
    { label:'Approved Students', value:approvedStudents,icon:'fa-circle-check',  color:'green',  trend:'+8%' },
    { label:'Certs Issued',      value:certIssued,      icon:'fa-certificate',   color:'purple', trend:'+5%' },
    { label:'Total Admins',      value:totalAdmins,     icon:'fa-users-gear',    color:'teal',   trend:'' },
    { label:'Total Roles',       value:totalRoles,      icon:'fa-shield-halved', color:'blue',   trend:'' },
    { label:'Institutions',      value:institutions,    icon:'fa-building-columns',color:'indigo',trend:'+2%' },
    { label:'Partners',          value:partners,        icon:'fa-handshake',     color:'gold',   trend:'+1%' },
  ];

  const grid = document.getElementById('overviewStats');
  if (grid) {
    grid.innerHTML = cards.map(c => `
      <div class="stat-card ${c.color}">
        <div class="stat-icon"><i class="fa-solid ${c.icon}"></i></div>
        <div>
          <div class="stat-label">${c.label}</div>
          <div class="stat-value">${c.value.toLocaleString()}</div>
        </div>
        ${c.trend ? `
        <div class="stat-meta ${c.down ? 'down' : ''}">
          <i class="fa-solid ${c.down ? 'fa-arrow-down' : 'fa-arrow-up'}"></i> ${c.trend} this month
        </div>` : ''}
      </div>`).join('');
  }

  renderActivityList();
}

/* ============================================================
   15. renderLiveBarChart — uses data from GET /api/dashboard/stats
   ============================================================ */
function renderLiveBarChart(monthlyTrend) {
  const container = document.getElementById('barChart');
  if (!container || !monthlyTrend.length) return;

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const values = monthlyTrend.map(m => m.count);
  const labels = monthlyTrend.map(m => months[(m._id.month || 1) - 1]);
  const max    = Math.max(...values, 1);

  container.innerHTML = values.map((v, i) => `
    <div class="bar-item">
      <div class="bar${i === values.length - 1 ? ' orange' : ''}"
           style="height:${Math.round(v / max * 90)}px" title="${v} students"></div>
      <div class="bar-label">${labels[i]}</div>
    </div>`).join('');
}

/* ============================================================
   16. ROLE CRUD — create / update / delete via live API
   These replace the existing createRole / updateRole / deleteRole
   ============================================================ */
async function createRole(payload) {
  const r = await apiFetch('POST', '/roles', payload);
  if (r.ok && r.data.success) {
    if (typeof state !== 'undefined') state.roles.unshift(r.data.data);
    showToast('success', 'Role created successfully!');
  } else {
    showToast('error', r.data?.message || 'Failed to create role.');
  }
  renderRolesPage();
  populateRoleDropdowns();
  renderOverviewRoleSummary();
  updateOverviewStats();
}

async function updateRole(id, payload) {
  const r = await apiFetch('PUT', `/roles/${id}`, payload);
  if (r.ok && r.data.success) {
    if (typeof state !== 'undefined') {
      const idx = state.roles.findIndex(ro => ro._id === id);
      if (idx > -1) state.roles[idx] = r.data.data;
    }
    showToast('success', 'Role updated!');
  } else {
    showToast('error', r.data?.message || 'Failed to update role.');
  }
  renderRolesPage();
  populateRoleDropdowns();
}

async function deleteRole(id) {
  const role = typeof state !== 'undefined'
    ? state.roles.find(r => r._id === id)
    : null;

  if (role?.isSystem) {
    showToast('error', 'System roles cannot be deleted.');
    return;
  }

  const r = await apiFetch('DELETE', `/roles/${id}`);
  if (r.ok && r.data.success) {
    showToast('success', 'Role deleted.');
    if (typeof state !== 'undefined') {
      state.roles = state.roles.filter(ro => ro._id !== id);
    }
  } else {
    showToast('error', r.data?.message || 'Failed to delete role.');
  }
  renderRolesPage();
  populateRoleDropdowns();
  renderOverviewRoleSummary();
  updateOverviewStats();
}

/* ============================================================
   17. ADMIN CRUD — live API
   ============================================================ */
async function createAdmin(payload) {
  const r = await apiFetch('POST', '/admins', payload);
  if (r.ok && r.data.success) {
    if (typeof state !== 'undefined') state.admins.unshift(r.data.data);
    showToast('success', 'Admin created!');
    closeModal('adminModal');
  } else {
    showToast('error', r.data?.message || 'Failed to create admin.');
  }
  renderAdminsTable();
  updateOverviewStats();
}

async function updateAdminRecord(id, payload) {
  const r = await apiFetch('PUT', `/admins/${id}`, payload);
  if (r.ok && r.data.success) {
    if (typeof state !== 'undefined') {
      const idx = state.admins.findIndex(a => a._id === id);
      if (idx > -1) state.admins[idx] = r.data.data;
    }
    showToast('success', 'Admin updated!');
    closeModal('adminModal');
  } else {
    showToast('error', r.data?.message || 'Failed to update admin.');
  }
  renderAdminsTable();
}

async function deleteAdminRecord(id) {
  const r = await apiFetch('DELETE', `/admins/${id}`);
  if (r.ok && r.data.success) {
    if (typeof state !== 'undefined') {
      state.admins = state.admins.filter(a => a._id !== id);
    }
    showToast('success', 'Admin deleted.');
  } else {
    showToast('error', r.data?.message || 'Failed to delete admin.');
  }
  renderAdminsTable();
  updateOverviewStats();
}

async function toggleAdminStatus(id, newStatus) {
  const r = await apiFetch('PATCH', `/admins/${id}/status`, { status: newStatus });
  if (r.ok && r.data.success) {
    if (typeof state !== 'undefined') {
      const adm = state.admins.find(a => a._id === id);
      if (adm) adm.status = newStatus;
    }
    showToast('success', `Admin ${newStatus}.`);
  } else {
    showToast('error', r.data?.message || 'Failed to update status.');
  }
  renderAdminsTable();
}

async function confirmChangeRole() {
  if (typeof state === 'undefined') return;
  const id   = document.getElementById('changeRoleUserId')?.value;
  const role = document.getElementById('changeRoleSelect')?.value;
  if (!id || !role) return;

  const r = await apiFetch('PATCH', `/admins/${id}/role`, { role });
  if (r.ok && r.data.success) {
    const adm = state.admins.find(a => a._id === id);
    if (adm) adm.role = state.roles.find(ro => ro._id === role) || adm.role;
    showToast('success', 'Role changed!');
    closeModal('changeRoleModal');
  } else {
    showToast('error', r.data?.message || 'Failed to change role.');
  }
  renderAdminsTable();
}

/* ============================================================
   END OF FRONTEND PATCH
   ============================================================ */
