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
    "home", "autoRotate", "rotateOffset", "anchor"];
  var DEFAULT_SETTINGS = {
    path: "M0,0 C100,-60 200,60 300,0",
    duration: 4, delay: 0, ease: "power1.inOut", playback: "yoyo", repeatDelay: 0.5,
    start: 0, end: 1, home: "start", autoRotate: false, rotateOffset: 0, anchor: "0% 0%"
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

  SM.buildTween = function (el, c) {
    var gsap = SM.gsap;
    var toHome = c.home === "end";
    gsap.set(el, { transformOrigin: c.anchor });
    return gsap.to(el, {
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
    });
  };

  /* ---------------- Squarespace context ---------------- */

  // Edit mode: the site (inside the editor's iframe) gets these body classes while editing.
  // (Don't use "sqs-edit-mode" - it's there even when not editing.)
  SM.isEditing = function () {
    var c = document.body.classList;
    return c.contains("sqs-edit-mode-active") || c.contains("sqs-is-page-editing");
  };

  // Running inside the Squarespace editor (iframe#sqs-site-frame on a /config page).
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
      var tween = SM.buildTween(el, s);
      running.push({ el: el, stop: function () { tween.revert(); } });
    });
    if (SM.editor) running.push(SM.editor.start(phone));
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
    if (editor) list.push(GSAP_CDN + "MotionPathHelper.min.js", BASE + "editor.js");

    loadSequence(list).then(function () {
      SM.gsap = window.gsap; // keep our own reference in case another copy of GSAP replaces the global
      SM.gsap.registerPlugin(window.MotionPathPlugin);
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
