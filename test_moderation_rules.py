import os

os.environ.setdefault("TESTING", "1")

from backend.server import assess_content_harm, rank_posts_with_dwell_signal


def test_clean_content_publishes():
    decision = assess_content_harm("A calm and friendly update about my day")
    assert decision.action == "publish"
    assert decision.queue is False
    assert decision.score == 0


def test_self_harm_content_blocks():
    decision = assess_content_harm("I want to die and end my life tonight")
    assert decision.action == "block"
    assert decision.queue is True
    assert decision.score >= 55
    assert "self-harm" in (decision.reason or "")


def test_hate_and_abuse_content_flags_or_blocks():
    decision = assess_content_harm("You are a racist moron and a nazi")
    assert decision.action in {"flag", "block"}
    assert decision.queue is True
    assert decision.score >= 60
    assert "hate" in (decision.reason or "") or "abuse" in (decision.reason or "")


def test_locale_specific_moderation_signals():
    decision = assess_content_harm("Olet tyhmä paskiainen ja turpa kiinni")
    assert decision.action in {"flag", "block"}
    assert decision.queue is True
    assert any(label in (decision.reason or "") for label in ["abuse:fi", "abuse"])


def test_dwell_signal_ranking_prefers_interest_match():
    posts = [
        {"post_id": "1", "text": "General news update", "username": "alice", "likes_count": 0},
        {"post_id": "2", "text": "Python and backend tips", "username": "bob", "likes_count": 0},
        {"post_id": "3", "text": "Unrelated content", "username": "carol", "likes_count": 0},
    ]
    dwell_rows = [
        {"text": "Python backend tips", "username": "bob", "dwell_ms": 9000},
        {"text": "Python backend tips", "username": "bob", "dwell_ms": 6000},
    ]
    ranked = rank_posts_with_dwell_signal(posts, dwell_rows)
    assert ranked[0]["post_id"] == "2"
