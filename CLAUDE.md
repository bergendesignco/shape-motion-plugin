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
- Deliverable is a single paste-in snippet: plain ES5-style vanilla JS, no build step, no modules.
  CDN only: `cdn.jsdelivr.net/npm/gsap@3.14.1/dist/...`.
- Only one `gsap.min.js` per page, and plugin versions must match the core version.
- Don't use `innerHTML` (a security hook blocks it). Build the DOM with `createElement` / `textContent`.

## Workflow
- Edit `motionpath-helper-snippet.html`, then run `python3 build-test-page.py` and serve with
  `python3 -m http.server 8765` (also configured in `.claude/launch.json` as `static`).
- Never edit `svg-test-page.html`. It's the fixture. When the user sends a new saved page, replace it.
- Verify three contexts: visitor (`/svg-test-page-motionpath.html`), editor (`/sim/config/`), and
  Edit mode on/off (the sim's Edit button). Observer callbacks are async, so wait before asserting.

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
