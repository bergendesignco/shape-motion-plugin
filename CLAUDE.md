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
- Verify in a browser with the editor on AND with `SHOW_EDITOR = false`.

## Page facts (from the saved page)
- 6 shape blocks in section 1: rectangle (`block-yui_3_17_2_1_1790263224900_423`), narrow-pow,
  circle, stepped-cross, triangle, hourglass. Shape SVGs use `preserveAspectRatio="none"`.
- The footer also runs the sqspninja image-trail plugin, which needs GSAP.

## MotionPathHelper gotchas (checked against the 3.14.1 source)
- `helper.kill()` also reverts its tween, so rebuild the tween after killing it.
- The helper forces `repeat(-1).repeatDelay(1)` on the tween. Re-apply repeatDelay afterwards.
- For HTML targets it appends `svg.motion-path-helper` to `<body>`, positioned at the target's page
  rect minus the current x/y. That rect is wrong when the target is rotated, so the snippet measures
  the untransformed rect itself and repositions the SVG.
- `getString()` returns path data relative to the element's start (`M0,0 ...`), ready for `CONFIG.path`.
- Add a point = Alt-click the path. Delete = select, then Delete key.
