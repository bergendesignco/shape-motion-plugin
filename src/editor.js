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
  var ANCHORS = ["0% 0%", "50% 0%", "100% 0%", "0% 50%", "50% 50%", "100% 50%", "0% 100%", "50% 100%", "100% 100%"];

  // Editor state that survives the UI being rebuilt on every restart (view switches, edit mode).
  var state = { selectedId: null, panelPos: null, dirty: false, status: "" };

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

  // The block's layout box. Its container doesn't move when the block is animated.
  function anchorBox(el) {
    return el.closest(".fe-block") || el.parentElement || el;
  }

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
      var helper = null, tween = null, statusEl = null, output = null, badges = [];

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

      /* ---- save bar ---- */
      var bar = make("div", "smo-bar");
      var brand = make("strong", null, "Shape Motion");
      statusEl = make("span", "smo-status");
      bar.appendChild(brand);
      bar.appendChild(statusEl);

      var missing = Object.keys(pageElements()).filter(function (id) { return !document.getElementById(id); });
      if (missing.length) {
        bar.appendChild(button("Clean up " + missing.length + " missing", function () {
          if (!window.confirm(missing.length + " saved animation(s) point to elements that aren't on this page anymore. Remove them? (Saved when you click Save.)")) return;
          missing.forEach(function (id) { delete pageElements()[id]; });
          markDirty();
          SM.restart();
        }, "is-quiet"));
      }

      var saveBtn = button("Save", function (btn) {
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
            state.status = "Save failed: " + err.message.replace(/\.?$/, ".") + " Nothing was changed. Use Copy as a fallback.";
          })
          .then(function () { btn.disabled = false; showStatus(); undoBtn.hidden = !hasUndo(); });
      }, "is-primary");
      bar.appendChild(saveBtn);

      function hasUndo() {
        try { return sessionStorage.getItem(undoKey()) !== null; } catch (e) { return false; }
      }
      var undoBtn = button("Undo save", function (btn) {
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
      bar.appendChild(undoBtn);

      bar.appendChild(button("Copy", function (btn) {
        syncPath();
        output.value = managedBlock();
        output.hidden = false;
        var done = function () { btn.textContent = "Copied!"; setTimeout(function () { btn.textContent = "Copy"; }, 1200); };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(output.value).then(done);
        else { output.select(); document.execCommand("copy"); done(); }
      }));
      output = make("textarea");
      output.readOnly = true;
      output.rows = 5;
      output.hidden = true;
      output.title = "Paste into Page Settings > Advanced > Page Header Code Injection";
      bar.appendChild(output);
      document.body.appendChild(bar);
      ui.push(bar);
      showStatus();

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
        // The helper always loops while editing; keep our pause between loops ("once" previews with a 1s pause).
        tween.repeatDelay(cfg.playback === "once" ? 1 : cfg.repeatDelay);
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
          buildControls(row, actions);
        } else if (phone && selCfg.mobile === "same") {
          note("Using the desktop settings. Switch to Desktop view to edit them, or pick \"Own settings\".");
          tween = SM.buildTween(sel, selCfg.desktop); // preview only
        } else if (phone) {
          note("This element stays in its normal spot on phones.");
        }

        actions([button("Remove animation", function () {
          if (!window.confirm("Remove the animation from this element? (Saved when you click Save.)")) return;
          delete pageElements()[sel.id];
          state.selectedId = null;
          markDirty();
          SM.restart();
        }, "is-quiet")]);

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

        if (cfg) rebuild();
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

        slider("Duration", "duration", 0.2, 15, 0.1, secs, "Seconds for one trip along the path");
        slider("Delay", "delay", 0, 5, 0.1, secs, "Wait before the first run");
        select("Ease", "ease", EASES, "Speed curve");
        select("Playback", "playback", [["loop", "Loop (restart)"], ["yoyo", "Back and forth"], ["once", "Play once"]]);
        slider("Pause between", "repeatDelay", 0, 5, 0.1, secs, "Pause between loops");
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

        actions([
          button("Replay", function () { tween.restart(true); }),
          button("New A→B path", function () { rebuild(starterPath(sel, "open")); }),
          button("New loop path", function () { rebuild(starterPath(sel, "loop")); })
        ]);
      }

      return {
        el: sel,
        stop: function () {
          syncPath();                    // keep unsaved path edits for when the editor comes back
          if (helper) helper.kill();     // removes the path overlay and reverts the tween
          else if (tween) tween.revert();
          helper = tween = null;
          cleanups.forEach(function (fn) { fn(); });
          ui.forEach(function (n) { n.remove(); });
          document.querySelectorAll(".smo-hover").forEach(function (n) { n.classList.remove("smo-hover"); });
        }
      };
    }
  };

  // Mark path drags as unsaved changes (the helper doesn't tell us directly).
  document.addEventListener("pointerup", function (e) {
    if (e.target && e.target.closest && e.target.closest("svg.motion-path-helper")) {
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
    ".smo-slider{display:flex;align-items:center;gap:6px}",
    ".smo-slider input{flex:1;min-width:0;accent-color:#ff3b6b}",
    ".smo-slider em{font-style:normal;flex:0 0 40px;text-align:right;opacity:.85}",
    ".smo-panel select{width:100%;padding:3px 4px;border-radius:4px;border:0;background:#333}",
    ".smo-panel input[type=checkbox]{justify-self:start;accent-color:#ff3b6b;width:16px;height:16px}",
    ".smo-anchor{display:grid;grid-template-columns:repeat(3,18px);gap:4px}",
    ".smo-anchor button{all:unset;cursor:pointer;width:18px;height:18px;border-radius:3px;background:rgba(255,255,255,.18)}",
    ".smo-anchor button.is-active{background:#ff3b6b}",
    ".smo-actions{display:flex;flex-wrap:wrap;gap:4px}"
  ].join("\n");
  document.head.appendChild(style);
})();
