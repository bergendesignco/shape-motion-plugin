# TODO

The big picture and order are in [ROADMAP.md](ROADMAP.md). Save research: [docs/squarespace-saving.md](docs/squarespace-saving.md).

## Up next
- [x] **Disable in Squarespace edit mode.** Watches the site `<body>` for `sqs-edit-mode-active` /
      `sqs-is-page-editing` and stops/restarts. Tested in `sim/config/` and on the real
      site (2026-09-24).
- [x] **Editor only for the site owner, never on the live page.** Shows only inside the Squarespace
      editor frame or with `data-authenticated-account`, and `?mph` still forces it. Checked on the real
      site (2026-09-24).
- [x] **Off on mobile by default.** `CONFIG.mobile` (panel: "Run on mobile"). It uses the editor's device-view class
      and the 767px media query on the live site. Tested in `sim/config/`, at live widths, and in the
      real editor (2026-09-24).
- [x] **Separate mobile animation settings.** `CONFIG = { block, desktop, mobile: "off" | "same" | {…} }`.
      The panel shows which layout it's editing. The On phones dropdown in Mobile view replaced the checkbox.
      Tested in `sim/config/` and at live widths. Approved by the user (2026-09-24).
- [ ] **Rethink panel controls and wording.** The user isn't sold on the current controls/labels
      (2026-09-24). Revisit layout, naming and grouping once the feature set settles.
- [ ] **CDN + save straight to the site (next).** Plugin on jsDelivr from this repo. Settings saved as
      marked JSON tags to the page header injection (page elements) or site-wide injection
      (header/footer elements). Endpoints and safety rules: `docs/squarespace-saving.md`.
- [ ] **Scroll triggers (after CDN/saving and detection).** Per-layout `trigger`: `"load"` (default,
      current behavior), `"view"` (play when it scrolls into view), `"scroll"` (scrubbed by scroll). Use the
      block's `.fe-block` parent as the trigger element, not the animated block. Refresh after load. In the
      editor, keep the looping preview for path editing and add a "Preview scroll" toggle that runs the
      visitor version. Ship `"view"` first, then `"scroll"`.

## Bigger ideas
- [ ] **Chrome extension or pop-out panel for editing and saving.** Open the editor on the live site
      from an extension instead of shipping editor code in the snippet. Saving would go through
      "Save straight to the site" above.
- [ ] **MorphSVG.** Morph Squarespace shapes into each other, e.g. circle → stepped-cross, possibly
      while travelling the path. Shape SVGs are simple `<path>`/`<circle>`/`<polygon>` with
      `viewBox="0 0 100 100"` or `0 0 100 150`, so they're a good fit for `MorphSVGPlugin.convertToPath`.
      The rectangle shape uses a CSS-sized `<rect>` (no numeric attributes) and needs special handling.

## Backlog (from README)
- [ ] Multiple shapes, each with its own editor and controls
- [ ] Shape picker: click a shape on the page to edit it
- [ ] Auto-save config (e.g. localStorage) instead of copy/paste
- [ ] Paths that scale with the block instead of fixed pixels
