# Shape Motion for Squarespace

Move Squarespace **shape blocks** along custom paths with GSAP's
[MotionPathPlugin](https://gsap.com/docs/v3/Plugins/MotionPathPlugin/). You draw and tune the paths
right on the page in the Squarespace editor, and they save straight to the site with no copying
and pasting of code.

## Install

Add **one line** to **Settings → Advanced → Code Injection → Footer**:

```html
<script src="https://cdn.jsdelivr.net/gh/bergendesignco/shape-motion-plugin@v0.1.0/src/runtime.js"></script>
```

- If your footer already loads `gsap.min.js` (e.g. for another plugin), keep it. Shape Motion reuses
  it. Otherwise it loads GSAP 3.14.1 itself, only on pages that have animations.
- Add `data-editor="off"` to the tag to never load the editor.
- Remove the old copy/paste snippet (`legacy/motionpath-helper-snippet.html`) if it's installed, or
  shapes get animated twice.

## Using the editor

Open a page in the Squarespace editor (not in Edit mode). Only you see the editor. Visitors never do.

1. **Badges:** every shape block gets a small badge in its top-left corner. **+** means no animation
   yet, and a pink dot means it's animated. Hover a badge to outline its block.
2. **Click a badge** to open that element's panel (clicking **+** adds a starter animation first). The
   panel opens next to the element. Drag it by its header, and close it with ✕ or Esc.
3. **Edit the path** on the page:

   | Action | How |
   |---|---|
   | Move a point / bend a curve | Drag anchors / handles |
   | Add a point | **Option/Alt-click** the path |
   | Delete a point | Click it, then **Delete/Backspace** |
   | Toggle smooth ↔ corner | Option/Alt-click a point |
   | Bend one side only | Option/Alt-drag a handle |
   | Undo | Cmd/Ctrl+Z |

4. **Pick a trigger** and adjust settings in the panel. Only the options that apply to that trigger
   show:

   | Trigger | What happens | Its options |
   |---|---|---|
   | Page load | Plays right away (the default) | Duration, delay, playback, pause |
   | When it appears | Waits at the start of its path, plays when scrolled into view | Starts when (just visible / a bit in / halfway), Replay (first time / every time / reverse on scroll back) |
   | Scroll-driven | Scrolling moves it along the path, backwards when scrolling up | Moves while (crossing the screen / up to the middle), Smoothing |
   | Hover | Plays while hovered | On leave: go back / finish the trip |
   | Click | Plays on click (pointer cursor) | Each click: there then back / replay |

   Hover and click listen on the block's spot (its layout box), so the shape moving away from the
   cursor doesn't cancel the hover. **Test trigger** swaps the looping path preview for the real
   behavior; **← Back to editing the path** returns. Scrolling inside the Squarespace editor isn't the
   real page scroll, so in the editor **appear** and **scroll** shapes sit still at the start of their
   path. Test trigger simulates them instead: a **Scroll position** slider for scroll-driven, **Play
   again** for appear. Check the real scrolling on the live page. Scroll-driven uses `clamp()`, so a
   shape already on screen at the top of the page starts at the start of its path and finishes by the
   time the page can't scroll any further. **Remove animation** is at the bottom.
5. **Phones:** switch the editor to **Mobile** view. The panel's **On phones** option picks Off
   (default), Same as desktop, or Own settings.
6. **Save** (in the bar, bottom-right) writes every element's settings on this page into its **Page
   Header Code Injection** in one go. Only the Shape Motion block in that box is replaced, and anything
   else there is kept. **Undo save** puts it back. **Copy** is the manual fallback: paste into Page
   Settings → Advanced → Page Header Code Injection. If saved settings point at blocks that no longer
   exist, the bar offers **Clean up**.

While Edit mode is on, all animations stop so you can drag and resize blocks.

## How settings are stored

Settings are data, not code, in the page's header injection:

```html
<!-- SHAPE-MOTION-START -->
<script type="application/json" data-shape-motion="page">
{ "version": 1, "elements": {
    "block-…": { "desktop": { …settings }, "mobile": "off" | "same" | { …settings } }
} }
</script>
<!-- SHAPE-MOTION-END -->
```

A `data-shape-motion="site"` tag in the site-wide injection is also read (for site header/footer
elements); page settings win. The editor doesn't save site-wide settings yet.

**Settings keys:**

| Key | Values | Meaning |
|---|---|---|
| `path` | SVG path string | Pixels. `M0,0` = the block's normal spot in the layout |
| `duration` | seconds | One trip along the path |
| `delay` | seconds | Wait before the first run |
| `ease` | GSAP ease | e.g. `"none"`, `"power2.inOut"`, `"back.out(1.7)"` |
| `playback` | `"loop"` / `"yoyo"` / `"once"` | Restart, back and forth, or play once |
| `repeatDelay` | seconds | Pause between loops |
| `start`, `end` | 0–1 | Portion of the path to travel |
| `home` | `"start"` / `"end"` | Which end of the path is the block's layout spot. `"end"` = flies **into** place |
| `autoRotate` | bool | Face the direction of travel |
| `rotateOffset` | degrees | Extra rotation when auto-rotating |
| `anchor` | `"x% y%"` | Point on the shape that rides the path and acts as the rotation pivot |
| `trigger` | `"load"` / `"appear"` / `"scroll"` / `"hover"` / `"click"` | What starts it (missing = `"load"`) |
| `appearAt` | ScrollTrigger start, e.g. `"top 85%"` | appear: how far into view |
| `replay` | `"once"` / `"every"` / `"reverse"` | appear: replay behavior |
| `scrub` | seconds (0 = locked) | scroll: smoothing |
| `scrollRange` | `"cross"` / `"center"` | scroll: enters bottom → leaves top, or → middle |
| `hoverLeave` | `"reverse"` / `"finish"` | hover: what leaving does |
| `clickMode` | `"toggle"` / `"replay"` | click: what each click does |

Hover, click and scroll make a single trip along the path (playback/repeat is ignored). Appear uses
the playback setting once it starts.

## How it works

- `src/runtime.js` (visitors) waits for `DOMContentLoaded` and reads the settings tags. ScrollTrigger
  is loaded only when a saved animation uses appear/scroll (and positions are re-measured after
  `load`). If there's
  nothing to animate and no editor is needed, it stops before loading anything.
- The editor (`src/editor.js` + MotionPathHelper) loads only inside the Squarespace editor frame, when
  `<html>` has `data-authenticated-account`, or with `?mph` in the URL.
- A `MutationObserver` on `<body>`'s class restarts everything when Edit mode
  (`sqs-edit-mode-active` / `sqs-is-page-editing`) or the device view changes
  (`sqs-device-view-phone` in the editor, a 767px media query on the live site).
- Saving: see [docs/squarespace-saving.md](docs/squarespace-saving.md). It reads the page settings,
  changes only the header injection field, and posts the whole object back. `window.ShapeMotion`
  exposes the internals for debugging.

## Known limitations

- Paths are in pixels, so they don't scale within a breakpoint. Tablets (768px and up) get the
  desktop settings.
- The editor path overlay doesn't follow window resizes. Reload after resizing.
- With auto-rotate on, the shape ends at the path's final angle.
- Sections may clip shapes that travel outside them.
- Shape blocks only (SVGs in code blocks come next). Site header/footer elements can't be saved yet.
- Saving uses Squarespace's internal endpoints, which could change. Copy code always works.

## Development

| File | What it is |
|---|---|
| `src/runtime.js`, `src/editor.js` | **The plugin**, served by jsDelivr from tagged releases. |
| `dev-server.py` | Local server: static files + a mock of Squarespace's page-settings save API. |
| `build-test-page.py` | Builds the test page from the saved page + the one-line install. |
| `svg-test-page.html` | Saved copy of the live page. Test fixture, don't edit. |
| `sim/config/index.html` | Local stand-in for the Squarespace editor (iframe, Edit and Phone view toggles). |
| `legacy/` | The old copy/paste snippet. |
| `ROADMAP.md`, `TODO.md` | Direction and planned work. |
| `docs/squarespace-saving.md` | How saving to Squarespace Code Injection works. |
| `CLAUDE.md` | Project notes for AI assistants. |

```bash
python3 build-test-page.py
```

```bash
python3 dev-server.py
```

- <http://localhost:8765/svg-test-page-motionpath.html>: the page as a **visitor** sees it.
- <http://localhost:8765/sim/config/>: the page inside a **simulated Squarespace editor**, with a
  working (mock) **Save**.

The mock keeps its state in `.dev-store.json`. Delete it to reset. It rejects the mistakes that lose
data on the real site (partial objects, wrong page, changed SEO fields).

**Releasing:** tag a version (`git tag v0.x.y && git push --tags`) and update the version in the
install line. jsDelivr serves `@v0.x.y` permanently.
