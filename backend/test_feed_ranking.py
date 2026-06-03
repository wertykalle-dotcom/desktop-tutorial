import os

os.environ.setdefault("TESTING", "1")

import backend.server as server


def test_score_posts_with_user_signals_prioritizes_followed_authors():
    posts = [
        {"post_id": "post_1", "user_id": "author_a", "likes_count": 0, "comments_count": 0},
        {"post_id": "post_2", "user_id": "author_b", "likes_count": 0, "comments_count": 0},
    ]

    ranked = server.score_posts_with_user_signals(posts, followed_user_ids=["author_b"], favorite_author_ids=[])

    assert [post["post_id"] for post in ranked][0] == "post_2"


def test_score_posts_with_user_signals_prioritizes_favorite_authors():
    posts = [
        {"post_id": "post_1", "user_id": "author_a", "likes_count": 0, "comments_count": 0},
        {"post_id": "post_2", "user_id": "author_b", "likes_count": 0, "comments_count": 0},
    ]

    ranked = server.score_posts_with_user_signals(posts, followed_user_ids=[], favorite_author_ids=["author_a"])

    assert [post["post_id"] for post in ranked][0] == "post_1"


def test_mix_in_explore_posts_keeps_original_length(monkeypatch):
    monkeypatch.setattr(server.random, "sample", lambda population, k: list(range(k)))
    posts = [{"post_id": f"post_{index}"} for index in range(8)]

    mixed = server.mix_in_explore_posts(posts, explore_ratio=0.25)

    assert len(mixed) == len(posts)
    assert {post["post_id"] for post in mixed} == {post["post_id"] for post in posts}


def test_get_explore_ratio_for_user_adapts_to_user_state():
    newbie = {"posts_count": 0, "followers_count": 0, "following_count": 0}
    active = {"posts_count": 20, "followers_count": 15, "following_count": 9}

    assert server.get_explore_ratio_for_user(newbie) > server.get_explore_ratio_for_user(active)
