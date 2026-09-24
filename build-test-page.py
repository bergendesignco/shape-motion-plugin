#!/usr/bin/env python3
"""Inject motionpath-helper-snippet.html into the saved Squarespace page for local testing.

Reads  svg-test-page.html            (untouched copy of the live page)
Writes svg-test-page-motionpath.html (generated, git-ignored)

The snippet loads its own gsap.min.js, so the page's existing footer GSAP line is
replaced by the snippet (same as the recommended install). If that line isn't found,
the snippet goes right before </body>.
"""
from pathlib import Path

ROOT = Path(__file__).parent
SOURCE = ROOT / "svg-test-page.html"
SNIPPET = ROOT / "motionpath-helper-snippet.html"
OUTPUT = ROOT / "svg-test-page-motionpath.html"

FOOTER_GSAP = '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.1/dist/gsap.min.js"></script>\n<script src="https://cdn.jsdelivr.net/gh/sqspninja'

page = SOURCE.read_text()
snippet = SNIPPET.read_text()

if FOOTER_GSAP in page:
    page = page.replace(FOOTER_GSAP, snippet + '\n<script src="https://cdn.jsdelivr.net/gh/sqspninja', 1)
    where = "in place of the footer gsap.min.js line"
else:
    i = page.rfind("</body>")
    page = page[:i] + snippet + page[i:]
    where = "before </body>"

OUTPUT.write_text(page)
print(f"Wrote {OUTPUT.name} (snippet injected {where})")
