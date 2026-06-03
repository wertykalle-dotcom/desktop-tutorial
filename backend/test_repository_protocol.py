from backend.repository import repository_supports_protocol


class FakeRepository:
    def get_user_by_email(self, email: str):
        return None

    def get_user_by_id(self, user_id: str):
        return None

    def get_user_by_username(self, username: str):
        return None

    def get_feed(self, skip: int = 0, limit: int = 20, user_ids=None):
        return []

    def create_post(self, post):
        return None

    def get_post(self, post_id: str):
        return None

    def store_dwell_event(self, user_id: str, post_id: str, dwell_ms: int):
        return None

    def record_user_interaction(self, user_id: str, post_id: str, dwell_time_ms: int, interaction_type: str, keywords=None):
        return None

    def add_moderation_offense(self, user_id: str, score: int, reason: str, ip_address=None):
        return 0

    def get_moderation_queue(self, limit: int = 100):
        return []


def test_repository_protocol_supports_basic_adapter():
    assert repository_supports_protocol(FakeRepository()) is True
