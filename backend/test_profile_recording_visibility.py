import os
import sqlite3

os.environ.setdefault("TESTING", "1")

import backend.server as server


POST_COLUMNS = """
    post_id TEXT PRIMARY KEY,
    user_id TEXT,
    username TEXT,
    profile_picture TEXT,
    text TEXT,
    image TEXT,
    video TEXT,
    title TEXT,
    duration INTEGER,
    visibility TEXT DEFAULT 'public',
    pinned_to_profile INTEGER DEFAULT 0,
    type TEXT,
    is_clip INTEGER DEFAULT 0,
    source TEXT,
    poll TEXT,
    reaction_counts TEXT DEFAULT '{}',
    repost_post_id TEXT,
    repost_count INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    watch_time REAL DEFAULT 0,
    completion_rate REAL DEFAULT 0,
    replay_count INTEGER DEFAULT 0,
    created_at TEXT,
    is_nsfw INTEGER DEFAULT 0,
    copyright_status TEXT DEFAULT 'clear',
    music_risk TEXT DEFAULT 'none',
    music_warning_acknowledged INTEGER DEFAULT 0,
    distribution_limited INTEGER DEFAULT 0,
    keywords TEXT DEFAULT '[]',
    hashtags TEXT DEFAULT '[]',
    mentions TEXT DEFAULT '[]'
"""


def insert_recording(conn: sqlite3.Connection, post_id: str, user_id: str, visibility: str, pinned: bool = False) -> None:
    conn.execute(
        """
        INSERT INTO posts (
            post_id, user_id, username, text, image, video, title, duration, visibility,
            pinned_to_profile, type, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            post_id,
            user_id,
            user_id,
            "Tallenne: #Luonto",
            f"https://example.com/{post_id}.jpg",
            f"https://example.com/{post_id}.webm",
            "Tallenne: #Luonto",
            45,
            visibility,
            int(pinned),
            "live_recording",
            "live_replay",
            "2026-06-17T12:00:00+00:00",
        ),
    )


def test_sqlite_media_posts_include_only_public_by_default(tmp_path, monkeypatch):
    db_path = tmp_path / "yosla.db"
    monkeypatch.setattr(server, "SQLITE_DB_PATH", str(db_path))
    with sqlite3.connect(db_path) as conn:
        conn.execute(f"CREATE TABLE posts ({POST_COLUMNS})")
        insert_recording(conn, "public_recording", "creator_a", "public")
        insert_recording(conn, "private_recording", "creator_a", "private", pinned=True)
        conn.commit()

    posts = server.get_sqlite_media_posts(limit=20, current_user_id="creator_a")

    assert [post["post_id"] for post in posts] == ["public_recording"]


def test_sqlite_media_posts_can_include_own_private_recordings(tmp_path, monkeypatch):
    db_path = tmp_path / "yosla.db"
    monkeypatch.setattr(server, "SQLITE_DB_PATH", str(db_path))
    with sqlite3.connect(db_path) as conn:
        conn.execute(f"CREATE TABLE posts ({POST_COLUMNS})")
        insert_recording(conn, "public_recording", "creator_a", "public")
        insert_recording(conn, "own_private_recording", "creator_a", "private", pinned=True)
        insert_recording(conn, "other_private_recording", "creator_b", "private", pinned=True)
        conn.commit()

    posts = server.get_sqlite_media_posts(
        limit=20,
        current_user_id="creator_a",
        include_own_private=True,
    )
    post_ids = {post["post_id"] for post in posts}

    assert post_ids == {"public_recording", "own_private_recording"}
    assert next(post for post in posts if post["post_id"] == "own_private_recording")["pinned_to_profile"] == 1
