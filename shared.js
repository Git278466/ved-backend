'use strict';

(function () {

  /* ── Helpers ─────────────────────────────────────────────── */
  function getStudentToken() { return localStorage.getItem('ved_student_token') || ''; }
  function getStudentInfo() {
    try { return JSON.parse(localStorage.getItem('ved_student_info') || 'null'); }
    catch { return null; }
  }

  window.studentLogout = function () {
    localStorage.removeItem('ved_student_token');
    localStorage.removeItem('ved_student_info');
    window.location.href = 'index.html';
  };

  function escH(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Which page are we on? ───────────────────────────────── */
  var path = window.location.pathname.toLowerCase();
  var isLoginPage      = path.includes('login.html');
  var isRegisterPage   = path.includes('registeration.html');
  var isDashboardPage  = path.includes('dashboard.html');   // Admin or student
  var isAuthPage       = isLoginPage || isRegisterPage;

  /* ── NAVBAR HEIGHT CONSTANT ─────────────────────────────── */
  /* Read actual navbar height dynamically instead of fixed constant */
  var BAR_H  = 44;   // px  — student welcome bar height
  var NAV_H  = (function(){
    var nb = document.querySelector('.navbar');
    return nb ? nb.offsetHeight : 74;
  }());

  /* ── Apply offset so fixed/sticky elements don't overlap ─── */
  function applyOffsets(hasStudentBar) {
    var topOffset = hasStudentBar ? BAR_H : 0;

    /* Make navbar fixed so it always stays visible */
    var navbar = document.querySelector('.navbar');
    if (navbar) {
      navbar.style.position   = 'fixed';
      navbar.style.top        = topOffset + 'px';
      navbar.style.left       = '0';
      navbar.style.right      = '0';
      navbar.style.zIndex     = '99999';
      navbar.style.width      = '100%';
      navbar.style.maxWidth   = '100%';
      navbar.style.background = '#ffffff';
    }

    /* Navbar height is set to 70px in CSS for all pages — use directly.
       Do NOT use getBoundingClientRect/offsetHeight here: the navbar may
       not be painted yet and would return 0, overriding the correct value. */
    var NAV_H = 70;
    document.body.style.paddingTop = (topOffset + NAV_H) + 'px';
  }

  /* ── Load a partial HTML file into a placeholder div ─────── */
  function loadPartial(file, placeholderId, afterLoad) {
    var el = document.getElementById(placeholderId);
    if (!el) return;

    fetch(file)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        el.innerHTML = html;

        /* Re-run any <script> tags the HTML contains */
        el.querySelectorAll('script').forEach(function (old) {
          var s = document.createElement('script');
          s.textContent = old.textContent;
          document.body.appendChild(s);
        });

        if (typeof afterLoad === 'function') afterLoad();
      })
      .catch(function (e) { console.warn('Could not load ' + file, e); });
  }

  /* ── Wire up mobile hamburger menu ──────────────────────── */
  function wireMobileMenu() {
    var toggle   = document.getElementById('menuToggle');
    var links    = document.getElementById('navLinks');
    var backdrop = document.getElementById('navBackdrop');
    var closeBtn = document.getElementById('drawerClose');
    if (!toggle || !links) return;

    /* Is this a mobile (drawer) viewport? */
    function isMobile() { return window.innerWidth <= 767; }

    /* Update top position for tablet dropdown only */
    function updateMenuTop() {
      if (isMobile()) return; /* Drawer mode — top is always 0 */
      var navbar = document.querySelector('.navbar');
      if (navbar) {
        var rect = navbar.getBoundingClientRect();
        links.style.top = Math.round(rect.top + rect.height) + 'px';
      }
    }

    function openMenu() {
      links.classList.add('show');
      toggle.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');

      if (isMobile()) {
        /* Drawer mode: show backdrop + lock scroll */
        if (backdrop) {
          backdrop.style.display = 'block';
          /* Force reflow before adding class for transition */
          void backdrop.offsetWidth;
          backdrop.classList.add('active');
        }
        document.body.style.overflow = 'hidden';
      } else {
        updateMenuTop();
      }
    }

    function closeMenu() {
      links.classList.remove('show');
      toggle.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');

      if (backdrop) {
        backdrop.classList.remove('active');
        /* Hide after fade-out transition */
        setTimeout(function () {
          if (!backdrop.classList.contains('active')) {
            backdrop.style.display = 'none';
          }
        }, 320);
      }
      document.body.style.overflow = '';
    }

    /* Toggle on hamburger click */
    toggle.onclick = function (e) {
      e.stopPropagation();
      links.classList.contains('show') ? closeMenu() : openMenu();
    };

    /* Close button inside drawer */
    if (closeBtn) {
      closeBtn.onclick = function () { closeMenu(); };
    }

    /* Close when backdrop clicked */
    if (backdrop) {
      backdrop.onclick = function () { closeMenu(); };
    }

    /* Close on nav link click */
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { closeMenu(); });
    });

    /* Close on outside click (keyboard/pointer for tablet) */
    document.addEventListener('click', function (e) {
      if (
        links.classList.contains('show') &&
        !toggle.contains(e.target) &&
        !links.contains(e.target)
      ) {
        closeMenu();
      }
    });

    /* Close on Escape key */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && links.classList.contains('show')) closeMenu();
    });

    /* On resize: close menu and reset body scroll */
    window.addEventListener('resize', function () {
      if (links.classList.contains('show')) {
        closeMenu();
      }
    });
  }

  /* ── Build student welcome bar ───────────────────────────── */
  function buildStudentBar(info) {
    var name = info.fullName || info.name ||
      ((info.firstName || '') + ' ' + (info.lastName || '')).trim() ||
      info.email || 'Student';

    var bar = document.createElement('div');
    bar.id = 'ved-student-bar';
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0',
      'height:' + BAR_H + 'px',
      'z-index:9999',
      'background:linear-gradient(90deg,#0b63ce,#074a9d)',
      'color:#fff',
      'display:flex', 'align-items:center', 'justify-content:space-between',
      'padding:0 20px', 'gap:12px',
      'font-family:Inter,Arial,sans-serif', 'font-size:.86rem',
      'box-shadow:0 4px 14px rgba(11,99,206,.35)'
    ].join(';');

    bar.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;overflow:hidden;min-width:0">' +
        '<span style="font-size:18px;flex-shrink:0">&#127891;</span>' +
        '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
          'Welcome back, <strong>' + escH(name) + '</strong>! You are logged in.' +
        '</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-shrink:0">' +
        '<a href="student-dashboard.html" style="' +
          'background:#fff;color:#0b63ce;padding:5px 14px;border-radius:999px;' +
          'font-weight:900;font-size:.78rem;text-decoration:none;white-space:nowrap;">' +
          '&#128203; My Dashboard' +
        '</a>' +
        '<button onclick="studentLogout()" style="' +
          'background:rgba(255,255,255,.2);color:#fff;' +
          'border:1px solid rgba(255,255,255,.4);padding:5px 12px;' +
          'border-radius:999px;font-weight:700;font-size:.78rem;' +
          'cursor:pointer;font-family:inherit;white-space:nowrap;">' +
          'Logout' +
        '</button>' +
      '</div>';

    document.body.insertBefore(bar, document.body.firstChild);
  }

  /* ── MAIN ────────────────────────────────────────────────── */
  /* On auth pages: just load header and footer, skip everything else */
  if (isAuthPage) {
    loadPartial('header.html', 'header-placeholder', function () {
      wireMobileMenu();
    });
    loadPartial('footer.html', 'footer-placeholder');
    return;
  }

  /* Skip everything on admin/student dashboard pages */
  if (isDashboardPage) return;

  var token      = getStudentToken();
  var info       = getStudentInfo();
  var hasStudent = !!(token && info);

  /* Show student bar immediately (before header loads) */
  if (hasStudent) {
    buildStudentBar(info);
  }

  /* Load header → fix offsets → wire menu */
  var headerPlaceholder = document.getElementById('header-placeholder');

  if (headerPlaceholder) {
    /* Pages that load header.html dynamically */
    loadPartial('header.html', 'header-placeholder', function () {
      applyOffsets(hasStudent);
      wireMobileMenu();
    });
  } else {
    /* Pages with an inline header (e.g. index.html) — still need offsets + menu wiring */
    applyOffsets(hasStudent);
    wireMobileMenu();
  }

  /* Load footer */
  loadPartial('footer.html', 'footer-placeholder');

})();
