# TODO

## Up next
- [x] **Disable in Squarespace edit mode.** Watches the site `<body>` for `sqs-edit-mode-active` /
      `sqs-is-page-editing` and stops/restarts. Tested in `sim/config/` and on the real
      site (2026-09-24).
- [x] **Editor only for the site owner, never on the live page.** Shows only inside the Squarespace
      editor frame or with `data-authenticated-account`, and `?mph` still forces it. Checked on the real
      site (2026-09-24).
- [x] **Off on mobile by default.** `CONFIG.mobile` (panel: "Run on mobile"). It uses the editor's device-view class
      and the 767px media query on the live site. Tested in `sim/config/` and at live widths.
- [ ] **Separate mobile animation settings.** Paths are in pixels and the mobile layout places blocks
      differently, so mobile needs its own settings: its own path plus duration, ease, playback and so on,
      (turning it off on mobile is done). Probably a `CONFIG.mobile` block of overrides applied with
      `gsap.matchMedia()` at Squarespace's 767px breakpoint on the live site. In the editor, the site
      `<body>` switches `sqs-device-view-desktop` → `sqs-device-view-phone` in mobile view: watch that
      class to swap settings and switch the panel to the mobile settings. Restart-on-view-change and the
      sim's device toggle already exist.

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
- [ ] Paths that scale with the block instead of fixed pixels
