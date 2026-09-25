/*!
 * Shape Motion for Squarespace - editor (only loaded for logged-in editors, see runtime.js)
 * https://github.com/bergendesignco/shape-motion-plugin
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

  // Editor state that survives the panel being rebuilt on every restart (view switches, edit mode).
  var state = { selectedId: null, collapsed: false, dirty: false, status: "" };

  function pageElements() { return SM.data.page.elements; }

  function copySettings(s) {
    var out = {};
    SM.SETTING_KEYS.forEach(function (k) { out[k] = s[k]; });
    return out;
  }

  // Shapes on the page, plus anything already in the saved settings.
  function candidates() {
    var list = [];
    var seen = {};
    Array.prototype.forEach.call(document.querySelectorAll(SM.SHAPE_SELECTOR), function (el) {
      if (!el.id) return;
      var name = el.querySelector("[data-shape-name]");
      list.push({ id: el.id, label: (name ? name.getAttribute("data-shape-name") : "shape") });
      seen[el.id] = true;
    });
    Object.keys(SM.elements()).forEach(function (id) {
      if (!seen[id]) list.push({ id: id, label: "missing element" });
    });
    return list;
  }

  // Site header/footer elements belong in the site-wide injection: not supported yet.
  function isSiteElement(el) {
    return !!(el && el.closest("#header, header, footer, #footer-sections, .footer-sections"));
  }

  /* ---------------- saving (docs/squarespace-saving.md) ---------------- */

  function getCrumb() {
    var ctx = window.Static && window.Static.SQUARESPACE_CONTEXT;
    if (ctx && ctx.crumb) return ctx.crumb;
    var m = document.cookie.match(/(?:^|;\s*)crumb=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

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

  function getPageSettings(pageId) {
    var crumb = getCrumb();
    if (!crumb) return Promise.reject(new Error("No Squarespace session token (crumb) found. Are you logged in?"));
    return requestJson("/api/commondata/GetCollectionSettings?collectionId=" + encodeURIComponent(pageId), {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json, text/plain, */*", "x-csrf-token": crumb }
    }).then(function (data) {
      // Accept wrapped ({ collectionData, memberAreaData }) or flat responses.
      var wrapped = data && data.collectionData ? data : { collectionData: data, memberAreaData: {} };
      var cd = wrapped.collectionData || {};
      var id = cd.id || cd.collectionId;
      if (id !== pageId) throw new Error("Page settings didn't match this page (" + id + " vs " + pageId + "). Nothing was saved.");
      if (!cd.websiteId) throw new Error("Page settings look incomplete (no websiteId). Nothing was saved.");
      return wrapped;
    });
  }

  function savePageHeader(pageId, nextHeader) {
    // Always a fresh GET right before the POST, then merge only headerInjectCode.
    return getPageSettings(pageId).then(function (current) {
      var previous = current.collectionData.headerInjectCode || "";
      var collectionData = {};
      Object.keys(current.collectionData).forEach(function (k) { collectionData[k] = current.collectionData[k]; });
      collectionData.headerInjectCode = typeof nextHeader === "function" ? nextHeader(previous) : nextHeader;
      var crumb = getCrumb();
      return requestJson("/api/commondata/SaveCollectionSettings", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json; charset=UTF-8",
          "x-csrf-token": crumb
        },
        body: JSON.stringify({ collectionData: collectionData, memberAreaData: current.memberAreaData || {} })
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

  function undoKey(pageId) { return "shape-motion-undo:" + pageId; }

  /* ---------------- editor for one layout ---------------- */

  SM.editor = {
    start: function (phone) {
      var gsap = SM.gsap;
      gsap.registerPlugin(window.MotionPathHelper);

      var list = candidates();
      if (!state.selectedId || !list.some(function (c) { return c.id === state.selectedId; })) {
        var withSettings = list.filter(function (c) { return pageElements()[c.id]; })[0];
        state.selectedId = (withSettings || list[0] || {}).id || null;
      }
      var id = state.selectedId;
      var el = id ? document.getElementById(id) : null;
      var elCfg = id ? pageElements()[id] : null;
      // The settings object this panel edits. null = nothing to edit for this layout.
      var cfg = !elCfg ? null : (phone ? (elCfg.mobile && typeof elCfg.mobile === "object" ? elCfg.mobile : null) : elCfg.desktop);
      SM.editingId = elCfg ? id : null;

      var helper = null, tween = null, output, statusEl;

      function markDirty() { state.dirty = true; state.status = ""; showStatus(); }
      function showStatus() {
        if (!statusEl) return;
        statusEl.textContent = state.status || (state.dirty ? "Unsaved changes" : "All changes saved");
        statusEl.classList.toggle("is-dirty", state.dirty && !state.status);
      }

      // Starter paths, sized to the block but kept on screen (blocks are near full width on phones).
      function openPath() {
        var w = Math.round(Math.min(el.offsetWidth * 0.7, window.innerWidth * 0.13));
        return "M0,0 C" + w + "," + -w * 0.6 + " " + w * 2 + "," + w * 0.6 + " " + w * 3 + ",0";
      }
      function loopPath() {
        var w = Math.round(Math.min(el.offsetWidth * 0.6, window.innerWidth * 0.15));
        return "M0,0 C0,-" + w + " " + w * 2 + ",-" + w + " " + w * 2 + ",0 C" + w * 2 + "," + w + " 0," + w + " 0,0";
      }
      function syncPath() {
        if (!helper || !cfg) return;
        var p = helper.getString().trim();
        if (p !== cfg.path) { cfg.path = p; state.dirty = true; }
      }

      // Where the block sits in the layout with no animation applied (page coordinates).
      function layoutRect() {
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
        tween = SM.buildTween(el, cfg);
        var pos = layoutRect();
        helper = window.MotionPathHelper.create(tween, { pathColor: "#ff3b6b", pathWidth: 3, pathOpacity: 0.9 });
        // The helper always loops while editing; keep our pause between loops ("once" previews with a 1s pause).
        tween.repeatDelay(cfg.playback === "once" ? 1 : cfg.repeatDelay);
        // Draw the path from the anchor point instead of the block's top-left corner.
        var a = cfg.anchor.split(" ").map(parseFloat);
        var svg = document.querySelector("svg.motion-path-helper");
        if (svg) {
          svg.style.left = pos.left + el.offsetWidth * a[0] / 100 + "px";
          svg.style.top = pos.top + el.offsetHeight * a[1] / 100 + "px";
        }
      }

      /* ---- panel ---- */
      var panel = document.createElement("div");
      panel.className = "mph-panel";
      panel.classList.toggle("is-collapsed", state.collapsed);
      document.body.appendChild(panel);

      var head = document.createElement("div");
      head.className = "mph-head";
      var title = document.createElement("strong");
      title.textContent = "Shape Motion";
      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = state.collapsed ? "+" : "–";
      toggle.addEventListener("click", function () {
        state.collapsed = !state.collapsed;
        panel.classList.toggle("is-collapsed", state.collapsed);
        toggle.textContent = state.collapsed ? "+" : "–";
      });
      head.appendChild(title);
      head.appendChild(toggle);
      panel.appendChild(head);

      var body = document.createElement("div");
      body.className = "mph-body";
      panel.appendChild(body);

      function note(text, cls) {
        var n = document.createElement("p");
        n.className = "mph-note" + (cls ? " " + cls : "");
        n.textContent = text;
        body.appendChild(n);
        return n;
      }
      function row(label, control, hint) {
        var r = document.createElement("div");
        r.className = "mph-row";
        var t = document.createElement("span");
        t.textContent = label;
        r.appendChild(t);
        r.appendChild(control);
        if (hint) r.title = hint;
        body.appendChild(r);
        return r;
      }
      function selectEl(options, value, onChange) {
        var s = document.createElement("select");
        options.forEach(function (o) {
          var opt = document.createElement("option");
          opt.value = Array.isArray(o) ? o[0] : o;
          opt.textContent = Array.isArray(o) ? o[1] : o;
          s.appendChild(opt);
        });
        s.value = value;
        s.addEventListener("change", function () { onChange(s.value); });
        return s;
      }
      function button(text, onClick, cls) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        if (cls) b.className = cls;
        b.addEventListener("click", function () { onClick(b); });
        return b;
      }
      function actions(buttons) {
        var wrap = document.createElement("div");
        wrap.className = "mph-actions";
        buttons.forEach(function (b) { wrap.appendChild(b); });
        body.appendChild(wrap);
        return wrap;
      }

      // Element picker
      if (!list.length) {
        note("No shape blocks on this page.");
      } else {
        row("Element", selectEl(list.map(function (c) {
          return [c.id, (pageElements()[c.id] ? "● " : "○ ") + c.label + " · " + c.id.replace(/^block-/, "").slice(-6)];
        }), id, function (v) {
          state.selectedId = v;
          SM.restart();
        }), "● = has an animation");
      }

      if (el && !elCfg) {
        if (isSiteElement(el)) {
          note("This is in the site header/footer. Saving those comes in a later version.");
        } else {
          note("No animation on this element yet.");
          actions([button("Add animation", function () {
            var d = copySettings(SM.DEFAULT_SETTINGS);
            d.path = openPath();
            pageElements()[id] = { desktop: d, mobile: "off" };
            markDirty();
            SM.restart();
          }, "is-primary")]);
        }
      } else if (elCfg && !el) {
        note("This element isn't on the page anymore (deleted or duplicated page?).");
      }

      if (el && elCfg) {
        var layout = document.createElement("div");
        layout.className = "mph-layout";
        layout.textContent = phone ? "Phone settings · 767px and below" : "Desktop settings · 768px and up";
        body.appendChild(layout);

        if (phone) {
          var mode = elCfg.mobile && typeof elCfg.mobile === "object" ? "own" : (elCfg.mobile === "same" ? "same" : "off");
          row("On phones", selectEl([["off", "Off (stays still)"], ["same", "Same as desktop"], ["own", "Own settings"]], mode, function (v) {
            if (v === "own") {
              var s = copySettings(elCfg.desktop);
              s.path = openPath();
              elCfg.mobile = s;
            } else {
              elCfg.mobile = v;
            }
            markDirty();
            SM.restart();
          }), "What this element does on phones (767px and below)");
        } else {
          var summary = elCfg.mobile === "same" ? "same as desktop" : (elCfg.mobile && typeof elCfg.mobile === "object" ? "own settings" : "off (stays still)");
          note("Phones: " + summary + ". Switch to Mobile view to change.");
        }

        if (cfg) buildControls();
        else if (phone && elCfg.mobile === "same") {
          note("Using the desktop settings. Switch to Desktop view to edit them, or pick \"Own settings\".");
          tween = SM.buildTween(el, elCfg.desktop); // preview only
        } else if (phone) {
          note("The element stays in its normal spot on phones.");
        }

        actions([button("Remove animation", function () {
          if (!window.confirm("Remove the animation from this element? (Nothing is saved until you click Save.)")) return;
          delete pageElements()[id];
          markDirty();
          SM.restart();
        }, "is-quiet")]);
      }

      // Save area
      var saveBox = document.createElement("div");
      saveBox.className = "mph-save";
      body.appendChild(saveBox);
      statusEl = document.createElement("p");
      statusEl.className = "mph-status";
      saveBox.appendChild(statusEl);
      var pageId = SM.pageId();
      var saveActions = document.createElement("div");
      saveActions.className = "mph-actions";
      saveBox.appendChild(saveActions);

      saveActions.appendChild(button("Save to page", function (btn) {
        if (!pageId) { state.status = "Couldn't find this page's ID. Use Copy code instead."; showStatus(); return; }
        syncPath();
        var count = Object.keys(pageElements()).length;
        if (!window.confirm("Save animations for " + count + " element" + (count === 1 ? "" : "s") +
          " to this page's Header Code Injection?\n\nOnly the Shape Motion block is replaced. Anything else in that box is kept.")) return;
        btn.disabled = true;
        state.status = "Saving…"; showStatus();
        savePageHeader(pageId, function (previous) { return replaceManagedBlock(previous, managedBlock()); })
          .then(function (previous) {
            try { sessionStorage.setItem(undoKey(pageId), previous); } catch (e) { /* undo unavailable */ }
            state.dirty = false;
            state.status = "Saved ✓";
          })
          .catch(function (err) {
            state.status = "Save failed: " + err.message.replace(/\.?$/, ".") + " Nothing was changed. Use Copy code as a fallback.";
          })
          .then(function () { btn.disabled = false; showStatus(); undoBtn.hidden = !hasUndo(); });
      }, "is-primary"));

      function hasUndo() {
        try { return sessionStorage.getItem(undoKey(pageId)) !== null; } catch (e) { return false; }
      }
      var undoBtn = button("Undo last save", function (btn) {
        var previous;
        try { previous = sessionStorage.getItem(undoKey(pageId)); } catch (e) { previous = null; }
        if (previous === null) return;
        if (!window.confirm("Put this page's Header Code Injection back to how it was before your last save? The page will reload.")) return;
        btn.disabled = true;
        state.status = "Undoing…"; showStatus();
        savePageHeader(pageId, previous).then(function () {
          try { sessionStorage.removeItem(undoKey(pageId)); } catch (e) { /* ignore */ }
          location.reload();
        }).catch(function (err) {
          state.status = "Undo failed: " + err.message;
          btn.disabled = false;
          showStatus();
        });
      });
      undoBtn.hidden = !hasUndo();
      saveActions.appendChild(undoBtn);

      saveActions.appendChild(button("Copy code", function (btn) {
        syncPath();
        output.value = managedBlock();
        output.hidden = false;
        var done = function () { btn.textContent = "Copied!"; setTimeout(function () { btn.textContent = "Copy code"; }, 1200); };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(output.value).then(done);
        else { output.select(); document.execCommand("copy"); done(); }
      }));

      output = document.createElement("textarea");
      output.readOnly = true;
      output.rows = 5;
      output.hidden = true;
      output.title = "Paste into Page Settings > Advanced > Page Header Code Injection";
      saveBox.appendChild(output);
      showStatus();

      if (cfg) rebuild();

      function buildControls() {
        function slider(label, key, min, max, step, fmt, hint) {
          var wrap = document.createElement("span");
          wrap.className = "mph-slider";
          var input = document.createElement("input");
          input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = cfg[key];
          var val = document.createElement("em");
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

        var rot = document.createElement("input");
        rot.type = "checkbox";
        rot.checked = cfg.autoRotate;
        rot.addEventListener("change", function () { cfg.autoRotate = rot.checked; markDirty(); rebuild(); });
        row("Auto-rotate", rot, "Turn to face the direction of travel");
        slider("Rotate offset", "rotateOffset", -180, 180, 5, function (v) { return v + "°"; });

        var grid = document.createElement("span");
        grid.className = "mph-anchor";
        ANCHORS.forEach(function (a) {
          var b = document.createElement("button");
          b.type = "button";
          b.title = a;
          b.classList.toggle("is-active", a === cfg.anchor);
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
          button("New A→B path", function () { rebuild(openPath()); }),
          button("New loop path", function () { rebuild(loopPath()); })
        ]);
      }

      return {
        el: el,
        stop: function () {
          syncPath();                    // keep unsaved path edits for when the editor comes back
          if (helper) helper.kill();     // removes the path overlay and reverts the tween
          else if (tween) tween.revert();
          helper = tween = null;
          panel.remove();
        }
      };
    }
  };

  // Mark path drags as unsaved changes (the helper doesn't tell us directly).
  document.addEventListener("pointerup", function (e) {
    if (e.target && e.target.closest && e.target.closest("svg.motion-path-helper, .motion-path-helper, [class*='path-editor']")) {
      state.dirty = true;
      state.status = "";
      var s = document.querySelector(".mph-status");
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
    ".mph-panel{position:fixed;top:80px;right:12px;z-index:10000;width:290px;max-height:calc(100vh - 100px);overflow:auto;padding:10px 12px;border-radius:10px;background:rgba(20,20,20,.92);color:#fff;font:12px/1.3 system-ui,-apple-system,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)}",
    ".mph-panel *{box-sizing:border-box;font:inherit;color:inherit;letter-spacing:normal;text-transform:none}",
    ".mph-head{display:flex;justify-content:space-between;align-items:center}",
    ".mph-head button{all:unset;cursor:pointer;padding:0 6px;font-size:16px}",
    ".mph-panel.is-collapsed .mph-body{display:none}",
    ".mph-body{display:flex;flex-direction:column;gap:8px;margin-top:10px}",
    ".mph-layout{padding:4px 8px;border-radius:4px;background:rgba(255,59,107,.2);color:#ffc2d1}",
    ".mph-note{margin:0;opacity:.7}",
    ".mph-row{display:grid;grid-template-columns:92px 1fr;align-items:center;gap:8px;margin:0}",
    ".mph-row>span:first-child{opacity:.75}",
    ".mph-slider{display:flex;align-items:center;gap:6px}",
    ".mph-slider input{flex:1;min-width:0;accent-color:#ff3b6b}",
    ".mph-slider em{font-style:normal;flex:0 0 40px;text-align:right;opacity:.85}",
    ".mph-panel select{width:100%;padding:3px 4px;border-radius:4px;border:0;background:#333}",
    ".mph-panel input[type=checkbox]{justify-self:start;accent-color:#ff3b6b;width:16px;height:16px}",
    ".mph-anchor{display:grid;grid-template-columns:repeat(3,18px);gap:4px}",
    ".mph-anchor button{all:unset;cursor:pointer;width:18px;height:18px;border-radius:3px;background:rgba(255,255,255,.18)}",
    ".mph-anchor button.is-active{background:#ff3b6b}",
    ".mph-actions{display:flex;flex-wrap:wrap;gap:4px}",
    ".mph-actions button{all:unset;cursor:pointer;padding:5px 8px;border-radius:4px;background:rgba(255,255,255,.14)}",
    ".mph-actions button:hover{background:rgba(255,255,255,.28)}",
    ".mph-actions button[disabled]{opacity:.5;cursor:default}",
    ".mph-actions button[hidden]{display:none}",
    ".mph-panel .mph-actions button.is-primary{background:#ff3b6b}",
    ".mph-panel .mph-actions button.is-quiet{background:none;opacity:.6;padding-left:0}",
    ".mph-save{display:flex;flex-direction:column;gap:6px;padding-top:8px;border-top:1px solid rgba(255,255,255,.15)}",
    ".mph-status{margin:0;opacity:.8}",
    ".mph-status.is-dirty{color:#ffd166;opacity:1}",
    ".mph-panel textarea{width:100%;resize:vertical;padding:6px;border:0;border-radius:4px;background:#111;font:11px/1.35 ui-monospace,Menlo,monospace}",
    ".mph-panel textarea[hidden]{display:none}"
  ].join("\n");
  document.head.appendChild(style);
})();
