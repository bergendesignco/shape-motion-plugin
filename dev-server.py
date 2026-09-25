#!/usr/bin/env python3
"""Local dev server: static files + a mock of Squarespace's page-settings API.

  python3 dev-server.py            (port 8765)

- Serves the repo root, like `python3 -m http.server`.
- Sets a `crumb` cookie, like a logged-in Squarespace session.
- Mocks GetCollectionSettings / SaveCollectionSettings (docs/squarespace-saving.md) for the test
  page's collection ID. GETs are flat and lack `collectionId`, like the real API. It rejects the
  mistakes that cause damage on the real site: a save without `collectionId` (real Squarespace creates
  a NEW page, seen 2026-09-25), missing wrapper, wrong ID, missing fields, a changed SEO title.
- Serves `?format=json` for the test page (collection.id), the page-ID source of truth.
- Injects the saved headerInjectCode into <head> of svg-test-page-motionpath.html, the way
  Squarespace outputs Page Header Code Injection, so a save and reload round-trips.

The mock state lives in .dev-store.json (git-ignored). Delete it to reset.
"""
import json
import os
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(ROOT, ".dev-store.json")
PAGE_ID = "6ab53fb8127c287ef235908a"  # svg-test-page.html (Static.SQUARESPACE_CONTEXT.collection.id)
CRUMB = "dev-crumb-123"
TEST_PAGE = "/svg-test-page-motionpath.html"


def default_page():
    # Shaped like a REAL GetCollectionSettings response: flat, has `id`, NO `collectionId`
    # (see schema extension raw captures). The save must add collectionId back.
    return {
        "id": PAGE_ID,
        "websiteId": "699e15bd0dd27249efbe5e18",
        "title": "SVG Examples",
        "urlId": "svg-examples",
        "typeName": "page",
        "homepage": False,
        "fullUrl": TEST_PAGE,
        "seoTitle": "KEEP ME - seo title",
        "seoDescription": "KEEP ME - seo description",
        "headerInjectCode": "<!-- someone else's header code, must survive saves -->\n<meta name=\"keep-me\" content=\"1\">",
    }


def load():
    if os.path.exists(STORE):
        with open(STORE) as f:
            return json.load(f)
    return {"collectionData": default_page(), "memberAreaData": {}, "saves": 0}


def save(state):
    with open(STORE, "w") as f:
        json.dump(state, f, indent=2)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Set-Cookie", f"crumb={CRUMB}; Path=/")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def crumb_ok(self):
        return self.headers.get("x-csrf-token") == CRUMB

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/commondata/GetCollectionSettings":
            if not self.crumb_ok():
                return self.send_json(403, {"error": "bad crumb"})
            cid = parse_qs(url.query).get("collectionId", [""])[0]
            if cid != PAGE_ID:
                return self.send_json(404, {"error": "no such collection"})
            state = load()
            data = dict(state["collectionData"])
            data.pop("collectionId", None)  # real GETs don't include it
            return self.send_json(200, data)  # real GETs are flat
        if url.path == TEST_PAGE and "format=json" in url.query:
            return self.send_json(200, {"collection": {"id": PAGE_ID, "fullUrl": TEST_PAGE}})
        if url.path == TEST_PAGE:
            path = os.path.join(ROOT, TEST_PAGE.lstrip("/"))
            with open(path, encoding="utf-8") as f:
                html = f.read()
            header = load()["collectionData"].get("headerInjectCode", "")
            html = html.replace("</head>", header + "\n</head>", 1)
            body = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/api/commondata/SaveCollectionSettings":
            return self.send_json(404, {"error": "unknown endpoint"})
        if not self.crumb_ok():
            return self.send_json(403, {"error": "bad crumb"})
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length))
        except ValueError:
            return self.send_json(400, {"error": "body is not JSON"})
        state = load()
        cd = payload.get("collectionData")
        if not isinstance(cd, dict) or "memberAreaData" not in payload:
            return self.send_json(400, {"error": "body must be { collectionData, memberAreaData }"})
        if not cd.get("collectionId"):
            state.setdefault("pagesCreated", 0)
            state["pagesCreated"] += 1
            save(state)
            return self.send_json(400, {"error": "no collectionData.collectionId - real Squarespace would CREATE A NEW PAGE"})
        if cd.get("id") != PAGE_ID or cd.get("collectionId") != PAGE_ID:
            return self.send_json(400, {"error": "collectionData.id/collectionId mismatch"})
        missing = [k for k in state["collectionData"] if k not in cd and k != "collectionId"]
        if missing:
            return self.send_json(400, {"error": "partial object would wipe fields: " + ", ".join(missing)})
        for k in ("seoTitle", "seoDescription", "urlId"):
            if cd.get(k) != state["collectionData"].get(k):
                return self.send_json(400, {"error": f"{k} changed - data loss"})
        cd = dict(cd)
        cd.pop("collectionId", None)
        state["collectionData"] = cd
        state["memberAreaData"] = payload["memberAreaData"]
        state["saves"] = state.get("saves", 0) + 1
        save(state)
        return self.send_json(200, cd)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    print(f"Serving {ROOT} on http://localhost:{port} (mock Squarespace API, store: {STORE})")
    ThreadingHTTPServer(("", port), Handler).serve_forever()
