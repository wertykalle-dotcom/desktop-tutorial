from __future__ import annotations

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


DIST_DIR = Path(__file__).resolve().parents[1] / "dist"


def find_dynamic_route(path: str) -> Path | None:
    parts = [part for part in path.strip("/").split("/") if part]
    current = DIST_DIR

    for index, part in enumerate(parts):
        exact_dir = current / part
        if exact_dir.is_dir():
            current = exact_dir
            continue

        is_last = index == len(parts) - 1
        if is_last:
            exact_html = current / f"{part}.html"
            if exact_html.exists():
                return exact_html

        dynamic_matches = sorted(current.glob("[[]*[]]"))
        dynamic_dirs = [candidate for candidate in dynamic_matches if candidate.is_dir()]
        dynamic_files = [candidate for candidate in current.glob("[[]*[]].html") if candidate.is_file()]

        if is_last and dynamic_files:
            return sorted(dynamic_files)[0]

        if dynamic_dirs:
            current = sorted(dynamic_dirs)[0]
            continue

        return None

    index_file = current / "index.html"
    return index_file if index_file.exists() else None


class ExpoStaticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST_DIR), **kwargs)

    def resolve_expo_path(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if not path or path == "":
            self.path = "/index.html"
            return

        candidate = DIST_DIR / path.lstrip("/")
        if candidate.is_dir():
            self.path = f"{path}/index.html"
            return

        if candidate.exists():
            return

        html_candidate = DIST_DIR / f"{path.lstrip('/')}.html"
        if html_candidate.exists():
            self.path = f"{path}.html"
            return

        dynamic_candidate = find_dynamic_route(path)
        if dynamic_candidate:
            self.path = "/" + dynamic_candidate.relative_to(DIST_DIR).as_posix()
            return

        self.path = "/+not-found.html"

    def do_GET(self):
        self.resolve_expo_path()
        return super().do_GET()

    def do_HEAD(self):
        self.resolve_expo_path()
        return super().do_HEAD()


def main() -> None:
    port = int(os.environ.get("PORT", "8081"))
    server = ThreadingHTTPServer(("0.0.0.0", port), ExpoStaticHandler)
    print(f"Serving Expo web build on http://0.0.0.0:{port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
