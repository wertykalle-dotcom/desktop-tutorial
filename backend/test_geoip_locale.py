import os
from types import SimpleNamespace

os.environ.setdefault("TESTING", "1")

import backend.server as server


def test_guess_locale_from_ip_returns_none_without_provider():
    assert server.guess_locale_from_ip("8.8.8.8") is None


def test_normalize_ip_returns_canonical_form():
    assert server.normalize_ip(" 127.0.0.1 ") == "127.0.0.1"


def test_get_request_locale_hint_prefers_geoip_header():
    request = SimpleNamespace(
        headers={
            "x-geoip-locale": "he-IL,he;q=0.9",
            "cf-ipcountry": "US",
            "accept-language": "fi-FI,fi;q=0.9",
        }
    )
    assert server.get_request_locale_hint(request) == "he"
