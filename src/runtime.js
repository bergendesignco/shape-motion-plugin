/*!
 * Shape Motion for Squarespace - runtime (visitor code)
 * https://github.com/bergendesignco/shape-motion-plugin
 *
 * Install once, in Settings > Advanced > Code Injection > FOOTER:
 *   <script src="https://cdn.jsdelivr.net/gh/bergendesignco/shape-motion-plugin@v0.1.0/src/runtime.js"></script>
 * Add data-editor="off" to that tag to never load the editor.
 *
 * Animation settings are saved by the editor as JSON in the page's Header Code Injection:
 *   <!-- SHAPE-MOTION-START -->
 *   <script type="application/json" data-shape-motion="page">{ "version": 1, "elements": { ... } }</script>
 *   <!-- SHAPE-MOTION-END -->
 * Pages without settings stop here: GSAP isn't even loaded (unless the editor is needed).
 */
(function () {
  "use strict";
  if (window.ShapeMotion) return; // included twice

  var VERSION = "0.1.0";
  var GSAP_CDN = "https://cdn.jsdelivr.net/npm/gsap@3.14.1/dist/";
  var SCRIPT = document.currentScript;
  var BASE = SCRIPT && SCRIPT.src ? SCRIPT.src.replace(/[^\/]*$/, "") : "";
  var EDITOR_OFF = SCRIPT && SCRIPT.getAttribute("data-editor") === "off";

  var SETTING_KEYS = ["path", "duration", "delay", "ease", "playback", "repeatDelay", "start", "end",
    "home", "autoRotate", "rotateOffset", "anchor",
    "trigger", "appearAt", "replay", "scrub", "scrollFollow", "scrollSpeed", "hoverLeave", "clickMode"];
  var DEFAULT_SETTINGS = {
    path: "M0,0 C100,-60 200,60 300,0",
    duration: 4, delay: 0, ease: "power1.inOut", playback: "yoyo", repeatDelay: 0.5,
    start: 0, end: 1, home: "start", autoRotate: false, rotateOffset: 0, anchor: "0% 0%",
    // trigger: "load" | "appear" | "scroll" | "hover" | "click" (older settings without it = "load")
    trigger: "load",
    appearAt: "top 85%",   // appear: ScrollTrigger start (block top vs. viewport)
    replay: "once",        // appear: "once" | "every" | "reverse"
    scrub: 0.5,            // scroll: smoothing in seconds (0 = locked to the scrollbar)
    scrollFollow: "page",  // scroll: "page" (moves down with the page, keeps its spot on screen) | "path"
    scrollSpeed: 1,        // scroll "path": path distance per scrolled pixel (1 = as fast as you scroll)
    hoverLeave: "reverse", // hover: "reverse" (go back) | "finish"
    clickMode: "toggle"    // click: "toggle" (there and back) | "replay"
  };

  var SM = window.ShapeMotion = {
    version: VERSION,
    base: BASE,
    SHAPE_SELECTOR: '[data-sqsp-block="shape"]',
    SETTING_KEYS: SETTING_KEYS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    data: { page: { version: 1, elements: {} }, site: { version: 1, elements: {} } },
    editor: null,     // set by editor.js: { editingId(), start(phone) }
    gsap: null
  };

  /* ---------------- settings ---------------- */

  function readTags() {
    var tags = document.querySelectorAll('script[type="application/json"][data-shape-motion]');
    Array.prototype.forEach.call(tags, function (tag) {
      var scope = tag.getAttribute("data-shape-motion") === "site" ? "site" : "page";
      try {
        var parsed = JSON.parse(tag.textContent);
        if (parsed && parsed.elements) SM.data[scope] = parsed;
      } catch (e) {
        console.warn("[shape motion] couldn't read " + scope + " settings", e);
      }
    });
  }

  // Page settings win over site-wide settings for the same element.
  SM.elements = function () {
    var out = {};
    [SM.data.site.elements, SM.data.page.elements].forEach(function (els) {
      Object.keys(els || {}).forEach(function (id) { out[id] = els[id]; });
    });
    return out;
  };

  // Settings for the current layout, or null when the element should stay still.
  SM.settingsFor = function (cfg, phone) {
    if (!cfg || !cfg.desktop) return null;
    if (!phone) return cfg.desktop;
    if (cfg.mobile === "same") return cfg.desktop;
    if (cfg.mobile && typeof cfg.mobile === "object") return cfg.mobile;
    return null;
  };

  // The motion tween itself. `extra` overrides/adds tween vars (used by triggers).
  SM.buildTween = function (el, c, extra) {
    var gsap = SM.gsap;
    var toHome = c.home === "end";
    gsap.set(el, { transformOrigin: c.anchor });
    var vars = {
      motionPath: {
        path: c.path,
        start: toHome ? c.end : c.start,
        end: toHome ? c.start : c.end,
        autoRotate: c.autoRotate ? (c.rotateOffset || true) : false
      },
      duration: c.duration,
      delay: c.delay,
      ease: c.ease,
      repeat: c.playback === "once" ? 0 : -1,
      yoyo: c.playback === "yoyo",
      repeatDelay: c.repeatDelay
    };
    Object.keys(extra || {}).forEach(function (k) { vars[k] = extra[k]; });
    return gsap.to(el, vars);
  };

  // The block's layout box. It doesn't move when the block is animated, so it's the stable target
  // for scroll positions and hover/click (events on the moving block bubble up to it too).
  SM.anchorBox = function (el) {
    return el.closest(".fe-block") || el.parentElement || el;
  };

  // Length (px) of the part of the path the shape travels.
  SM.pathLength = function (c) {
    var MP = window.MotionPathPlugin;
    try {
      var raw = MP.getRawPath(c.path);
      MP.cacheRawPathMeasurements(raw);
      return raw.totalLength * Math.abs((c.end == null ? 1 : c.end) - (c.start || 0));
    } catch (e) {
      return 500;
    }
  };

  // Scroll mapping for scroll-driven animations: turns "how far through the scroll" (0-1) into
  // "how far along the path" (0-1), plus how many pixels of scroll the whole trip takes.
  // "page": the shape's vertical position tracks the scroll 1:1 (it keeps its spot on screen while
  //   following the curve sideways). Uses the lowest point reached so far, so a path that doubles
  //   back up holds still instead of jumping.
  // "path": even speed along the path, pathLength / scrollSpeed pixels of scroll.
  SM.scrollMap = function (c) {
    var MP = window.MotionPathPlugin;
    var from = c.home === "end" ? c.end : c.start, to = c.home === "end" ? c.start : c.end;
    if (from == null) from = 0;
    if (to == null) to = 1;
    var linear = function (s) { return s; };
    var byPath = { distance: SM.pathLength(c) / (c.scrollSpeed > 0 ? c.scrollSpeed : 1), progressAt: linear };
    if (c.scrollFollow === "path") return byPath;
    try {
      var raw = MP.getRawPath(c.path);
      MP.cacheRawPathMeasurements(raw);
      var N = 200, ys = [], y0 = null, maxY = 0, i, y;
      for (i = 0; i <= N; i++) {
        y = MP.getPositionOnPath(raw, from + (to - from) * (i / N)).y;
        if (y0 === null) y0 = y;
        maxY = Math.max(maxY, y - y0);
        ys.push(maxY); // lowest point reached so far (never goes back up)
      }
      var span = ys[N];
      if (span < 20) return byPath; // path doesn't really go down: fall back to even speed
      return {
        distance: span,
        progressAt: function (s) {
          var target = s * span;
          for (var j = 1; j <= N; j++) {
            if (ys[j] >= target) {
              var a = ys[j - 1], b = ys[j];
              return (j - 1 + (b > a ? (target - a) / (b - a) : 0)) / N;
            }
          }
          return 1;
        }
      };
    } catch (e) {
      return byPath;
    }
  };

  SM.needsScrollTrigger = function (c) {
    var t = c && c.trigger;
    return t === "appear" || t === "scroll";
  };

  // Run one element's animation with its trigger. Returns a stop() that undoes everything.
  SM.animate = function (el, c) {
    var gsap = SM.gsap;
    var ST = window.ScrollTrigger;
    var trigger = c.trigger || "load";
    var box = SM.anchorBox(el);
    var single = { repeat: 0, yoyo: false }; // hover/click/scroll make one trip along the path
    var tween, st, off = [];

    function listen(type, fn) {
      box.addEventListener(type, fn);
      off.push(function () { box.removeEventListener(type, fn); });
    }

    if ((trigger === "appear" || trigger === "scroll") && SM.inSquarespaceEditor()) {
      // Scrolling inside the Squarespace editor frame isn't the real page scroll (GSAP extension QA
      // matrix T-047a), so scroll positions come out wrong there. Hold at the start of the path;
      // the editor panel previews these with its own controls.
      tween = SM.buildTween(el, c, { repeat: 0, yoyo: false, paused: true, immediateRender: true });
      return function stop() { tween.revert(); };
    }

    if ((trigger === "appear" || trigger === "scroll") && !ST) {
      console.warn("[shape motion] ScrollTrigger not loaded; playing on load instead");
      trigger = "load";
    }

    if (trigger === "appear") {
      // Sit at the start of the path until it scrolls into view, then play (with its playback setting).
      tween = SM.buildTween(el, c, { paused: true, immediateRender: true });
      var replay = c.replay || "once";
      st = ST.create({
        trigger: box,
        start: c.appearAt || "top 85%",
        once: replay === "once",
        onEnter: function () { tween.restart(true); },
        onEnterBack: replay === "every" ? function () { tween.restart(true); } : null,
        onLeaveBack: replay === "reverse" ? function () { tween.reverse(); } : null
      });
    } else if (trigger === "scroll") {
      // Scroll drives the path. Starts once the shape's spot is on screen (clamp: right away if it's
      // visible at the top of the page) and lasts map.distance px of scroll, capped so it still
      // finishes at the bottom of the page. Always an even rate: no ease.
      var map = SM.scrollMap(c);
      tween = SM.buildTween(el, c, { repeat: 0, yoyo: false, delay: 0, ease: "none", paused: true, immediateRender: true });
      var lag = c.scrub > 0 ? c.scrub : 0;
      st = ST.create({
        trigger: box,
        start: "clamp(top bottom)",
        end: function (self) { return Math.min(self.start + Math.max(map.distance, 50), ST.maxScroll(window)); },
        invalidateOnRefresh: true,
        onUpdate: function (self) {
          var p = map.progressAt(self.progress);
          if (lag) gsap.to(tween, { progress: p, duration: lag, ease: "power3.out", overwrite: true });
          else tween.progress(p);
        },
        onRefresh: function (self) { tween.progress(map.progressAt(self.progress)); }
      });
    } else if (trigger === "hover") {
      tween = SM.buildTween(el, c, { repeat: 0, yoyo: false, paused: true, immediateRender: true });
      listen("mouseenter", function () {
        if (c.hoverLeave === "finish" && tween.progress() === 1) tween.restart(true);
        else tween.play();
      });
      if (c.hoverLeave !== "finish") listen("mouseleave", function () { tween.reverse(); });
    } else if (trigger === "click") {
      tween = SM.buildTween(el, c, { repeat: 0, yoyo: false, paused: true, immediateRender: true });
      var forward = false;
      box.style.cursor = "pointer";
      off.push(function () { box.style.cursor = ""; });
      listen("click", function () {
        if (c.clickMode === "replay") { tween.restart(true); return; }
        forward = !forward;
        if (forward) tween.play(); else tween.reverse();
      });
    } else {
      tween = SM.buildTween(el, c);
    }

    return function stop() {
      off.forEach(function (fn) { fn(); });
      if (st) st.kill();
      tween.revert(); // also kills a scrollTrigger attached to the tween
    };
  };

  /* ---------------- Squarespace context ---------------- */

  // Edit mode: the site (inside the editor's iframe) gets these body classes while editing.
  // (Don't use "sqs-edit-mode" - it's there even when not editing.)
  SM.isEditing = function () {
    var c = document.body.classList;
    return c.contains("sqs-edit-mode-active") || c.contains("sqs-is-page-editing");
  };

  // Running inside the Squarespace editor (iframe#sqs-site-frame on a /config page).
  SM.inSquarespaceEditor = inSquarespaceEditor;
  function inSquarespaceEditor() {
    if (window.top === window.self) return false;
    try {
      return /\/config(\/|$)/.test(window.top.location.pathname) || !!window.top.document.getElementById("sqs-site-frame");
    } catch (e) {
      return false; // cross-origin parent: not the Squarespace editor
    }
  }

  // Logged-in owner/contributor (Squarespace adds this attribute to <html>).
  function isLoggedIn() {
    return document.documentElement.hasAttribute("data-authenticated-account");
  }

  SM.wantEditor = function () {
    if (/[?&]mph\b/.test(location.search)) return true;
    return !EDITOR_OFF && (inSquarespaceEditor() || isLoggedIn());
  };

  // Phone layout. In the editor, trust its device view class; the frame can be narrow in desktop
  // view when side panels are open. On the live site (no class), use the 767px breakpoint.
  var PHONE_QUERY = window.matchMedia("(max-width: 767px)");
  SM.isPhone = function () {
    var c = document.body.classList;
    if (c.contains("sqs-device-view-phone")) return true;
    if (c.contains("sqs-device-view-desktop")) return false;
    return PHONE_QUERY.matches;
  };

  // Page ID, used by the editor to save to this page's header injection.
  SM.pageId = function () {
    var ctx = window.Static && window.Static.SQUARESPACE_CONTEXT;
    if (ctx && ctx.collection && ctx.collection.id) return ctx.collection.id;
    var m = (document.body.id || "").match(/^collection-([0-9a-f]{24})$/);
    return m ? m[1] : null;
  };

  /* ---------------- start / stop ---------------- */

  var running = null; // list of { el, stop } while active
  var waitingForLoad = false;

  function start() {
    if (running || SM.isEditing()) return;
    // The editor pins its path overlay to the page layout, so let the layout settle first.
    if (SM.editor && document.readyState !== "complete") {
      if (!waitingForLoad) {
        waitingForLoad = true;
        window.addEventListener("load", function () { waitingForLoad = false; start(); });
      }
      return;
    }
    var phone = SM.isPhone();
    var els = SM.elements();
    var editingId = SM.editor ? SM.editor.editingId() : null;
    running = [];
    Object.keys(els).forEach(function (id) {
      if (id === editingId) return; // the editor animates this one itself
      var el = document.getElementById(id); // looked up fresh: Squarespace can re-render blocks
      var s = el && SM.settingsFor(els[id], phone);
      if (!s) return;
      running.push({ el: el, stop: SM.animate(el, s) });
    });
    if (SM.editor) {
      try {
        running.push(SM.editor.start(phone));
      } catch (e) {
        console.error("[shape motion] editor failed; visitor animations still run", e);
      }
    }
  }

  function stop() {
    if (!running) return;
    running.forEach(function (r) {
      r.stop();
      if (r.el) SM.gsap.set(r.el, { clearProps: "transform,transformOrigin" }); // back to its layout spot
    });
    running = null;
  }

  SM.restart = function () {
    stop();
    start();
  };

  /* ---------------- boot ---------------- */

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("failed to load " + src)); };
      document.head.appendChild(s);
    });
  }

  function loadSequence(list) {
    return list.reduce(function (p, src) { return p.then(function () { return loadScript(src); }); }, Promise.resolve());
  }

  function boot() {
    readTags();
    var editor = SM.wantEditor();
    if (!editor && !Object.keys(SM.elements()).length) return; // nothing to animate on this page

    var list = [];
    if (!window.gsap) list.push(GSAP_CDN + "gsap.min.js"); // reuse the site's GSAP if it has one
    if (!window.MotionPathPlugin) list.push(GSAP_CDN + "MotionPathPlugin.min.js");
    // ScrollTrigger only when a saved animation uses appear/scroll (or the editor might need it).
    var els = SM.elements();
    var needST = editor || Object.keys(els).some(function (id) {
      return SM.needsScrollTrigger(els[id].desktop) || SM.needsScrollTrigger(typeof els[id].mobile === "object" ? els[id].mobile : null);
    });
    if (needST && !window.ScrollTrigger) list.push(GSAP_CDN + "ScrollTrigger.min.js");
    if (editor) list.push(GSAP_CDN + "MotionPathHelper.min.js", BASE + "editor.js");

    loadSequence(list).then(function () {
      SM.gsap = window.gsap; // keep our own reference in case another copy of GSAP replaces the global
      SM.gsap.registerPlugin(window.MotionPathPlugin);
      if (window.ScrollTrigger) {
        SM.gsap.registerPlugin(window.ScrollTrigger);
        // Images/fonts shift the layout after DOMContentLoaded: re-measure trigger positions.
        if (document.readyState !== "complete") window.addEventListener("load", function () { window.ScrollTrigger.refresh(); });
      }
      if (editor && !SM.editor) console.warn("[shape motion] editor didn't load");

      // Restart whenever Edit mode or the device view (desktop/phone) changes.
      var lastState = null;
      function refresh() {
        var state = SM.isEditing() + "|" + SM.isPhone();
        if (state === lastState) return;
        lastState = state;
        SM.restart();
      }
      new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ["class"] });
      PHONE_QUERY.addEventListener("change", refresh);
      refresh();
    }).catch(function (err) {
      console.warn("[shape motion]", err);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
