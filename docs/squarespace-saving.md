# Saving to Squarespace Code Injection

Research notes for saving animation settings straight to the site (no copy/paste).

Sources: read-only review of two separate projects, the GSAP extension
(`~/Documents/chrome-extensions/gsap-sqsp-extension`, `src/v2/squarespace/api-engine.js`,
`docs/squarespace-dom-reference.md`) and the schema generator extension
(`~/Documents/chrome-extensions/schema-generator-extension`, `docs/reference/squarespace-api.md`,
`.claude/memory/squarespace-quirks.md`). Nothing is shared with or imported from those projects. This
plugin reimplements what it needs.

> ⚠️ These are Squarespace's **internal, undocumented** endpoints, the same ones its own editor uses.
> They can change without notice, so always keep a copy/paste fallback.

## Where settings go

| What | Where it's saved | Endpoint pair |
|---|---|---|
| Elements on one page | That page's **Page Header Code Injection** (`collectionData.headerInjectCode`) | `GetCollectionSettings` → `SaveCollectionSettings` |
| Elements in the site header/footer (every page) | **Site-wide** Code Injection (`header` or `footer` field) | `GetInjectionSettings` → `SaveInjectionSettings` |
| The plugin itself | Site-wide footer: one `<script src="…cdn…">` line, added by the user once | — |

## Page-level injection (confirmed by the schema extension, 2026-02-18)

**Read**
```
GET /api/commondata/GetCollectionSettings?collectionId={id}
Accept: application/json, text/plain, */*
x-csrf-token: {crumb}
```

**Write**
```
POST /api/commondata/SaveCollectionSettings
Content-Type: application/json; charset=UTF-8
x-csrf-token: {crumb}
Body: { "collectionData": { ...every field from the GET..., "headerInjectCode": "…" }, "memberAreaData": {…from GET or {}} }
```

- **Always GET → merge → POST.** The POST saves the whole page object. Posting only
  `headerInjectCode` wipes the SEO title, description, URL and so on. **Data loss.**
- The body must be wrapped in `{ collectionData, memberAreaData }`. A flat object is rejected.
- The GET response can come back wrapped or flat. Normalize it and hard-fail if `id` / `collectionId` /
  `websiteId` are missing or don't match the page being saved.

## Site-wide injection (confirmed by both extensions)

```
GET  /api/config/GetInjectionSettings?crumb={crumb}
POST /api/config/SaveInjectionSettings?crumb={crumb}
Headers: Accept: */*, X-CSRF-Token: {crumb}, x-requested-with: XMLHttpRequest
POST body: application/x-www-form-urlencoded with ALL fields:
  header, footer, lockPage, postItem, orderConfirmationPage, orderStatusPage, ssoScreen
```

- Also a full round trip: send every field back, or the ones left out get emptied.
- **Form-encoded, not JSON** (unlike the page endpoint).

## Identity and auth, from inside the site (where our script runs)

- **Page ID:** `Static.SQUARESPACE_CONTEXT.collection.id`. It matches `<body id="collection-{id}">`
  (verified on `svg-test-page.html`). The editor reloads the iframe when you switch pages, so it's
  always fresh.
- **CSRF token (crumb):** `Static.SQUARESPACE_CONTEXT.crumb` if present, otherwise the `crumb` cookie
  (`document.cookie`, same origin inside the editor iframe). Read it again right before **every** save,
  because stale crumbs give a 403.
- Only logged-in editors can save, which matches when the editor panel shows.

## Write-safety rules (adopted from both extensions)

1. **Managed markers.** Only ever replace the text between our own markers and keep everything else
   byte-for-byte:
   ```html
   <!-- SHAPE-MOTION-START -->
   <script data-shape-motion type="application/json">{ …settings… }</script>
   <!-- SHAPE-MOTION-END -->
   ```
   If the markers aren't there yet, append the block.
2. **Fresh GET right before each POST.** Never reuse an old read.
3. **Show what will change and confirm** before the first save to a page.
4. **Keep the previous value** (in memory / sessionStorage) so a save can be undone.
5. **User-triggered saves only** (a button), no auto-save on every change.
6. **Error handling:** 403 → re-read the crumb and retry once, then ask for a reload. 400/404/5xx → show
   the copy/paste fallback. A 200 can still carry an error body, so check it.
7. **Don't save the same thing to page and site-wide injection**, or it runs twice.

## Open questions (check on the real site)
- Blog posts and other collection items: do they use the collection's page header injection, or the
  site-wide `postItem` field? Out of scope for v1. Pages first.
- Is `Static.SQUARESPACE_CONTEXT.crumb` present inside the editor iframe, or only the cookie?
