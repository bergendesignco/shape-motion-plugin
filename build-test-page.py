#!/usr/bin/env python3
"""Build the local test page: the saved Squarespace page + the plugin's one-line install.

Reads  svg-test-page.html            (untouched copy of the live page)
Writes svg-test-page-motionpath.html (generated, git-ignored)

Mirrors a real install: the site's own footer code (including its gsap.min.js) is kept, and the
runtime <script> line is added at the end of the footer. Locally it points at /src/runtime.js
instead of jsDelivr. Saved page settings are injected into <head> by dev-server.py, the way
Squarespace outputs Page Header Code Injection.
"""
from pathlib import Path

ROOT = Path(__file__).parent
SOURCE = ROOT / "svg-test-page.html"
OUTPUT = ROOT / "svg-test-page-motionpath.html"
INSTALL = '<script src="/src/runtime.js"></script>\n'

page = SOURCE.read_text()
i = page.rfind("</body>")
OUTPUT.write_text(page[:i] + INSTALL + page[i:])
print(f"Wrote {OUTPUT.name} (runtime line added before </body>)")
