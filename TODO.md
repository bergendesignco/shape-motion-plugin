# TODO

## Up next
- [ ] **Disable in Squarespace edit mode.** Don't run the animation or the editor while the page is
      being edited in Squarespace, since moving blocks fight with dragging and resizing them. Needs a
      reliable way to detect edit mode. Candidates to verify on a saved editor page: the
      `sqs-edit-mode-active` body class, or the page running inside the Squarespace frame
      (`window.top !== window.self`). It should also react when the user toggles edit mode, not just
      on load.
- [ ] **Editor only for the site owner, never on the live page.** Public visitors should only get the
      animation, never the path editor or panel. Replace the manual `SHOW_EDITOR` flag / `?mph`
      with detection of a logged-in owner or the Squarespace preview frame. Keep `?mph` as a manual
      override.

## Bigger ideas
- [ ] **Chrome extension or pop-out panel for editing and saving.** Open the editor on the live site
      from an extension instead of shipping editor code in the snippet. Save the config without
      copy/paste (extension storage, or generate the final snippet ready to paste).
- [ ] **MorphSVG.** Morph Squarespace shapes into each other, e.g. circle → stepped-cross, possibly
      while travelling the path. Shape SVGs are simple `<path>`/`<circle>`/`<polygon>` with
      `viewBox="0 0 100 100"` or `0 0 100 150`, so they're a good fit for `MorphSVGPlugin.convertToPath`.
      The rectangle shape uses a CSS-sized `<rect>` (no numeric attributes) and needs special handling.

## Backlog (from README)
- [ ] Start on scroll into view, or scrub with scroll (ScrollTrigger)
- [ ] Multiple shapes, each with its own editor and controls
- [ ] Shape picker: click a shape on the page to edit it
- [ ] Auto-save config (e.g. localStorage) instead of copy/paste
- [ ] Breakpoint-specific paths (desktop vs. mobile), or paths that scale with the block
