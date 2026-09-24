# TODO

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
- [ ] **Save straight to the site (no copy/paste).** A "Save to site" button that writes the current
      CONFIG into the footer Code Injection. It could work from the snippet itself: it runs same-origin
      inside the editor for a logged-in owner. Squarespace has internal (undocumented) endpoints
      `GET /api/config/GetInjectionSettings?crumb=…` and `POST /api/config/SaveInjectionSettings?crumb=…`
      (crumb = CSRF cookie). Noted from the separate gsap-sqsp-extension docs; verify on a test site before relying
      on them. Must be read-modify-write: replace only the CONFIG block between clear markers
      (e.g. `/* CONFIG START */ … /* CONFIG END */`), never the rest of the footer. Show a diff/confirm
      step before saving and keep the previous footer for undo. Internal API can change, so keep
      Copy code as the fallback.

## Bigger ideas
- [ ] **Chrome extension or pop-out panel for editing and saving.** Open the editor on the live site
      from an extension instead of shipping editor code in the snippet. Saving would go through
      "Save straight to the site" above.
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
