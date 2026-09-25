# Project notes for Claude

Squarespace 7.1 custom code: GSAP MotionPath + MotionPathHelper for built-in shape blocks.
See README.md for usage and the CONFIG reference.

## Hard constraints
- **No access to the live site.** The user pastes code into Squarespace Code Injection and sends back
  a saved HTML copy of the page, or copied config. All testing happens on `svg-test-page.html`
  locally.
- **Always wait for the DOM** (`DOMContentLoaded`) before touching the page. Anything that measures
  layout (e.g. MotionPathHelper overlays) waits for window `load`.
- Target shape blocks with **`[data-sqsp-block="shape"]`** (plus the block `id` when targeting one).
  Shape name is on a descendant: `[data-shape-name]`.
- Deliverable: `src/runtime.js` + `src/editor.js`, served by jsDelivr from tagged releases
  (`gh/bergendesignco/shape-motion-plugin@vX.Y.Z/src/runtime.js`). Plain ES5-style vanilla JS (fetch and
  Promise are fine), no build step, no modules. GSAP from `cdn.jsdelivr.net/npm/gsap@3.14.1/dist/`, and the
  site's own GSAP is reused if present.
- Only one `gsap.min.js` per page, and plugin versions must match the core version.
- Don't use `innerHTML` (a security hook blocks it). Build the DOM with `createElement` / `textContent`.

## Repo / direction
- GitHub: https://github.com/bergendesignco/shape-motion-plugin (public; served by jsDelivr `gh/`).
- Direction and order: ROADMAP.md. Saving to Squarespace: docs/squarespace-saving.md (GET→merge→POST,
  marker-safe, never post partial objects).
- The GSAP and schema Chrome extensions are **reference only**: read their docs/code for Squarespace
  knowledge, never import from them or change them. **Be thorough:** read their actual code, decision
  logs (`_project/DECISIONS.md`), findings and raw captures (`research and planning docs/_raw-data/`),
  not just summary docs. Summary docs missed the `collectionId` rule and a save created a stray page.
- **Page save rule:** the POST's `collectionData` must carry BOTH `id` and `collectionId`. The GET is flat
  and lacks `collectionId`, and without it Squarespace creates a NEW page. The dev-server mock enforces
  this.

## Workflow
- Edit `src/*.js`, run `python3 build-test-page.py`, and serve with `python3 dev-server.py` (port 8765,
  `.claude/launch.json` → `dev`). The dev server mocks GetCollectionSettings/SaveCollectionSettings
  (state in `.dev-store.json`) and injects the saved header code into the test page.
- Never edit `svg-test-page.html`. It's the fixture. When the user sends a new saved page, replace it.
- Verify three contexts: visitor (`/svg-test-page-motionpath.html`), editor (`/sim/config/`), and
  Edit mode on/off (the sim's Edit button). Observer callbacks are async, so wait before asserting.

## Code layout
- Settings live in `<script type="application/json" data-shape-motion="page|site">` tags:
  `{ version: 1, elements: { "<element id>": { desktop: {settings}, mobile: "off"|"same"|{settings} } } }`.
- `runtime.js` → `window.ShapeMotion`: reads the tags, `elements()` merges site+page, `settingsFor()`,
  `buildTween()`, `restart()`. It loads GSAP/MotionPath (+ MotionPathHelper + editor.js when editing)
  only when needed. A MutationObserver on body class + the 767px query call `refresh()`.
- `editor.js` sets `ShapeMotion.editor = { editingId(), start(phone) → {el, stop} }`. UI: a badge per
  shape block (placed from the non-animated `.fe-block` container), a floating draggable panel for the
  selected element only, and a save bar. The editor animates the selected element itself. The runtime
  asks `editingId()` BEFORE starting tweens so it isn't animated twice. State survives restarts in
  `state` (selectedId, panelPos, dirty). No element names/dropdowns: users click the element's badge.
  Save = GET → replace the marked block in `headerInjectCode` → POST (docs/squarespace-saving.md).
- `legacy/motionpath-helper-snippet.html` is the old single-shape paste-in snippet (not maintained).

## Triggers
- `SM.animate(el, settings)` runs one element with its trigger and returns `stop()`. appear/scroll use
  ScrollTrigger with `trigger: SM.anchorBox(el)` (the non-animated `.fe-block`). hover/click listen on
  that box too. Non-load triggers render the path start immediately (`immediateRender`) so fly-ins wait
  off to the side.
- GSAP extension findings (dev/content.js, src/v2/runtime/library.js, docs QA matrix T-047a): default
  appear start `top 85%`; its editor preview strips scrollTrigger; scroll inside the Squarespace
  editor is not the real page scroll.
- Confirmed on the real editor (2026-09-25): a scroll-driven shape jumped to the END of its path inside
  the editor. So when `SM.inSquarespaceEditor()`, appear/scroll hold at the path start (no ScrollTrigger)
  and the panel's Test trigger simulates them (scroll = progress slider, appear = play). Hover/click
  run for real in the editor (confirmed working by the user).
- Scroll-driven uses `start: "clamp(top bottom)"` / `end: "clamp(bottom top)"` so shapes visible at load
  start at progress 0.

## Page facts (from the saved page)
- 6 shape blocks in section 1: rectangle (`block-yui_3_17_2_1_1790263224900_423`), narrow-pow,
  circle, stepped-cross, triangle, hourglass. Shape SVGs use `preserveAspectRatio="none"`.
- The footer also runs the sqspninja image-trail plugin, which needs GSAP.

## Squarespace editor facts
Verified by diffing the saved edit-mode vs. non-edit-mode editor pages in
`~/Documents/chrome-extensions/gsap-sqsp-extension/examples and docs/squarespace editor webpage examples/`.
That's a separate project: read it for reference only, don't change or couple to it.
- The editor page (`/config/...`, `body.squarespace-config`) holds the site in `iframe#sqs-site-frame`,
  on the same origin. Code Injection runs **inside** the iframe.
- Edit mode on: the site's `<body>` gets `sqs-edit-mode-active sqs-is-page-editing` (plus
  `is-expanded sqs-hide-overlay-widgets`), and the outer `<html>` gets `editing-page`.
- The site's `<html>` has `data-authenticated-account` inside the editor, and it's missing from the
  public saved page. It means logged in: checked on the real site, where the editor panel
  doesn't show for logged-out visitors (2026-09-24).
- Device preview: the site's `<body>` has `sqs-device-view-desktop`, which switches to
  `sqs-device-view-phone` when the editor is in mobile view (seen by the user on the real editor,
  2026-09-24). The class exists only in the editor (missing from the live saved page), so the snippet
  trusts it when present and falls back to `(max-width: 767px)` on the live site. Don't use width
  inside the editor: the frame can be under 767px in desktop view.
  Switching views re-lays out the page, so the editor overlay (pinned at creation) has to be rebuilt.
- Confirmed from `svg-desktop-editor.html` / `svg-mobile-editor.html` (user's editor saves, copied
  from DevTools with the iframe's `#document` inline, git-ignored because they contain the account
  email and IDs): the only class difference between the views is `sqs-device-view-desktop` vs
  `sqs-device-view-phone`. The site's `<body>` also has `sqs-edit-mode` even when NOT editing, so never
  match on that. Use `sqs-edit-mode-active` / `sqs-is-page-editing`.
- `sim/config/index.html` reproduces this locally (Edit and Phone view toggles).
- Browser pane gotcha: the pane is ~733px wide, which counts as phone on the live test page. Use
  `resize_window` at 1100px width to test desktop.

## MotionPathHelper gotchas (checked against the 3.14.1 source)
- `helper.kill()` also reverts its tween, so rebuild the tween after killing it.
- The helper forces `repeat(-1).repeatDelay(1)` on the tween. Re-apply repeatDelay afterwards.
- For HTML targets it appends `svg.motion-path-helper` to `<body>`, positioned at the target's page
  rect minus the current x/y. That rect is wrong when the target is rotated, so the snippet measures
  the untransformed rect itself and repositions the SVG.
- `getString()` returns path data relative to the element's start (`M0,0 ...`), ready for `CONFIG.path`.
- Add a point = Alt-click the path. Delete = select, then Delete key.
