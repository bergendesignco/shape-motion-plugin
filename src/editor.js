/*!
 * Shape Motion for Squarespace - editor (only loaded for logged-in editors, see runtime.js)
 * https://github.com/bergendesignco/shape-motion-plugin
 *
 * UI: a badge on every shape block (+ = no animation, dot = animated). Click a badge to open that
 * element's own floating panel. A small save bar saves every element on the page in one write.
 *
 * Saving follows docs/squarespace-saving.md: GET the page settings, merge ONLY our marked block into
 * collectionData.headerInjectCode, POST the whole object back. Never post a partial object.
 */
(function () {
  "use strict";
  var SM = window.ShapeMotion;
  if (!SM || SM.editor) return;

  var MARK_START = "<!-- SHAPE-MOTION-START -->";
  var MARK_END = "<!-- SHAPE-MOTION-END -->";
  var EASES = ["none", "sine.inOut", "power1.inOut", "power2.inOut", "power3.inOut", "power2.out", "power2.in",
    "back.out(1.7)", "back.inOut(1.7)", "elastic.out(1, 0.4)", "bounce.out", "expo.inOut", "circ.inOut"];
  var TRIGGERS = [["load", "Page load"], ["appear", "When it appears"], ["scroll", "Scroll-driven"], ["hover", "Hover"], ["click", "Click"]];
  function triggerLabel(v) {
    var t = TRIGGERS.filter(function (x) { return x[0] === v; })[0];
    return t ? t[1] : "Page load";
  }
  var TRIGGER_HELP = {
    load: "Plays as soon as the page loads.",
    appear: "Playing it as if the shape just scrolled into view. The real scroll timing only works on the live page, so check it there.",
    appearLive: "Scroll down until the shape comes into view.",
    scroll: "Drag the slider to see where the shape sits at each point of the scroll. The real scrolling only works on the live page, so check it there.",
    scrollLive: "Scroll the page: the shape moves along its path as you scroll.",
    hover: "Hover over the shape (or its spot).",
    click: "Click the shape (or its spot)."
  };
  var ANCHORS = ["0% 0%", "50% 0%", "100% 0%", "0% 50%", "50% 50%", "100% 50%", "0% 100%", "50% 100%", "100% 100%"];

  // Editor state that survives the UI being rebuilt on every restart (view switches, edit mode).
  var state = { selectedId: null, panelPos: null, dirty: false, status: "", testing: false, previewPos: 0 };
  // The path-editing preview, so drags can put it back where it was (see pointerup below).
  var preview = { tween: null, still: false };

  function pageElements() { return SM.data.page.elements; }

  function copySettings(s) {
    var out = {};
    SM.SETTING_KEYS.forEach(function (k) { out[k] = s[k]; });
    return out;
  }

  function shapeName(el) {
    var n = el.querySelector("[data-shape-name]");
    var raw = n ? n.getAttribute("data-shape-name") : "shape";
    return raw.replace(/-/g, " ").replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function anchorBox(el) { return SM.anchorBox(el); }

  // Site header/footer elements belong in the site-wide injection: not supported yet.
  function isSiteElement(el) {
    return !!(el && el.closest("#header, header, footer, #footer-sections, .footer-sections"));
  }

  /* ---------------- saving (docs/squarespace-saving.md) ---------------- */

  // CSRF token, re-read before every request. Same order as the schema extension:
  // page context, then <meta name="crumb">, then the crumb cookie.
  function getCrumb() {
    var ctx = window.Static && window.Static.SQUARESPACE_CONTEXT;
    if (ctx && ctx.crumb) return ctx.crumb;
    var meta = document.querySelector('meta[name="crumb"]');
    if (meta && meta.content) return meta.content;
    var m = document.cookie.match(/(?:^|;\s*)crumb=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function isId(v) { return typeof v === "string" && /^[a-f0-9]{24}$/i.test(v); }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function normPath(p) { return (p || "/").replace(/\/+$/, "") || "/"; }

  function requestJson(url, opts) {
    return fetch(url, opts).then(function (res) {
      if (!res.ok) {
        var err = new Error("Squarespace said " + res.status + (res.status === 403 ? " (session expired? reload the page)" : ""));
        err.status = res.status;
        throw err;
      }
      return res.json();
    }).then(function (data) {
      if (data && data.error) throw new Error("Squarespace error: " + (data.error.message || data.error));
      return data;
    });
  }

  // This page's collection ID. Source of truth is ?format=json -> collection.id (as in the schema
  // extension); the page's own Static context is only a fallback.
  function resolvePageId() {
    var url = location.pathname + (location.search ? location.search + "&" : "?") + "format=json";
    return fetch(url, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        var id = data && data.collection && data.collection.id;
        if (isId(id)) return id;
        var fallback = SM.pageId();
        if (isId(fallback)) return fallback;
        throw new Error("Couldn't find this page's ID.");
      });
  }

  // GET the page settings and normalize them exactly like the schema extension does.
  // Real responses are FLAT (no collectionData wrapper) and have `id` but NOT `collectionId`.
  // The save MUST send both: without collectionId, Squarespace creates a brand-new page.
  function getPageSettings(pageId) {
    var crumb = getCrumb();
    if (!crumb) return Promise.reject(new Error("No Squarespace session token (crumb) found. Are you logged in?"));
    return requestJson("/api/commondata/GetCollectionSettings?collectionId=" + encodeURIComponent(pageId), {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", "x-csrf-token": crumb }
    }).then(function (data) {
      if (!isObj(data)) throw new Error("Page settings came back in an unexpected shape. Nothing was saved.");
      var normalized;
      if (isObj(data.collectionData)) {
        normalized = {};
        Object.keys(data).forEach(function (k) { normalized[k] = data[k]; });
        normalized.memberAreaData = isObj(data.memberAreaData) ? data.memberAreaData : {};
      } else {
        var flatId = data.id || data.collectionId;
        var hasKeys = ["id", "websiteId", "title", "urlId", "typeName"].every(function (k) { return k in data; });
        if (!isId(flatId) || !hasKeys) throw new Error("Page settings are missing expected fields. Nothing was saved.");
        normalized = { collectionData: data, memberAreaData: {} };
      }
      var cd = {};
      Object.keys(normalized.collectionData).forEach(function (k) { cd[k] = normalized.collectionData[k]; });
      if (!cd.collectionId && isId(cd.id)) cd.collectionId = cd.id;
      if (!cd.id && isId(cd.collectionId)) cd.id = cd.collectionId;
      if (!isId(cd.id) || cd.id !== pageId || cd.collectionId !== pageId) {
        throw new Error("Page settings didn't match this page (" + (cd.id || "missing") + " vs " + pageId + "). Nothing was saved.");
      }
      if (!cd.websiteId) throw new Error("Page settings are missing websiteId. Nothing was saved.");
      // Same page as the one on screen? (The homepage can be served from "/" and its own URL.)
      if (cd.fullUrl && !cd.homepage && normPath(cd.fullUrl) !== normPath(location.pathname)) {
        throw new Error("Page settings are for " + cd.fullUrl + ", not this page. Nothing was saved.");
      }
      normalized.collectionData = cd;
      return normalized;
    });
  }

  function savePageHeader(pageId, nextHeader) {
    // Always a fresh GET right before the POST. Send back everything from the GET, with both ids,
    // and change ONLY headerInjectCode.
    return getPageSettings(pageId).then(function (current) {
      var previous = current.collectionData.headerInjectCode || "";
      var body = {};
      Object.keys(current).forEach(function (k) { body[k] = current[k]; });
      var cd = {};
      Object.keys(current.collectionData).forEach(function (k) { cd[k] = current.collectionData[k]; });
      cd.headerInjectCode = String(typeof nextHeader === "function" ? nextHeader(previous) : nextHeader);
      body.collectionData = cd;
      body.memberAreaData = current.memberAreaData || {};
      var crumb = getCrumb();
      if (!crumb) throw new Error("No Squarespace session token (crumb) found. Are you logged in?");
      return requestJson("/api/commondata/SaveCollectionSettings", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json; charset=UTF-8",
          "x-csrf-token": crumb
        },
        body: JSON.stringify(body)
      }).then(function () { return previous; });
    });
  }

  function managedBlock() {
    // Escape "<" so the JSON can never close the <script> tag early.
    var json = JSON.stringify({ version: 1, elements: pageElements() }, null, 1).replace(/</g, "\\u003c");
    return MARK_START + "\n" + '<script type="application/json" data-shape-motion="page">' + json + "</script>\n" + MARK_END;
  }

  function replaceManagedBlock(source, block) {
    var current = source || "";
    var s = current.indexOf(MARK_START);
    var e = current.indexOf(MARK_END);
    if (s !== -1 && e > s) return current.slice(0, s) + block + current.slice(e + MARK_END.length);
    return current.trim() ? current.replace(/\s+$/, "") + "\n\n" + block : block;
  }

  function undoKey() { return "shape-motion-undo:" + location.pathname; }

  // Copied animation (desktop + mobile settings). Kept for the browser tab, so it works across pages.
  var CLIP_KEY = "shape-motion-clipboard";
  function readClipboard() {
    try { var v = sessionStorage.getItem(CLIP_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function writeClipboard(fromId, cfg) {
    try { sessionStorage.setItem(CLIP_KEY, JSON.stringify({ from: fromId, page: location.pathname, cfg: cfg })); } catch (e) { /* unavailable */ }
  }

  /* ---------------- small DOM helpers ---------------- */

  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function button(text, onClick, cls) {
    var b = make("button", cls, text);
    b.type = "button";
    b.addEventListener("click", function (e) { e.stopPropagation(); onClick(b); });
    return b;
  }
  function selectEl(options, value, onChange) {
    var s = make("select");
    options.forEach(function (o) {
      var opt = make("option", null, Array.isArray(o) ? o[1] : o);
      opt.value = Array.isArray(o) ? o[0] : o;
      s.appendChild(opt);
    });
    // Keep a saved value that isn't one of the presets visible instead of showing a blank.
    if (value != null && !options.some(function (o) { return (Array.isArray(o) ? o[0] : o) === value; })) {
      var custom = make("option", null, String(value));
      custom.value = value;
      s.appendChild(custom);
    }
    s.value = value;
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }

  /* ---------------- the editor ---------------- */

  SM.editor = {
    // The element whose panel is open: the editor animates it itself, so the runtime skips it.
    editingId: function () {
      return state.selectedId && pageElements()[state.selectedId] && document.getElementById(state.selectedId) ? state.selectedId : null;
    },
    start: function (phone) {
      var gsap = SM.gsap;
      gsap.registerPlugin(window.MotionPathHelper);
      var ui = [];          // nodes to remove on stop
      var cleanups = [];    // listeners to remove on stop
      var helper = null, tween = null, testStop = null, statusEl = null, output = null, badges = [];

      function markDirty() { state.dirty = true; state.status = ""; showStatus(); }
      function showStatus() {
        if (!statusEl) return;
        statusEl.textContent = state.status || (state.dirty ? "Unsaved changes" : "All changes saved");
        statusEl.classList.toggle("is-dirty", state.dirty && !state.status);
      }

      var shapes = Array.prototype.filter.call(document.querySelectorAll(SM.SHAPE_SELECTOR), function (el) { return !!el.id; });
      if (state.selectedId && !document.getElementById(state.selectedId)) state.selectedId = null;

      var sel = state.selectedId ? document.getElementById(state.selectedId) : null;
      var selCfg = sel ? pageElements()[sel.id] : null;
      // The settings object the panel edits. null = nothing to edit for this layout.
      var cfg = !selCfg ? null : (phone ? (selCfg.mobile && typeof selCfg.mobile === "object" ? selCfg.mobile : null) : selCfg.desktop);

      /* ---- badges ---- */
      shapes.forEach(function (el) {
        var animated = !!pageElements()[el.id];
        var site = isSiteElement(el);
        var b = make("button", "smo-badge" + (animated ? " is-animated" : "") + (el.id === state.selectedId ? " is-selected" : ""), animated ? "" : "+");
        b.type = "button";
        b.title = site ? shapeName(el) + " (site header/footer: not supported yet)" :
          (animated ? "Edit animation · " : "Add animation · ") + shapeName(el);
        if (site) b.disabled = true;
        b.addEventListener("mouseenter", function () { anchorBox(el).classList.add("smo-hover"); });
        b.addEventListener("mouseleave", function () { anchorBox(el).classList.remove("smo-hover"); });
        b.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          anchorBox(el).classList.remove("smo-hover");
          if (!pageElements()[el.id]) {
            var d = copySettings(SM.DEFAULT_SETTINGS);
            d.path = starterPath(el, "open");
            pageElements()[el.id] = { desktop: d, mobile: "off" };
            markDirty();
          }
          state.selectedId = el.id;
          state.testing = false;
          state.previewPos = 0;
          state.panelPos = null; // open next to the element
          SM.restart();
        });
        document.body.appendChild(b);
        badges.push({ node: b, el: el });
        ui.push(b);
      });

      function placeBadges() {
        badges.forEach(function (x) {
          var r = anchorBox(x.el).getBoundingClientRect();
          x.node.style.left = r.left + window.scrollX - 9 + "px";
          x.node.style.top = r.top + window.scrollY - 9 + "px";
        });
      }
      placeBadges();
      var onResize = function () { window.requestAnimationFrame(placeBadges); };
      window.addEventListener("resize", onResize);
      cleanups.push(function () { window.removeEventListener("resize", onResize); });

      /* ---- save controls: in the open panel's footer, or a small bar when no panel is open ---- */
      var missing = Object.keys(pageElements()).filter(function (id) { return !document.getElementById(id); });

      function hasUndo() {
        try { return sessionStorage.getItem(undoKey()) !== null; } catch (e) { return false; }
      }

      function buildSaveArea(container) {
        statusEl = make("span", "smo-status");
        container.appendChild(statusEl);
        var btns = make("div", "smo-save-buttons");
        container.appendChild(btns);

        if (missing.length) {
          btns.appendChild(button("Clean up " + missing.length + " missing", function () {
            if (!window.confirm(missing.length + " saved animation(s) point to elements that aren't on this page anymore. Remove them? (Saved when you click Save.)")) return;
            missing.forEach(function (id) { delete pageElements()[id]; });
            markDirty();
            SM.restart();
          }, "is-quiet"));
        }

        var undoBtn;
        btns.appendChild(button("Save", function (btn) {
          syncPath();
          var count = Object.keys(pageElements()).length;
          if (!window.confirm("Save animations for " + count + " element" + (count === 1 ? "" : "s") +
            " to this page's Header Code Injection?\n\nOnly the Shape Motion block is replaced. Anything else in that box is kept.")) return;
          btn.disabled = true;
          state.status = "Saving…"; showStatus();
          resolvePageId()
            .then(function (id) {
              return savePageHeader(id, function (previous) { return replaceManagedBlock(previous, managedBlock()); });
            })
            .then(function (previous) {
              try { sessionStorage.setItem(undoKey(), previous); } catch (e) { /* undo unavailable */ }
              state.dirty = false;
              state.status = "Saved ✓";
            })
            .catch(function (err) {
              state.status = "Save failed: " + err.message.replace(/\.?$/, ".") + " Nothing was changed. Use Copy code as a fallback.";
            })
            .then(function () { btn.disabled = false; showStatus(); undoBtn.hidden = !hasUndo(); });
        }, "is-primary"));

        undoBtn = button("Undo save", function (btn) {
          var previous;
          try { previous = sessionStorage.getItem(undoKey()); } catch (e) { previous = null; }
          if (previous === null) return;
          if (!window.confirm("Put this page's Header Code Injection back to how it was before your last save? The page will reload.")) return;
          btn.disabled = true;
          state.status = "Undoing…"; showStatus();
          resolvePageId().then(function (id) { return savePageHeader(id, previous); }).then(function () {
            try { sessionStorage.removeItem(undoKey()); } catch (e) { /* ignore */ }
            state.dirty = false;
            location.reload();
          }).catch(function (err) {
            state.status = "Undo failed: " + err.message;
            btn.disabled = false;
            showStatus();
          });
        });
        undoBtn.hidden = !hasUndo();
        btns.appendChild(undoBtn);

        btns.appendChild(button("Copy code", function (btn) {
          syncPath();
          output.value = managedBlock();
          output.hidden = false;
          var done = function () { btn.textContent = "Copied!"; setTimeout(function () { btn.textContent = "Copy code"; }, 1200); };
          if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(output.value).then(done);
          else { output.select(); document.execCommand("copy"); done(); }
        }, "is-quiet"));
        output = make("textarea");
        output.readOnly = true;
        output.rows = 5;
        output.hidden = true;
        output.title = "Manual fallback: paste into Page Settings > Advanced > Page Header Code Injection";
        container.appendChild(output);
        showStatus();
      }

      // No panel open: only show the bar when there's something to save, undo or clean up.
      if (!(sel && selCfg) && (state.dirty || hasUndo() || missing.length)) {
        var bar = make("div", "smo-bar");
        bar.appendChild(make("strong", null, "Shape Motion"));
        buildSaveArea(bar);
        document.body.appendChild(bar);
        ui.push(bar);
      }

      /* ---- element panel ---- */
      if (sel && selCfg) buildPanel();

      function starterPath(el, kind) {
        // Sized to the block but kept on screen (blocks are near full width on phones).
        var w;
        if (kind === "loop") {
          w = Math.round(Math.min(el.offsetWidth * 0.6, window.innerWidth * 0.15));
          return "M0,0 C0,-" + w + " " + w * 2 + ",-" + w + " " + w * 2 + ",0 C" + w * 2 + "," + w + " 0," + w + " 0,0";
        }
        w = Math.round(Math.min(el.offsetWidth * 0.7, window.innerWidth * 0.13));
        return "M0,0 C" + w + "," + -w * 0.6 + " " + w * 2 + "," + w * 0.6 + " " + w * 3 + ",0";
      }

      function syncPath() {
        if (!helper || !cfg) return;
        var p = helper.getString().trim();
        if (p !== cfg.path) { cfg.path = p; state.dirty = true; }
      }

      // Where the block sits in the layout with no animation applied (page coordinates).
      function layoutRect(el) {
        var saved = { x: gsap.getProperty(el, "x"), y: gsap.getProperty(el, "y"), rotation: gsap.getProperty(el, "rotation") };
        gsap.set(el, { x: 0, y: 0, rotation: 0 });
        var r = el.getBoundingClientRect();
        gsap.set(el, saved);
        return { left: r.left + window.scrollX, top: r.top + window.scrollY };
      }

      function rebuild(newPath) {
        syncPath();
        if (newPath) { cfg.path = newPath; markDirty(); }
        if (helper) helper.kill(); // also reverts the tween
        tween = SM.buildTween(sel, cfg);
        var pos = layoutRect(sel);
        helper = window.MotionPathHelper.create(tween, { pathColor: "#ff3b6b", pathWidth: 3, pathOpacity: 0.9 });
        // The helper forces the preview to loop forever. Only keep that for an always-on animation
        // (page load + loop/back-and-forth); everything else holds still at the Preview position.
        var trig = cfg.trigger || "load";
        var alwaysOn = trig === "load" && cfg.playback !== "once";
        if (alwaysOn) {
          tween.repeat(-1).repeatDelay(cfg.repeatDelay).yoyo(cfg.playback === "yoyo");
        } else {
          tween.repeat(0).yoyo(false).pause();
          tween.progress(state.previewPos || 0);
        }
        preview.tween = tween;
        preview.still = !alwaysOn;
        // Draw the path from the anchor point instead of the block's top-left corner.
        var a = cfg.anchor.split(" ").map(parseFloat);
        var svg = document.querySelector("svg.motion-path-helper");
        if (svg) {
          svg.style.left = pos.left + sel.offsetWidth * a[0] / 100 + "px";
          svg.style.top = pos.top + sel.offsetHeight * a[1] / 100 + "px";
        }
      }

      function closePanel() {
        state.selectedId = null;
        state.testing = false;
        SM.restart();
      }

      function buildPanel() {
        var panel = make("div", "smo-panel");
        var head = make("div", "smo-head");
        head.appendChild(make("strong", null, shapeName(sel)));
        head.appendChild(make("span", "smo-layout", phone ? "Phone · 767px and below" : "Desktop · 768px and up"));
        var close = button("✕", closePanel, "smo-close");
        close.setAttribute("aria-label", "Close");
        head.appendChild(close);
        panel.appendChild(head);
        var body = make("div", "smo-body");
        panel.appendChild(body);

        function note(text) { body.appendChild(make("p", "smo-note", text)); }
        function row(label, control, hint) {
          var r = make("div", "smo-row");
          r.appendChild(make("span", null, label));
          r.appendChild(control);
          if (hint) r.title = hint;
          body.appendChild(r);
        }
        function actions(buttons) {
          var wrap = make("div", "smo-actions");
          buttons.forEach(function (b) { wrap.appendChild(b); });
          body.appendChild(wrap);
        }

        if (phone) {
          var mode = selCfg.mobile && typeof selCfg.mobile === "object" ? "own" : (selCfg.mobile === "same" ? "same" : "off");
          row("On phones", selectEl([["off", "Off (stays still)"], ["same", "Same as desktop"], ["own", "Own settings"]], mode, function (v) {
            if (v === "own") {
              var s = copySettings(selCfg.desktop);
              s.path = starterPath(sel, "open");
              selCfg.mobile = s;
            } else {
              selCfg.mobile = v;
            }
            markDirty();
            SM.restart();
          }), "What this element does on phones (767px and below)");
        } else {
          var summary = selCfg.mobile === "same" ? "same as desktop" : (selCfg.mobile && typeof selCfg.mobile === "object" ? "own settings" : "off (stays still)");
          note("Phones: " + summary + ". Switch to Mobile view to change.");
        }

        if (cfg) {
          // Settings saved before a key existed get its default.
          SM.SETTING_KEYS.forEach(function (k) { if (cfg[k] === undefined) cfg[k] = SM.DEFAULT_SETTINGS[k]; });
          if (state.testing) buildTestMode(body, note, actions);
          else buildControls(row, actions);
        } else if (phone && selCfg.mobile === "same") {
          note("Using the desktop settings. Switch to Desktop view to edit them, or pick \"Own settings\".");
          tween = SM.buildTween(sel, selCfg.desktop); // preview only
        } else if (phone) {
          note("This element stays in its normal spot on phones.");
        }

        var clip = readClipboard();
        var manage = [button("Copy animation", function (btn) {
          syncPath();
          writeClipboard(sel.id, selCfg);
          btn.textContent = "Copied ✓ (open another shape to paste)";
        }, "is-quiet")];
        if (clip && clip.cfg && !(clip.from === sel.id && clip.page === location.pathname)) {
          manage.push(button("Paste animation", function () {
            if (!window.confirm("Replace this shape's animation with the copied one? (Saved when you click Save.)")) return;
            pageElements()[sel.id] = JSON.parse(JSON.stringify(clip.cfg));
            markDirty();
            SM.restart();
          }, "is-quiet"));
        }
        manage.push(button("Remove animation", function () {
          if (!window.confirm("Remove the animation from this element? (Saved when you click Save.)")) return;
          delete pageElements()[sel.id];
          state.selectedId = null;
          markDirty();
          SM.restart();
        }, "is-quiet"));
        actions(manage);

        var foot = make("div", "smo-foot");
        panel.appendChild(foot);
        buildSaveArea(foot);

        document.body.appendChild(panel);
        ui.push(panel);
        positionPanel(panel);
        makeDraggable(panel, head);

        var onKey = function (e) {
          var t = e.target;
          if (e.key !== "Escape" || (t && t.closest && t.closest(".smo-panel select"))) return;
          closePanel();
        };
        document.addEventListener("keydown", onKey);
        cleanups.push(function () { document.removeEventListener("keydown", onKey); });

        if (cfg && state.testing && simulatedScrollTest()) {
          // Scroll: scrubbed by the slider. Appear: plays as if it just came into view.
          tween = SM.buildTween(sel, cfg, cfg.trigger === "scroll" ? { repeat: 0, yoyo: false, delay: 0, paused: true, immediateRender: true } : {});
        } else if (cfg && state.testing) testStop = SM.animate(sel, cfg); // the real visitor behavior
        else if (cfg) rebuild();
      }


      // Inside the Squarespace editor, appear/scroll can't use real scrolling: simulate them here.
      function simulatedScrollTest() {
        return (cfg.trigger === "appear" || cfg.trigger === "scroll") && SM.inSquarespaceEditor();
      }

      function buildTestMode(body, note, actions) {
        var sim = simulatedScrollTest();
        body.appendChild(make("div", "smo-testing", "Testing trigger: " + triggerLabel(cfg.trigger)));
        note(TRIGGER_HELP[sim ? cfg.trigger : cfg.trigger + "Live"] || TRIGGER_HELP[cfg.trigger] || "");
        var acts = [];
        if (sim && cfg.trigger === "scroll") {
          var wrap = make("span", "smo-slider");
          var input = make("input");
          input.type = "range"; input.min = 0; input.max = 1; input.step = 0.01; input.value = 0;
          var val = make("em", null, "0%");
          input.addEventListener("input", function () {
            val.textContent = Math.round(input.value * 100) + "%";
            if (tween) tween.progress(parseFloat(input.value));
          });
          wrap.appendChild(input);
          wrap.appendChild(val);
          var r = make("div", "smo-row");
          r.appendChild(make("span", null, "Scroll position"));
          r.appendChild(wrap);
          body.appendChild(r);
        }
        if (sim && cfg.trigger === "appear") acts.push(button("Play again", function () { if (tween) tween.restart(true); }));
        acts.push(button("← Back to editing the path", function () { state.testing = false; SM.restart(); }, "is-primary"));
        actions(acts);
      }

      // Next to the element (right, else left), kept on screen. A dragged position is kept.
      function positionPanel(panel) {
        var pw = panel.offsetWidth, ph = panel.offsetHeight, m = 12;
        var vw = window.innerWidth, vh = window.innerHeight;
        var left, top;
        if (state.panelPos) {
          left = state.panelPos.left; top = state.panelPos.top;
        } else {
          var r = anchorBox(sel).getBoundingClientRect();
          if (r.right + m + pw <= vw - m) { left = r.right + m; top = r.top; }        // right of it
          else if (r.left - m - pw >= m) { left = r.left - m - pw; top = r.top; }     // left of it
          else { left = vw - pw - m; top = m; }                                       // no room: dock top-right
        }
        panel.style.left = Math.max(m, Math.min(left, vw - pw - m)) + "px";
        panel.style.top = Math.max(m, Math.min(top, vh - ph - m)) + "px";
      }

      function makeDraggable(panel, handle) {
        var start = null;
        function move(e) {
          if (!start) return;
          var left = Math.max(0, Math.min(e.clientX - start.x, window.innerWidth - panel.offsetWidth));
          var top = Math.max(0, Math.min(e.clientY - start.y, window.innerHeight - panel.offsetHeight));
          panel.style.left = left + "px";
          panel.style.top = top + "px";
          state.panelPos = { left: left, top: top };
        }
        function up() {
          start = null;
          document.removeEventListener("pointermove", move, true);
          document.removeEventListener("pointerup", up, true);
        }
        handle.addEventListener("pointerdown", function (e) {
          if (e.button !== 0 || e.target.closest("button")) return;
          e.preventDefault();
          var r = panel.getBoundingClientRect();
          start = { x: e.clientX - r.left, y: e.clientY - r.top };
          document.addEventListener("pointermove", move, true);
          document.addEventListener("pointerup", up, true);
        });
        cleanups.push(up);
      }

      function buildControls(row, actions) {
        function slider(label, key, min, max, step, fmt, hint) {
          var wrap = make("span", "smo-slider");
          var input = make("input");
          input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = cfg[key];
          var val = make("em");
          var show = function () { val.textContent = fmt(parseFloat(input.value)); };
          show();
          input.addEventListener("input", show);
          input.addEventListener("change", function () { cfg[key] = parseFloat(input.value); markDirty(); rebuild(); });
          wrap.appendChild(input);
          wrap.appendChild(val);
          row(label, wrap, hint);
        }
        function select(label, key, options, hint) {
          row(label, selectEl(options, cfg[key], function (v) { cfg[key] = v; markDirty(); rebuild(); }), hint);
        }
        var secs = function (v) { return v + "s"; };
        var pct = function (v) { return Math.round(v * 100) + "%"; };

        var trig = cfg.trigger || "load";
        row("Trigger", selectEl(TRIGGERS, trig, function (v) {
          cfg.trigger = v;
          markDirty();
          SM.restart(); // different trigger, different options
        }), "What starts the animation");

        // Preview: scrub along the path, or play one pass (the path editor doesn't auto-play this).
        var pwrap = make("span", "smo-slider");
        var pinput = make("input");
        pinput.type = "range"; pinput.min = 0; pinput.max = 1; pinput.step = 0.01; pinput.value = state.previewPos || 0;
        var pval = make("em", null, Math.round((state.previewPos || 0) * 100) + "%");
        pinput.addEventListener("input", function () {
          state.previewPos = parseFloat(pinput.value);
          pval.textContent = Math.round(state.previewPos * 100) + "%";
          if (tween) tween.pause().progress(state.previewPos);
        });
        var play = button("▶", function () {
          if (!tween) return;
          if (trig === "load" || trig === "appear") {
            // Plays as configured (playback, pause between); an always-on one keeps looping.
            tween.repeat(cfg.playback === "once" ? 0 : -1).yoyo(cfg.playback === "yoyo").repeatDelay(cfg.repeatDelay);
          }
          tween.restart();
        }, "smo-play");
        play.title = "Play";
        pwrap.appendChild(play);
        pwrap.appendChild(pinput);
        pwrap.appendChild(pval);
        row(trig === "scroll" ? "Scroll position" : "Preview", pwrap,
          trig === "scroll" ? "Where the shape is at each point of the scroll" : "Drag to scrub along the path, or play it");

        if (trig === "appear") {
          select("Starts when", "appearAt", [["top 85%", "Just visible"], ["top 70%", "A bit in"], ["top 50%", "Halfway up the screen"]],
            "How far the shape's spot has scrolled into view before it plays");
          select("Replay", "replay", [["once", "Only the first time"], ["every", "Every time it appears"], ["reverse", "Reverse when scrolled back up"]]);
        } else if (trig === "scroll") {
          slider("Speed", "scrollSpeed", 0.25, 3, 0.05, function (v) { return v + "×"; },
            "How fast it moves along the path compared to scrolling. 1× = as fast as you scroll");
          slider("Smoothing (lag)", "scrub", 0, 2, 0.1, secs, "0 = sticks exactly to the scrollbar; higher = eases into place behind the scroll");
        } else if (trig === "hover") {
          select("On leave", "hoverLeave", [["reverse", "Go back"], ["finish", "Finish the trip"]]);
        } else if (trig === "click") {
          select("Each click", "clickMode", [["toggle", "There, then back"], ["replay", "Replay from the start"]]);
        }

        if (trig !== "scroll") slider("Duration", "duration", 0.2, 15, 0.1, secs, "Seconds for one trip along the path");
        if (trig === "load" || trig === "appear") slider("Delay", "delay", 0, 5, 0.1, secs, "Wait before it starts");
        select("Ease", "ease", EASES, trig === "scroll" ? "Speed curve (\"none\" feels most natural for scroll)" : "Speed curve");
        if (trig === "load" || trig === "appear") {
          select("Playback", "playback", [["loop", "Loop (restart)"], ["yoyo", "Back and forth"], ["once", "Play once"]]);
          slider("Pause between", "repeatDelay", 0, 5, 0.1, secs, "Pause between loops");
        }
        slider("Start", "start", 0, 1, 0.01, pct, "Where on the path the trip begins");
        slider("End", "end", 0, 1, 0.01, pct, "Where on the path the trip ends");
        select("Layout spot is", "home", [["start", "Path start (travel away)"], ["end", "Path end (travel in)"]],
          "Which end of the path is the block's normal Squarespace position");

        var rot = make("input");
        rot.type = "checkbox";
        rot.checked = cfg.autoRotate;
        rot.addEventListener("change", function () { cfg.autoRotate = rot.checked; markDirty(); rebuild(); });
        row("Auto-rotate", rot, "Turn to face the direction of travel");
        slider("Rotate offset", "rotateOffset", -180, 180, 5, function (v) { return v + "°"; });

        var grid = make("span", "smo-anchor");
        ANCHORS.forEach(function (a) {
          var b = make("button", a === cfg.anchor ? "is-active" : "");
          b.type = "button";
          b.title = a;
          b.addEventListener("click", function () {
            cfg.anchor = a;
            grid.querySelectorAll("button").forEach(function (x) { x.classList.toggle("is-active", x === b); });
            markDirty();
            rebuild();
          });
          grid.appendChild(b);
        });
        row("Anchor point", grid, "Point on the shape that rides the path (and rotation pivot)");

        var acts = [];
        if (trig !== "load") acts.push(button("Test trigger", function () { syncPath(); state.testing = true; SM.restart(); }, "is-primary"));
        actions(acts.concat([
          button("New A→B path", function () { rebuild(starterPath(sel, "open")); }),
          button("New loop path", function () { rebuild(starterPath(sel, "loop")); })
        ]));
      }

      return {
        el: sel,
        stop: function () {
          syncPath();                    // keep unsaved path edits for when the editor comes back
          if (helper) helper.kill();     // removes the path overlay and reverts the tween
          else if (tween) tween.revert();
          if (testStop) testStop();
          helper = tween = testStop = null;
          preview.tween = null;
          cleanups.forEach(function (fn) { fn(); });
          ui.forEach(function (n) { n.remove(); });
          document.querySelectorAll(".smo-hover").forEach(function (n) { n.classList.remove("smo-hover"); });
        }
      };
    }
  };

  // Mark path drags as unsaved changes (the helper doesn't tell us directly). The helper also restarts
  // the preview after every drag; put a still preview back where the Preview slider has it.
  document.addEventListener("pointerup", function (e) {
    if (e.target && e.target.closest && e.target.closest("svg.motion-path-helper")) {
      if (preview.still && preview.tween) {
        setTimeout(function () { preview.tween.pause().progress(state.previewPos || 0); }, 0);
      }
      state.dirty = true;
      state.status = "";
      var s = document.querySelector(".smo-status");
      if (s) { s.textContent = "Unsaved changes"; s.classList.add("is-dirty"); }
    }
  }, true);

  // Warn before leaving with unsaved changes.
  window.addEventListener("beforeunload", function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  var style = document.createElement("style");
  style.textContent = [
    ".copy-motion-path{display:none!important}",
    ".smo-panel,.smo-bar,.smo-badge{font:12px/1.3 system-ui,-apple-system,sans-serif;color:#fff;box-sizing:border-box}",
    ".smo-panel *,.smo-bar *{box-sizing:border-box;font:inherit;color:inherit;letter-spacing:normal;text-transform:none}",
    /* badges */
    ".smo-badge{all:unset;position:absolute;z-index:10001;width:18px;height:18px;border-radius:50%;background:#1f1f1f;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;cursor:pointer;box-shadow:0 0 0 2px #fff,0 1px 4px rgba(0,0,0,.3)}",
    ".smo-badge:hover{transform:scale(1.15)}",
    ".smo-badge.is-animated{background:#ff3b6b}",
    ".smo-badge.is-selected{box-shadow:0 0 0 2px #fff,0 0 0 5px #ff3b6b}",
    ".smo-badge[disabled]{opacity:.35;cursor:default;transform:none}",
    ".smo-hover{outline:2px dashed #ff3b6b!important;outline-offset:4px!important}",
    /* save bar */
    ".smo-foot{display:flex;flex-direction:column;gap:6px;padding:10px 12px 12px;border-top:1px solid rgba(255,255,255,.12)}",
    ".smo-save-buttons{display:flex;flex-wrap:wrap;gap:4px}",
    ".smo-foot button,.smo-save-buttons button{all:unset;cursor:pointer;padding:5px 9px;border-radius:4px;background:rgba(255,255,255,.14)}",
    ".smo-foot .is-primary{background:#ff3b6b}",
    ".smo-foot .is-quiet{background:none;opacity:.65}",
    ".smo-foot button[hidden]{display:none}",
    ".smo-foot button[disabled]{opacity:.5;cursor:default}",
    ".smo-foot textarea{width:100%;resize:vertical;padding:6px;border:0;border-radius:4px;background:#111;font:11px/1.35 ui-monospace,Menlo,monospace}",
    ".smo-foot textarea[hidden]{display:none}",
    ".smo-bar{position:fixed;right:12px;bottom:12px;z-index:10003;display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:calc(100vw - 24px);padding:8px 10px;border-radius:10px;background:rgba(20,20,20,.92);box-shadow:0 6px 24px rgba(0,0,0,.25)}",
    ".smo-status{opacity:.8}",
    ".smo-status.is-dirty{color:#ffd166;opacity:1}",
    ".smo-bar button,.smo-actions button{all:unset;cursor:pointer;padding:5px 9px;border-radius:4px;background:rgba(255,255,255,.14)}",
    ".smo-bar button:hover,.smo-actions button:hover{background:rgba(255,255,255,.28)}",
    ".smo-bar button[disabled]{opacity:.5;cursor:default}",
    ".smo-bar button[hidden],.smo-bar textarea[hidden]{display:none}",
    ".smo-bar .is-primary{background:#ff3b6b}",
    ".smo-bar .is-quiet,.smo-actions .is-quiet{background:none;opacity:.65}",
    ".smo-bar textarea{flex-basis:100%;resize:vertical;padding:6px;border:0;border-radius:4px;background:#111;font:11px/1.35 ui-monospace,Menlo,monospace}",
    /* element panel */
    ".smo-panel{position:fixed;z-index:10002;width:290px;max-height:calc(100vh - 24px);overflow:auto;border-radius:10px;background:rgba(20,20,20,.94);box-shadow:0 6px 24px rgba(0,0,0,.3)}",
    ".smo-head{display:flex;align-items:center;gap:8px;padding:9px 10px 9px 12px;cursor:move;border-bottom:1px solid rgba(255,255,255,.12)}",
    ".smo-layout{flex:1;opacity:.6;font-size:11px}",
    ".smo-close{all:unset;cursor:pointer;padding:0 4px;opacity:.7}",
    ".smo-close:hover{opacity:1}",
    ".smo-body{display:flex;flex-direction:column;gap:8px;padding:10px 12px 12px}",
    ".smo-note{margin:0;opacity:.7}",
    ".smo-row{display:grid;grid-template-columns:92px 1fr;align-items:center;gap:8px;margin:0}",
    ".smo-row>span:first-child{opacity:.75}",
    ".smo-row>*{min-width:0}",
    ".smo-slider{display:flex;align-items:center;gap:6px;min-width:0}",
    ".smo-slider input{flex:1;min-width:0;accent-color:#ff3b6b}",
    ".smo-slider em{font-style:normal;flex:0 0 40px;text-align:right;opacity:.85}",
    ".smo-panel select{width:100%;padding:3px 4px;border-radius:4px;border:0;background:#333}",
    ".smo-panel input[type=checkbox]{justify-self:start;accent-color:#ff3b6b;width:16px;height:16px}",
    ".smo-anchor{display:grid;grid-template-columns:repeat(3,18px);gap:4px}",
    ".smo-anchor button{all:unset;cursor:pointer;width:18px;height:18px;border-radius:3px;background:rgba(255,255,255,.18)}",
    ".smo-anchor button.is-active{background:#ff3b6b}",
    ".smo-actions{display:flex;flex-wrap:wrap;gap:4px}",
    ".smo-play{all:unset;cursor:pointer;width:20px;height:20px;border-radius:50%;background:#ff3b6b;display:flex;align-items:center;justify-content:center;font-size:9px;flex:0 0 20px}",
    ".smo-play+input+em{flex-basis:34px}",
    ".smo-actions .is-primary{background:#ff3b6b}",
    ".smo-testing{padding:6px 8px;border-radius:4px;background:rgba(255,59,107,.22);color:#ffc2d1}"
  ].join("\n");
  document.head.appendChild(style);
})();
