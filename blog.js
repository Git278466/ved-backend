/* =============================================================
   VED FOUNDATION — blog.js
   Hero Slider · Category Filter · Search · Back-to-Top
   ============================================================= */

(function () {
  'use strict';

  /* ── HERO SLIDER ──────────────────────────────────────── */
  (function initSlider() {
    var slider   = document.getElementById('blogSlider');
    if (!slider) return;
    var slides   = slider.querySelectorAll('.bslide');
    var dots     = slider.querySelectorAll('.bs-dot');
    var fill     = document.getElementById('bsProgFill');
    var prev     = document.getElementById('bsPrev');
    var next     = document.getElementById('bsNext');
    if (!slides.length) return;

    var total = slides.length, cur = 0, playing = true;
    var INTERVAL = 5000, timer = null, raf = null, ts0 = null;

    function show(idx) {
      slides[cur].classList.remove('bs-on');
      dots[cur].classList.remove('bs-on');
      cur = ((idx % total) + total) % total;
      slides[cur].classList.add('bs-on');
      dots[cur].classList.add('bs-on');
    }

    function startProg() {
      cancelAnimationFrame(raf);
      if (fill) fill.style.width = '0%';
      ts0 = null;
      raf = requestAnimationFrame(function tick(t) {
        if (!playing) return;
        if (!ts0) ts0 = t;
        var p = Math.min((t - ts0) / INTERVAL * 100, 100);
        if (fill) fill.style.width = p + '%';
        if (p < 100) raf = requestAnimationFrame(tick);
      });
    }

    function start() {
      clearInterval(timer);
      startProg();
      timer = setInterval(function () {
        if (playing) { show(cur + 1); startProg(); }
      }, INTERVAL);
    }

    function pause()  { playing = false; clearInterval(timer); cancelAnimationFrame(raf); }
    function resume() { playing = true;  start(); }

    if (prev) prev.addEventListener('click', function () { show(cur - 1); pause(); setTimeout(resume, 7000); });
    if (next) next.addEventListener('click', function () { show(cur + 1); pause(); setTimeout(resume, 7000); });

    dots.forEach(function (d) {
      d.addEventListener('click', function () {
        show(parseInt(d.dataset.idx, 10));
        pause(); setTimeout(resume, 7000);
      });
    });

    var tx = 0;
    slider.addEventListener('touchstart', function (e) { tx = e.touches[0].clientX; }, { passive: true });
    slider.addEventListener('touchend',   function (e) {
      var dx = e.changedTouches[0].clientX - tx;
      if (Math.abs(dx) > 44) { show(dx < 0 ? cur + 1 : cur - 1); pause(); setTimeout(resume, 7000); }
    }, { passive: true });

    slider.addEventListener('mouseenter', pause);
    slider.addEventListener('mouseleave', resume);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause(); else resume();
    });

    start();
  }());

  /* ── FILTER + SEARCH ──────────────────────────────────── */
  var activeCat = 'all', query = '';

  function applyFilters() {
    var grid  = document.getElementById('blogGrid');
    if (!grid) return;
    var cards = grid.querySelectorAll('.blog-card');
    var vis   = 0, noRes = document.getElementById('noResults');

    cards.forEach(function (c) {
      var catOk  = activeCat === 'all' || c.dataset.cat === activeCat;
      var srchOk = !query || (c.dataset.title || '').toLowerCase().includes(query.toLowerCase());
      var show   = catOk && srchOk;
      c.style.display = show ? '' : 'none';
      if (show) vis++;
    });

    if (noRes) noRes.style.display = vis === 0 ? 'block' : 'none';
  }

  /* category bar */
  var catBar = document.getElementById('catBar');
  if (catBar) {
    catBar.addEventListener('click', function (e) {
      var btn = e.target.closest('.cf-btn');
      if (!btn) return;
      catBar.querySelectorAll('.cf-btn').forEach(function (b) { b.classList.remove('cf-on'); });
      btn.classList.add('cf-on');
      activeCat = btn.dataset.cat;
      applyFilters();
      var sec = document.getElementById('blog-listing');
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  window.filterCat = function (cat) {
    activeCat = cat;
    if (catBar) {
      catBar.querySelectorAll('.cf-btn').forEach(function (b) {
        b.classList.toggle('cf-on', b.dataset.cat === cat);
      });
    }
    applyFilters();
    var sec = document.getElementById('blog-listing');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.runSearch = function (q) {
    query = (q || '').trim();
    applyFilters();
    var sec = document.getElementById('blog-listing');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* sort */
  var sel = document.getElementById('sortSelect');
  if (sel) {
    sel.addEventListener('change', function () {
      var grid  = document.getElementById('blogGrid');
      if (!grid) return;
      var cards = Array.from(grid.querySelectorAll('.blog-card'));
      if (sel.value === 'quick') cards.sort(function (a, b) { return (parseInt(a.dataset.read)||5)-(parseInt(b.dataset.read)||5); });
      cards.forEach(function (c) { grid.appendChild(c); });
    });
  }

  /* load more */
  var lmBtn = document.getElementById('loadMoreBtn');
  if (lmBtn) {
    lmBtn.addEventListener('click', function () {
      lmBtn.disabled = true;
      lmBtn.textContent = 'Loading…';
      setTimeout(function () {
        lmBtn.innerHTML = 'All articles loaded — <a href="registeration.html" style="color:#0B3D91">join a workshop!</a>';
      }, 900);
    });
  }

  /* ── BACK TO TOP ─────────────────────────────────────── */
  var btt = document.getElementById('bttBtn');
  if (btt) {
    window.addEventListener('scroll', function () { btt.classList.toggle('show', window.scrollY > 400); }, { passive: true });
    btt.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  /* ── NEWSLETTER ─────────────────────────────────────── */
  window.sbNl = function (e) {
    e.preventDefault();
    var ok  = e.target.parentElement.querySelector('.sw-nl-ok');
    var btn = e.target.querySelector('button[type=submit]');
    if (btn) { btn.textContent = '…'; btn.disabled = true; }
    setTimeout(function () {
      if (ok)  { ok.style.display = 'block'; }
      if (btn) { btn.style.display = 'none'; }
      e.target.reset();
    }, 700);
  };

  /* ── SMOOTH ANCHORS ─────────────────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href').slice(1);
      var el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
    });
  });

}());
