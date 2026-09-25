# Roadmap

## The goal
A Squarespace plugin you install with **one CDN line**. It finds animatable elements (shape blocks,
SVGs in code blocks, …), shows **clickable indicators** in the editor so you can add an animation to
any of them, and **saves the settings to the site automatically**. There's no copying and pasting of
code.

This is its own project. It borrows *knowledge* from the GSAP and schema Chrome extensions (how the
Squarespace editor and its save endpoints work) but shares no code with them.

## Architecture (decided 2026-09-25)
- **Plugin code:** hosted in this public repo, served by jsDelivr
  (`https://cdn.jsdelivr.net/gh/bergendesignco/shape-motion-plugin@<tag>/…`). The user adds one
  `<script src>` line to the site-wide footer.
  - Visitors load a small runtime. If the page has no saved animations, it stops without loading GSAP.
  - The editor code (panel, indicators, MotionPathHelper) loads only for a logged-in editor.
- **Settings are data, not code**, saved in marked `<script type="application/json" data-shape-motion>`
  tags:
  - **Page elements** go in that page's header injection, so nothing is scanned or stored for pages
    without animations.
  - **Site header/footer elements** go in the site-wide injection.
  - Page settings win over site-wide settings for the same element.
- Saving follows `docs/squarespace-saving.md`: read → merge → write, marker-safe, confirm, undo,
  with copy/paste as the fallback.

## Order
1. **CDN + saving** ← next
   - Split the current snippet into `src/runtime.js` (visitor) and `src/editor.js` (editor), with no
     build step.
   - Runtime reads the settings tags (page + site). The current single-square `CONFIG` becomes the
     first element in the new format.
   - Editor: a "Save" button that writes this page's settings to its header injection (and site-wide
     for header/footer elements), plus an undo.
   - Tag `v0.1.0`, give the user the one-line install.
2. **Detection + indicators:** shape blocks first, then SVGs in code blocks. Click an element to add or
   edit its animation. Many elements per page.
3. **Features** as per-element settings: scroll (see the scroll plan in TODO.md), then MorphSVG, …

Each step goes on its own branch and gets tested on the real site before it's merged.
