from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


DIST_DIR = Path(__file__).resolve().parents[1] / "dist"


class ExpoStaticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST_DIR), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if not path or path == "":
            self.path = "/index.html"
            return super().do_GET()

        candidate = DIST_DIR / path.lstrip("/")
        if candidate.is_dir():
            self.path = f"{path}/index.html"
            return super().do_GET()

        if candidate.exists():
            return super().do_GET()

        html_candidate = DIST_DIR / f"{path.lstrip('/')}.html"
        if html_candidate.exists():
            self.path = f"{path}.html"
            return super().do_GET()

        self.path = "/+not-found.html"
        return super().do_GET()


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", 8084), ExpoStaticHandler)
    print("Serving Expo web build on http://0.0.0.0:8084/")
    server.serve_forever()


if __name__ == "__main__":
    main()
