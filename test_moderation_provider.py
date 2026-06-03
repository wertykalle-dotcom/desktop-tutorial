import os
import asyncio
from types import SimpleNamespace

os.environ.setdefault("TESTING", "1")

import backend.server as server


def test_moderation_payload_to_decision_keeps_valid_action():
    fallback = server.ModerationDecision(score=12, action="publish", queue=False, reason="clean")
    decision = server.moderation_payload_to_decision(
        {"action": "flag", "score": 66, "reason": "provider-review", "queue": True},
        fallback,
    )
    assert decision.action == "flag"
    assert decision.queue is True
    assert decision.score == 66
    assert decision.reason == "provider-review"


def test_moderate_content_falls_back_when_provider_missing(monkeypatch):
    monkeypatch.setattr(server, "MODERATION_PROVIDER_URL", "")
    decision = asyncio.run(server.moderate_content("A calm and friendly update about my day"))
    assert decision.action == "publish"
    assert decision.queue is False


def test_extract_post_keywords_prioritizes_hashtags_and_terms():
    keywords = server.extract_post_keywords("Launching #crypto tools for AI and tech creators")
    assert "crypto" in keywords
    assert "ai" in keywords
    assert "tech" in keywords


def test_build_moderation_provider_payload_includes_context():
    fallback = server.ModerationDecision(score=33, action="flag", queue=True, reason="needs-review")
    payload = server.build_moderation_provider_payload("Hello", fallback, locale_hint="fi", client_ip="8.8.8.8")

    assert payload["model"] == server.MODERATION_PROVIDER_MODEL
    assert payload["locale"] == "fi"
    assert payload["client_ip"] == "8.8.8.8"
    assert payload["task"] == "content_moderation"
    assert payload["fallback"]["action"] == "flag"


def test_build_moderation_provider_prompt_is_json_only():
    fallback = server.ModerationDecision(score=33, action="flag", queue=True, reason="needs-review")
    prompt = server.build_moderation_provider_prompt("Hello", fallback, locale_hint="fi", client_ip="8.8.8.8")

    assert prompt[0]["role"] == "system"
    assert "Return compact JSON" in prompt[0]["content"]
    assert prompt[1]["role"] == "user"
    assert '"task": "content_moderation"' in prompt[1]["content"]
    assert '"locale": "fi"' in prompt[1]["content"]


def test_moderation_result_from_payload_reads_combined_schema():
    fallback = server.ModerationDecision(score=10, action="publish", queue=False, reason="clean")
    result = server.moderation_result_from_payload(
        {
            "result": {
                "score": 88,
                "action": "block",
                "queue": True,
                "reason": "provider-review",
                "locale": "ar",
                "language": "ar",
                "signals": ["hate", "threat"],
            }
        },
        fallback,
    )

    assert result.action == "block"
    assert result.score == 88
    assert result.queue is True
    assert result.locale == "ar"
    assert result.language == "ar"
    assert result.signals == ["hate", "threat"]


def test_moderate_content_uses_provider_result_schema(monkeypatch):
    monkeypatch.setattr(server, "MODERATION_PROVIDER_URL", "https://provider.example/moderate")

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "result": {
                    "score": 91,
                    "action": "block",
                    "queue": True,
                    "reason": "provider-reviewed",
                    "locale": "fi",
                    "language": "fi",
                    "signals": ["abuse", "spam"],
                }
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.calls = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *args, **kwargs):
            self.calls.append({"args": args, "kwargs": kwargs})
            return FakeResponse()

    fake_client = FakeClient()
    monkeypatch.setattr(server.httpx, "AsyncClient", lambda *args, **kwargs: fake_client)

    decision = asyncio.run(server.moderate_content("A problematic message", locale_hint="fi", client_ip="8.8.8.8"))

    assert decision.action == "block"
    assert decision.queue is True
    assert decision.score == 91
    assert fake_client.calls
    payload = fake_client.calls[0]["kwargs"]["json"]
    assert payload["output_schema"]["result"]["locale"] == "resolved app locale if available"


def test_user_interests_and_interactions_helpers_are_available():
    assert hasattr(server, "sqlite_record_user_interaction")
    assert hasattr(server, "sqlite_upsert_user_interest")
    assert hasattr(server, "sqlite_get_user_interest_keywords_merged")


def test_moderate_content_uses_openai_provider(monkeypatch):
    monkeypatch.setattr(server, "MODERATION_PROVIDER_KIND", "openai")
    monkeypatch.setattr(server, "MODERATION_PROVIDER_URL", "https://provider.example/v1")
    monkeypatch.setattr(server, "MODERATION_PROVIDER_API_KEY", "sk-test")

    class FakeChoiceMessage:
        content = '{"result":{"score":87,"action":"flag","queue":true,"reason":"review","locale":"fi","language":"fi","signals":["abuse"]}}'

    class FakeChoice:
        message = FakeChoiceMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    class FakeChatCompletions:
        async def create(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs
            return FakeResponse()

    class FakeChat:
        def __init__(self):
            self.completions = FakeChatCompletions()

    class FakeOpenAIClient:
        def __init__(self, *args, **kwargs):
            self.chat = FakeChat()

    monkeypatch.setattr(server, "AsyncOpenAI", FakeOpenAIClient)

    decision = asyncio.run(server.moderate_content("This is a bad message", locale_hint="fi", client_ip="8.8.8.8"))

    assert decision.action == "flag"
    assert decision.score == 87
