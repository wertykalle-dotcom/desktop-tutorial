from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter, HTTPException, Header, Request, UploadFile, File, Form
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
import random
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
import httpx
from jose import jwt
import secrets
from fastapi.staticfiles import StaticFiles
import sqlite3
import asyncio
import ipaddress

try:
    from openai import AsyncOpenAI
except Exception:  # pragma: no cover - optional dependency path
    AsyncOpenAI = None

from backend.repository import create_repository

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection (optional)
mongo_url = os.environ.get('MONGO_URL')
if mongo_url:
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ.get('DB_NAME', 'social_media_db')]
else:
    client = None
    db = None

# SQLite connection (optional)
DATABASE_PATH = os.environ.get('DATABASE_PATH')
if DATABASE_PATH:
    # If absolute path, use it directly; otherwise resolve relative to project root
    if os.path.isabs(DATABASE_PATH):
        SQLITE_DB_PATH = DATABASE_PATH
    else:
        # Get parent of backend directory (project root)
        PROJECT_ROOT = ROOT_DIR.parent
        SQLITE_DB_PATH = str((PROJECT_ROOT / DATABASE_PATH).resolve())
else:
    SQLITE_DB_PATH = None
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
if DATABASE_URL:
    logging.getLogger(__name__).warning(
        "DATABASE_URL is set, but the current backend still uses SQLite for local persistence."
    )


def get_storage_mode() -> str:
    if DATABASE_URL:
        normalized = DATABASE_URL.lower()
        if normalized.startswith(("postgresql://", "postgres://")):
            return "postgresql-ready"
        return "external-database"
    if SQLITE_DB_PATH:
        return "sqlite"
    if db is not None:
        return "mongodb"
    return "memory"

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT Configuration
SECRET_KEY_FILE = ROOT_DIR / ".secret_key"
if os.environ.get("SECRET_KEY"):
    SECRET_KEY = os.environ["SECRET_KEY"]
elif SECRET_KEY_FILE.exists():
    SECRET_KEY = SECRET_KEY_FILE.read_text(encoding="utf-8").strip()
else:
    SECRET_KEY = secrets.token_urlsafe(32)
    SECRET_KEY_FILE.write_text(SECRET_KEY, encoding="utf-8")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7
ALLOWED_ROLES = {"Super Admin", "Moderator", "User"}
SUPER_ADMIN_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL")
MODERATION_SENSITIVITY = 50
MODERATION_PROVIDER_URL = os.environ.get("MODERATION_PROVIDER_URL", "").strip()
MODERATION_PROVIDER_API_KEY = os.environ.get("MODERATION_PROVIDER_API_KEY", "").strip()
MODERATION_PROVIDER_MODEL = os.environ.get("MODERATION_PROVIDER_MODEL", "").strip() or "moderation"
MODERATION_PROVIDER_KIND = os.environ.get("MODERATION_PROVIDER_KIND", "").strip().lower() or "http"
GEOIP_LOCALE_PROVIDER_URL = os.environ.get("GEOIP_LOCALE_PROVIDER_URL", "").strip()
EXCHANGE_RATES_API_URL = os.environ.get("EXCHANGE_RATES_API_URL", "").strip()
EXCHANGE_RATES_REFRESH_SECONDS = max(3600, int(os.environ.get("EXCHANGE_RATES_REFRESH_SECONDS", "86400")))
REPOSITORY_ADAPTER = create_repository(get_storage_mode(), DATABASE_URL)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_indexes()
    yield
    if client is not None:
        client.close()


# Create the main app
app = FastAPI(title="Social Media API", lifespan=lifespan)

# Ensure uploads directory exists and serve it
uploads_dir = ROOT_DIR / 'uploads'
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
SYSTEM_LOGS: List[Dict[str, Any]] = []
DEMO_ACCOUNTS = [
    {"email": "test@test.com", "username": "testuser", "password": "password123", "role": "Super Admin"},
    {"email": "demo_user_20260529@test.com", "username": "demo_user_20260529", "password": "password123", "role": "User"},
]

def push_system_log(level: str, message: str, component: str = "backend") -> None:
    SYSTEM_LOGS.append({
        "log_id": f"log_{uuid.uuid4().hex[:12]}",
        "level": level,
        "component": component,
        "message": message,
        "created_at": utc_iso_now(),
    })
    del SYSTEM_LOGS[:-200]

# =======================
# MODELS
# =======================

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    username: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class GoogleSessionRequest(BaseModel):
    session_id: str

class UserProfile(BaseModel):
    user_id: str
    email: str
    username: str
    profile_picture: Optional[str] = None
    bio: Optional[str] = None
    followers_count: int = 0
    following_count: int = 0
    posts_count: int = 0
    created_at: datetime
    role: str = "User"
    banned_until: Optional[datetime] = None

class UserUpdate(BaseModel):
    username: Optional[str] = None
    profile_picture: Optional[str] = None
    bio: Optional[str] = None
    role: Optional[str] = None

class PostCreate(BaseModel):
    text: str
    image: Optional[str] = None

class Post(BaseModel):
    post_id: str
    user_id: str
    username: str
    profile_picture: Optional[str] = None
    text: str
    image: Optional[str] = None
    likes_count: int = 0
    comments_count: int = 0
    is_liked: bool = False
    comments: List["Comment"] = []
    created_at: datetime

class CommentCreate(BaseModel):
    text: str

class Comment(BaseModel):
    comment_id: str
    post_id: str
    user_id: str
    username: str
    profile_picture: Optional[str] = None
    text: str
    created_at: datetime

class AuthResponse(BaseModel):
    token: str
    user: UserProfile

class ReportCreate(BaseModel):
    target_type: str  # post | comment | user
    target_id: str
    reason: str
    details: Optional[str] = None

class RoleUpdate(BaseModel):
    role: str

class ModerationDecision(BaseModel):
    score: int
    action: str
    queue: bool = False
    reason: Optional[str] = None


class ProviderModerationResult(BaseModel):
    score: int = 0
    action: str = "publish"
    queue: bool = False
    reason: Optional[str] = None
    locale: Optional[str] = None
    language: Optional[str] = None
    signals: List[str] = Field(default_factory=list)

class AdPlacementSettings(BaseModel):
    in_feed_enabled: bool = False
    in_feed_frequency: int = 5
    sidebar_enabled: bool = False
    interstitial_enabled: bool = False
    ad_network_enabled: bool = False
    ad_network_tag: Optional[str] = None

class ModerationSettings(BaseModel):
    sensitivity: int = 50

class ExchangeRateItem(BaseModel):
    currency: str
    rate_to_eur: float

class ExchangeRateUpdate(BaseModel):
    rates: List[ExchangeRateItem]

class AdCampaignCreate(BaseModel):
    name: str
    asset_url: Optional[str] = None
    asset_type: str = "image"
    currency: str = "EUR"
    targeting: Optional[Dict[str, Any]] = None
    budget: float = 0.0
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    impressions_goal: Optional[int] = None
    clicks_goal: Optional[int] = None
    placements: List[str] = []

class DwellEvent(BaseModel):
    post_id: str
    dwell_ms: Optional[int] = None
    dwell_seconds: Optional[float] = None

    def normalized_dwell_ms(self) -> int:
        if self.dwell_ms is not None:
            return max(0, int(self.dwell_ms))
        if self.dwell_seconds is not None:
            return max(0, int(float(self.dwell_seconds) * 1000.0))
        return 0

class UserMini(BaseModel):
    user_id: str
    username: str
    profile_picture: Optional[str] = None

class NotificationItem(BaseModel):
    notification_id: str
    user_id: str
    actor_user_id: str
    actor_username: str
    actor_profile_picture: Optional[str] = None
    type: str  # post_like | post_comment | user_follow
    post_id: Optional[str] = None
    comment_id: Optional[str] = None
    created_at: datetime
    is_read: bool = False

try:
    Post.model_rebuild()
except AttributeError:
    Post.update_forward_refs()

# =======================
# HELPER FUNCTIONS
# =======================

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

def utc_iso_now() -> str:
    return utc_now().isoformat()

def normalize_role(role: Optional[str]) -> str:
    if role in ALLOWED_ROLES:
        return role  # exact role labels are intentional
    return "User"

def is_banned_until(value: Optional[str]) -> bool:
    if not value:
        return False
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt > utc_now()
    except Exception:
        return False

def get_user_role(raw_user: Dict[str, Any]) -> str:
    return normalize_role(raw_user.get("role"))

def user_is_super_admin(raw_user: Dict[str, Any]) -> bool:
    if get_user_role(raw_user) == "Super Admin":
        return True
    if SUPER_ADMIN_EMAIL and raw_user.get("email") == SUPER_ADMIN_EMAIL:
        return True
    return False

def ensure_not_banned(raw_user: Dict[str, Any]) -> None:
    banned_until = raw_user.get("banned_until")
    if banned_until and is_banned_until(banned_until):
        raise HTTPException(status_code=403, detail="User is banned")

def ensure_admin_access(raw_user: Dict[str, Any]) -> None:
    if not user_is_super_admin(raw_user):
        raise HTTPException(status_code=401, detail="Unauthorized")

def get_client_ip(request: Optional[Request]) -> str:
    if request is None:
        return ""
    forwarded_for = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip") or ""
    if forwarded_for:
        first_ip = forwarded_for.split(",")[0].strip()
        return first_ip
    if request.client and request.client.host:
        return request.client.host
    return ""

def normalize_ip(ip_value: str) -> str:
    try:
        return str(ipaddress.ip_address(ip_value.strip()))
    except Exception:
        return ""

def normalize_locale_hint(raw_value: str | None) -> Optional[str]:
    if not raw_value:
        return None
    value = raw_value.split(",")[0].strip().lower().replace("_", "-")
    if not value:
        return None
    for candidate in ["ar", "he", "fi", "en"]:
        if value == candidate or value.startswith(f"{candidate}-"):
            return candidate
    return None


def get_request_locale_hint(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    header_candidates = [
        request.headers.get("x-geoip-locale"),
        request.headers.get("cf-ipcountry"),
        request.headers.get("x-country-code"),
        request.headers.get("x-vercel-ip-country"),
        request.headers.get("accept-language"),
    ]
    country_to_locale = {
        "fi": "fi",
        "se": "fi",
        "us": "en",
        "gb": "en",
        "uk": "en",
        "ae": "ar",
        "sa": "ar",
        "eg": "ar",
        "il": "he",
    }
    for raw_value in header_candidates:
        locale = normalize_locale_hint(raw_value)
        if locale:
            return locale
        if raw_value:
            country = raw_value.split(",")[0].strip().lower()
            mapped = country_to_locale.get(country)
            if mapped:
                return mapped
    return None

def build_moderation_provider_payload(text: str, fallback: ModerationDecision, locale_hint: Optional[str] = None, client_ip: Optional[str] = None) -> Dict[str, Any]:
    return {
        "model": MODERATION_PROVIDER_MODEL,
        "input": text,
        "locale": locale_hint or "auto",
        "client_ip": client_ip,
        "task": "content_moderation",
        "output_schema": {
            "result": {
                "score": "0-100",
                "action": "publish|flag|block",
                "queue": "boolean",
                "reason": "short text",
                "signals": "array of strings",
                "language": "detected language if available",
                "locale": "resolved app locale if available",
            }
        },
        "fallback": fallback.model_dump(),
    }


def build_moderation_provider_prompt(text: str, fallback: ModerationDecision, locale_hint: Optional[str] = None, client_ip: Optional[str] = None) -> List[Dict[str, str]]:
    locale = locale_hint or "auto"
    return [
        {
            "role": "system",
            "content": (
                "You are a multilingual content moderation engine. "
                "Return compact JSON matching the requested schema. "
                "Do not add extra commentary."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "task": "content_moderation",
                    "input": text,
                    "locale": locale,
                    "client_ip": client_ip,
                    "fallback": fallback.model_dump(),
                    "output_schema": {
                        "result": {
                            "score": "0-100",
                            "action": "publish|flag|block",
                            "queue": "boolean",
                            "reason": "short text",
                            "signals": "array of strings",
                            "language": "detected language if available",
                            "locale": "resolved app locale if available",
                        }
                    },
                },
                ensure_ascii=False,
            ),
        },
    ]

async def is_ip_blacklisted(ip_value: str) -> bool:
    normalized_ip = normalize_ip(ip_value)
    if not normalized_ip:
        return False
    if db is not None:
        doc = await db.blacklist.find_one({"value": normalized_ip, "value_type": "ip"}, {"_id": 0})
        return doc is not None
    return sqlite_get_blacklist_entry(normalized_ip, "ip")


async def ensure_request_ip_not_blacklisted(request: Request) -> None:
    ip_value = get_client_ip(request)
    if ip_value and await is_ip_blacklisted(ip_value):
        raise HTTPException(status_code=403, detail="IP address is blocked")

def guess_locale_from_ip(ip_value: str) -> Optional[str]:
    if not ip_value:
        return None
    if GEOIP_LOCALE_PROVIDER_URL:
        return None
    try:
        ip_obj = ipaddress.ip_address(ip_value)
        if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_reserved:
            return None
    except Exception:
        return None
    # Lightweight fallback when no GeoIP provider is configured.
    # This intentionally returns None rather than making up a locale.
    return None

async def fetch_locale_from_geoip_provider(ip_value: str) -> Optional[str]:
    if not GEOIP_LOCALE_PROVIDER_URL or not ip_value:
        return None
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(GEOIP_LOCALE_PROVIDER_URL, params={"ip": ip_value})
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                return None
            locale = str(payload.get("locale") or payload.get("language") or payload.get("lang") or "").strip().lower()
            if locale:
                return locale
            country = str(payload.get("country_code") or payload.get("country") or "").strip().lower()
            country_to_locale = {
                "fi": "fi",
                "se": "fi",
                "us": "en",
                "gb": "en",
                "uk": "en",
                "ae": "ar",
                "sa": "ar",
                "eg": "ar",
                "il": "he",
            }
            return country_to_locale.get(country)
    except Exception as exc:
        logger.warning("GeoIP locale provider failed: %s", exc)
    return None

@api_router.get("/i18n/detect-locale")
async def detect_locale(request: Request):
    """Detect the best locale from headers, GeoIP hints, or browser language."""
    ip_value = normalize_ip(get_client_ip(request))
    header_locale = get_request_locale_hint(request)
    if header_locale:
        return {"locale": header_locale, "source": "header"}
    provider_locale = await fetch_locale_from_geoip_provider(ip_value)
    if provider_locale:
        return {"locale": provider_locale, "source": "geoip-provider"}
    fallback_locale = guess_locale_from_ip(ip_value)
    if fallback_locale:
        return {"locale": fallback_locale, "source": "geoip-fallback"}
    accept_language = (request.headers.get("accept-language") or "").lower()
    if accept_language:
        for lang in ["ar", "he", "fi", "en"]:
            if lang in accept_language:
                return {"locale": lang, "source": "accept-language"}
    return {"locale": "en", "source": "default"}

def assess_content_harm(text: str) -> ModerationDecision:
    sensitivity = get_moderation_sensitivity()
    lowered = (text or "").lower()
    score = 0
    reasons: List[str] = []

    if not lowered.strip():
        return ModerationDecision(score=0, action="publish")

    def add_signal(label: str, points: int) -> None:
        nonlocal score
        score += points
        reasons.append(label)

    def contains_any(terms: set[str]) -> bool:
        return any(term in lowered for term in terms)

    def add_locale_terms(label: str, points: int, terms_by_locale: Dict[str, List[str]]) -> None:
        nonlocal score
        for locale, terms in terms_by_locale.items():
            hits = sum(1 for term in terms if term in lowered)
            if hits:
                score += min(points + (hits - 1) * 5, points + 15)
                reasons.append(f"{label}:{locale}")

    abuse_terms = {
        "idiot", "stupid", "worthless", "trash", "fool", "loser", "scum", "garbage", "moron",
        "bitch", "bastard", "dumb", "clown", "shut up",
    }
    hate_terms = {
        "racist", "racism", "supremacy", "genocide", "slur", "exterminate", "parasite", "nazi",
    }
    threat_terms = {
        "kill you", "hurt you", "attack you", "shoot you", "stab you", "bomb you", "beat you",
        "destroy you", "i will kill", "i'll kill", "we will kill",
    }
    self_harm_terms = {
        "kill myself", "end my life", "suicide", "self harm", "self-harm", "kys", "i want to die",
    }
    spam_terms = {
        "free money", "click here", "buy now", "visit now", "airdrop", "giveaway", "limited offer",
    }

    if contains_any(self_harm_terms):
        add_signal("self-harm", 55)
        if any(phrase in lowered for phrase in ["kill myself", "end my life", "suicide", "self harm", "self-harm", "kys", "i want to die"]):
            return ModerationDecision(score=max(55, score), action="block", queue=True, reason="self-harm")
    if contains_any(threat_terms):
        add_signal("threat", 45)
    if contains_any(hate_terms):
        add_signal("hate", 40)
    if contains_any(abuse_terms):
        add_signal("abuse", 30)
    if contains_any(spam_terms):
        add_signal("spam", 18)

    add_locale_terms("abuse", 50, {
        "fi": ["idiootti", "tyhmä", "roska", "luuseri", "paskiainen", "turpa kiinni"],
        "ar": ["غبي", "قذر", "كلب", "تافه"],
        "he": ["טיפש", "אפס", "זבל", "שתוק"],
    })
    add_locale_terms("hate", 58, {
        "fi": ["rotu", "vihapuhe", "hävitettävä", "alempiarvoinen"],
        "ar": ["كراهية", "إبادة", "عنصري", "تفوق"],
        "he": ["גזענ", "השמדה", "עליונות", "שנאה"],
    })
    add_locale_terms("threat", 62, {
        "fi": ["tapan sinut", "satutan sinua", "hyökkään", "ammun"],
        "ar": ["سأقتلك", "سأؤذيك", "سأهاجمك", "سأطلق"],
        "he": ["אהרוג אותך", "אפעיל עליך", "אירה בך", "אכאב לך"],
    })

    exclamation_clusters = lowered.count("!!!") + lowered.count("??") + lowered.count("!?") + lowered.count("?!")
    if exclamation_clusters:
        add_signal("aggressive-punctuation", min(10, exclamation_clusters * 3))

    if len(text) > 280:
        add_signal("length", 5)

    uppercase_letters = sum(1 for ch in text if ch.isupper())
    if uppercase_letters > max(8, len(text) // 2):
        add_signal("shouting", 5)

    if lowered.count("@") >= 3 or lowered.count("http://") + lowered.count("https://") >= 2:
        add_signal("link-spam", 8)

    if any(phrase in lowered for phrase in ["go die", "go kill", "kill yourself", "kys"]):
        add_signal("direct-harm", 20)

    score = max(0, min(100, score))
    # Higher sensitivity lowers thresholds; lower sensitivity makes the filter less aggressive.
    flag_threshold = max(25, min(85, 50 + (50 - sensitivity) // 2))
    block_threshold = max(flag_threshold + 10, min(100, 80 + (50 - sensitivity) // 2))

    if score >= block_threshold:
        return ModerationDecision(score=score, action="block", queue=True, reason=", ".join(reasons) or "high-risk")
    if score >= flag_threshold:
        return ModerationDecision(score=score, action="flag", queue=True, reason=", ".join(reasons) or "needs-review")
    return ModerationDecision(score=score, action="publish", queue=False, reason=", ".join(reasons) or "clean")

def moderation_payload_to_decision(payload: Dict[str, Any], fallback: ModerationDecision) -> ModerationDecision:
    if "result" in payload and isinstance(payload["result"], dict):
        payload = payload["result"]
    action = str(payload.get("action") or fallback.action).lower()
    if action not in {"publish", "flag", "block"}:
        action = fallback.action
    queue = payload.get("queue")
    if queue is None:
        queue = action in {"flag", "block"}
    reason = payload.get("reason") or fallback.reason
    try:
        score = int(payload.get("score", fallback.score))
    except Exception:
        score = fallback.score
    return ModerationDecision(score=max(0, min(100, score)), action=action, queue=bool(queue), reason=reason)


def moderation_result_from_payload(payload: Dict[str, Any], fallback: ModerationDecision) -> ProviderModerationResult:
    decision = moderation_payload_to_decision(payload, fallback)
    result = payload.get("result") if isinstance(payload.get("result"), dict) else payload
    signals = result.get("signals") if isinstance(result, dict) else []
    if not isinstance(signals, list):
        signals = []
    locale = None
    language = None
    if isinstance(result, dict):
        locale = result.get("locale")
        language = result.get("language")
    return ProviderModerationResult(
        score=decision.score,
        action=decision.action,
        queue=decision.queue,
        reason=decision.reason,
        locale=str(locale).strip().lower() if locale else None,
        language=str(language).strip().lower() if language else None,
        signals=[str(signal) for signal in signals if str(signal).strip()],
    )

async def moderate_content(text: str, locale_hint: Optional[str] = None, client_ip: Optional[str] = None) -> ModerationDecision:
    fallback = assess_content_harm(text)
    if MODERATION_PROVIDER_KIND == "openai":
        if AsyncOpenAI is None:
            logger.warning("OpenAI moderation provider requested, but openai is not installed")
            return fallback
        if not MODERATION_PROVIDER_URL:
            logger.warning("OpenAI moderation provider requested, but MODERATION_PROVIDER_URL is not set")
            return fallback
        try:
            client_kwargs: Dict[str, Any] = {"api_key": MODERATION_PROVIDER_API_KEY or None, "base_url": MODERATION_PROVIDER_URL}
            provider = AsyncOpenAI(**client_kwargs)
            response = await provider.chat.completions.create(
                model=MODERATION_PROVIDER_MODEL,
                messages=build_moderation_provider_prompt(text, fallback, locale_hint, client_ip),
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content if response.choices else None
            payload = json.loads(content or "{}")
            if isinstance(payload, dict):
                provider_result = moderation_result_from_payload(payload, fallback)
                return ModerationDecision(
                    score=provider_result.score,
                    action=provider_result.action,
                    queue=provider_result.queue,
                    reason=provider_result.reason,
                )
        except Exception as exc:
            logger.warning("OpenAI moderation provider failed, falling back to heuristics: %s", exc)
        return fallback

    if not MODERATION_PROVIDER_URL:
        return fallback
    try:
        headers = {"Content-Type": "application/json"}
        if MODERATION_PROVIDER_API_KEY:
            headers["Authorization"] = f"Bearer {MODERATION_PROVIDER_API_KEY}"
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                MODERATION_PROVIDER_URL,
                headers=headers,
                json=build_moderation_provider_payload(text, fallback, locale_hint, client_ip),
            )
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict):
                provider_result = moderation_result_from_payload(payload, fallback)
                return ModerationDecision(
                    score=provider_result.score,
                    action=provider_result.action,
                    queue=provider_result.queue,
                    reason=provider_result.reason,
                )
    except Exception as exc:
        logger.warning("Moderation provider failed, falling back to heuristics: %s", exc)
    return fallback

def penalty_for_offense(offense_count: int) -> tuple[str, Optional[datetime]]:
    if offense_count <= 1:
        return "suspend", utc_now() + timedelta(days=7)
    if offense_count == 2:
        return "suspend", utc_now() + timedelta(days=30)
    return "nuke", None

def get_sqlite_connection() -> sqlite3.Connection:
    if SQLITE_DB_PATH is None:
        raise RuntimeError("SQLite database is not configured")
    conn = sqlite3.connect(SQLITE_DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES)
    conn.row_factory = sqlite3.Row
    return conn


def get_sqlite_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_sqlite_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_sqlite_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
        row = cursor.fetchone()
        return dict(row) if row else None


def repository_get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    if REPOSITORY_ADAPTER is not None:
        return REPOSITORY_ADAPTER.get_user_by_email(email)
    return None


def repository_get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    if REPOSITORY_ADAPTER is not None:
        return REPOSITORY_ADAPTER.get_user_by_id(user_id)
    return None


def repository_get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    if REPOSITORY_ADAPTER is not None:
        return REPOSITORY_ADAPTER.get_user_by_username(username)
    return None


def repository_get_feed(skip: int = 0, limit: int = 20, user_ids: Optional[List[str]] = None) -> Optional[List[Dict[str, Any]]]:
    if REPOSITORY_ADAPTER is not None:
        return REPOSITORY_ADAPTER.get_feed(skip=skip, limit=limit, user_ids=user_ids)
    return None


def repository_get_post(post_id: str) -> Optional[Dict[str, Any]]:
    if REPOSITORY_ADAPTER is not None:
        return REPOSITORY_ADAPTER.get_post(post_id)
    return None


def repository_get_moderation_queue(limit: int = 100) -> Optional[List[Dict[str, Any]]]:
    if REPOSITORY_ADAPTER is not None:
        return REPOSITORY_ADAPTER.get_moderation_queue(limit=limit)
    return None


def repository_add_moderation_offense(user_id: str, score: int, reason: str, ip_address: Optional[str] = None) -> Optional[int]:
    if REPOSITORY_ADAPTER is not None:
        return REPOSITORY_ADAPTER.add_moderation_offense(user_id, score, reason, ip_address=ip_address)
    return None

def get_sqlite_user_offense_count(user_id: str) -> int:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) AS c FROM moderation_offenses WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        return int(row["c"]) if row else 0

def sqlite_add_moderation_offense(user_id: str, score: int, reason: str, ip_address: Optional[str] = None) -> int:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO moderation_offenses (offense_id, user_id, score, reason, ip_address, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (f"offense_{uuid.uuid4().hex[:12]}", user_id, score, reason, normalize_ip(ip_address or ""), utc_iso_now()),
        )
        conn.commit()
    return get_sqlite_user_offense_count(user_id)

def sqlite_set_user_ban(user_id: str, banned_until: Optional[datetime]) -> None:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET banned_until = ? WHERE user_id = ?",
            (banned_until.isoformat() if banned_until else None, user_id),
        )
        conn.commit()

def sqlite_update_user_role(user_id: str, role: str) -> None:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET role = ? WHERE user_id = ?", (normalize_role(role), user_id))
        conn.commit()

def sqlite_soft_delete_user(user_id: str, client_ip: str | None = None) -> None:
    user = get_sqlite_user_by_id(user_id)
    if user and user.get("email"):
        sqlite_add_blacklist_entry(user["email"], "email")
    if client_ip:
        normalized_ip = normalize_ip(client_ip)
        if normalized_ip:
            sqlite_add_blacklist_entry(normalized_ip, "ip")
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM likes WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM follows WHERE follower_id = ? OR following_id = ?", (user_id, user_id))
        cursor.execute("DELETE FROM blocks WHERE user_id = ? OR target_user_id = ?", (user_id, user_id))
        cursor.execute("DELETE FROM mutes WHERE user_id = ? OR target_user_id = ?", (user_id, user_id))
        cursor.execute("DELETE FROM comments WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM posts WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM reports WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM notifications WHERE user_id = ? OR actor_user_id = ?", (user_id, user_id))
        cursor.execute("DELETE FROM moderation_offenses WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM users WHERE user_id = ?", (user_id,))
        conn.commit()

def sqlite_get_blacklist_entry(value: str, value_type: str) -> bool:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT 1 FROM blacklist WHERE value = ? AND value_type = ? LIMIT 1",
            (value, value_type),
        )
        return cursor.fetchone() is not None

def sqlite_add_blacklist_entry(value: str, value_type: str) -> None:
    normalized_value = normalize_ip(value) if value_type == "ip" else value
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR IGNORE INTO blacklist (blacklist_id, value, value_type, created_at) VALUES (?, ?, ?, ?)",
            (f"bl_{uuid.uuid4().hex[:12]}", normalized_value, value_type, utc_iso_now()),
        )
        conn.commit()

def sqlite_queue_moderation_item(item: Dict[str, Any]) -> None:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO moderation_queue (
                moderation_id, target_type, target_id, user_id, score, status, reason, created_at, text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["moderation_id"],
                item["target_type"],
                item["target_id"],
                item["user_id"],
                item["score"],
                item["status"],
                item["reason"],
                item["created_at"],
                item.get("text"),
            ),
        )
        conn.commit()

def sqlite_get_moderation_queue(limit: int = 100) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT moderation_id, target_type, target_id, user_id, score, status, reason, created_at, text
            FROM moderation_queue
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]

def sqlite_get_finance_snapshot() -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) AS c FROM users")
        users_count = int(cursor.fetchone()["c"])
        cursor.execute("SELECT COUNT(*) AS c FROM posts")
        posts_count = int(cursor.fetchone()["c"])
        cursor.execute("SELECT COUNT(*) AS c FROM moderation_queue")
        moderation_items = int(cursor.fetchone()["c"])
        cursor.execute("SELECT budget, currency FROM ad_campaigns")
        rows = [dict(row) for row in cursor.fetchall()]
        cursor.execute("SELECT currency, rate_to_eur FROM exchange_rates")
        rate_rows = {row["currency"]: float(row["rate_to_eur"]) for row in cursor.fetchall()}
    ad_total_eur = 0.0
    rates = {
        "EUR": 1.0,
        "USD": 0.92,
        "GBP": 1.17,
        "SEK": 0.089,
        "NOK": 0.086,
        "BTC": 61000.0,
        "CAD": 0.68,
        "AUD": 0.61,
        "CHF": 1.04,
        "JPY": 0.0062,
    }
    rates.update({currency.upper(): rate for currency, rate in rate_rows.items()})
    for row in rows:
        currency = str(row.get("currency") or "EUR").upper()
        rate = rates.get(currency, 1.0)
        ad_total_eur += float(row.get("budget") or 0) * rate
    return {
        "users_count": users_count,
        "posts_count": posts_count,
        "moderation_queue_count": moderation_items,
        "ad_revenue_eur": round(ad_total_eur, 2),
        "exchange_rates": rates,
    }

def sqlite_get_exchange_rates() -> Dict[str, float]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT currency, rate_to_eur FROM exchange_rates")
        rows = cursor.fetchall()
    rates = {
        "EUR": 1.0,
        "USD": 0.92,
        "GBP": 1.17,
        "SEK": 0.089,
        "NOK": 0.086,
        "BTC": 61000.0,
        "CAD": 0.68,
        "AUD": 0.61,
        "CHF": 1.04,
        "JPY": 0.0062,
    }
    for row in rows:
        rates[str(row["currency"]).upper()] = float(row["rate_to_eur"])
    return rates

def sqlite_get_exchange_rates_payload() -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT currency, rate_to_eur, updated_at FROM exchange_rates ORDER BY currency ASC")
        rows = [dict(row) for row in cursor.fetchall()]
    rates = {row["currency"]: float(row["rate_to_eur"]) for row in rows}
    latest_updated_at = max((row.get("updated_at") or "" for row in rows), default="")
    return {"rates": rates, "updated_at": latest_updated_at}

def sqlite_update_exchange_rates(rates: Dict[str, float]) -> Dict[str, float]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        for currency, rate in rates.items():
            cursor.execute(
                "INSERT OR REPLACE INTO exchange_rates (currency, rate_to_eur, updated_at) VALUES (?, ?, ?)",
                (currency.upper(), float(rate), utc_iso_now()),
            )
        conn.commit()
    return sqlite_get_exchange_rates()

async def fetch_exchange_rates_from_provider() -> Optional[Dict[str, float]]:
    if not EXCHANGE_RATES_API_URL:
        return None
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(EXCHANGE_RATES_API_URL)
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        logger.warning("Failed to fetch exchange rates from provider: %s", exc)
        return None

    raw_rates = payload.get("rates") or payload.get("conversion_rates") or {}
    if not isinstance(raw_rates, dict):
        return None

    base_currency = str(payload.get("base_code") or payload.get("base") or "EUR").upper()
    normalized_rates: Dict[str, float] = {"EUR": 1.0}
    parsed_rates: Dict[str, float] = {}
    for currency, rate in raw_rates.items():
        try:
          parsed_rates[str(currency).upper()] = float(rate)
        except Exception:
          continue

    if base_currency == "EUR":
        for currency, rate in parsed_rates.items():
            if rate > 0:
                normalized_rates[currency] = 1.0 / rate if currency != "EUR" else 1.0
        normalized_rates["EUR"] = 1.0
        return normalized_rates

    base_rate_in_eur = parsed_rates.get("EUR")
    base_rate_value = parsed_rates.get(base_currency)
    if base_rate_in_eur and base_rate_value and base_rate_value > 0:
        for currency, rate in parsed_rates.items():
            if rate > 0:
                normalized_rates[currency] = base_rate_in_eur / rate
        normalized_rates["EUR"] = 1.0
        return normalized_rates

    return None

async def refresh_exchange_rates_from_provider() -> Dict[str, float]:
    provider_rates = await fetch_exchange_rates_from_provider()
    if provider_rates:
        if db is not None:
            await db.exchange_rates.update_one(
                {"rates_id": "default"},
                {"$set": {"rates_id": "default", "value": provider_rates, "updated_at": utc_now()}},
                upsert=True,
            )
        else:
            sqlite_update_exchange_rates(provider_rates)
        push_system_log("info", "Exchange rates refreshed from provider", "finance")
        return provider_rates
    push_system_log("warning", "Exchange rates refresh fell back to stored defaults", "finance")
    return sqlite_get_exchange_rates()

async def exchange_rate_refresh_loop() -> None:
    while True:
        try:
            await refresh_exchange_rates_from_provider()
        except Exception as exc:
            logger.warning("Exchange rate refresh loop failed: %s", exc)
            push_system_log("warning", f"Exchange rate refresh loop failed: {exc}", "finance")
        await asyncio.sleep(EXCHANGE_RATES_REFRESH_SECONDS)

def sqlite_get_ad_settings() -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT setting_key, setting_value FROM ad_settings")
        rows = {row["setting_key"]: row["setting_value"] for row in cursor.fetchall()}
    return {
        "in_feed_enabled": rows.get("in_feed_enabled", "0") == "1",
        "in_feed_frequency": int(rows.get("in_feed_frequency", "5")),
        "sidebar_enabled": rows.get("sidebar_enabled", "0") == "1",
        "interstitial_enabled": rows.get("interstitial_enabled", "0") == "1",
        "ad_network_enabled": rows.get("ad_network_enabled", "0") == "1",
        "ad_network_tag": rows.get("ad_network_tag"),
    }

def sqlite_get_moderation_settings() -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT setting_key, setting_value FROM moderation_settings")
        rows = {row["setting_key"]: row["setting_value"] for row in cursor.fetchall()}
    return {
        "sensitivity": max(0, min(100, int(rows.get("sensitivity", "50")))),
    }

def sqlite_update_moderation_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        for key, value in settings.items():
            cursor.execute(
                "INSERT OR REPLACE INTO moderation_settings (setting_key, setting_value) VALUES (?, ?)",
                (key, str(value)),
            )
        conn.commit()
    return sqlite_get_moderation_settings()

def sqlite_update_ad_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        for key, value in settings.items():
            cursor.execute(
                "INSERT OR REPLACE INTO ad_settings (setting_key, setting_value) VALUES (?, ?)",
                (key, json.dumps(value) if not isinstance(value, str) else value),
            )
        conn.commit()
    return sqlite_get_ad_settings()

def sqlite_create_ad_campaign(campaign: Dict[str, Any]) -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO ad_campaigns (
                campaign_id, name, asset_url, asset_type, currency, targeting, budget, start_at, end_at,
                impressions_goal, clicks_goal, placements, created_at, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                campaign["campaign_id"],
                campaign["name"],
                campaign.get("asset_url"),
                campaign.get("asset_type"),
                campaign.get("currency", "EUR"),
                json.dumps(campaign.get("targeting") or {}),
                campaign.get("budget", 0.0),
                campaign.get("start_at"),
                campaign.get("end_at"),
                campaign.get("impressions_goal"),
                campaign.get("clicks_goal"),
                json.dumps(campaign.get("placements") or []),
                campaign.get("created_at"),
                campaign.get("status", "draft"),
            ),
        )
        conn.commit()
    return campaign

def sqlite_list_ad_campaigns() -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT campaign_id, name, asset_url, asset_type, currency, targeting, budget, start_at, end_at,
                   impressions_goal, clicks_goal, placements, created_at, status
            FROM ad_campaigns
            ORDER BY created_at DESC
            """
        )
        rows = []
        for row in cursor.fetchall():
            item = dict(row)
            item["targeting"] = json.loads(item["targeting"] or "{}")
            item["placements"] = json.loads(item["placements"] or "[]")
            rows.append(item)
        return rows

def sqlite_get_public_ad_config() -> Dict[str, Any]:
    settings = sqlite_get_ad_settings()
    return {
        "placements": {
            "in_feed": settings["in_feed_enabled"],
            "sidebar": settings["sidebar_enabled"],
            "interstitial": settings["interstitial_enabled"],
        },
        "frequency": max(1, int(settings["in_feed_frequency"])),
        "network_enabled": settings["ad_network_enabled"],
        "network_tag": settings["ad_network_tag"] or "",
    }

def get_moderation_sensitivity() -> int:
    return max(0, min(100, int(MODERATION_SENSITIVITY)))

def collect_interest_keywords_from_dwell_rows(rows: List[Dict[str, Any]], max_keywords: int = 20) -> List[str]:
    # Collapse raw dwell events into a compact interest profile by weighting
    # longer views more heavily than quick scroll-past behavior.
    weighted_tokens: Dict[str, float] = {}
    for row in rows:
        dwell_weight = max(1.0, min(10.0, float(row.get("dwell_ms") or 0) / 5000.0))
        for token in tokenize_text(f"{row.get('text', '')} {row.get('username', '')}"):
            weighted_tokens[token] = weighted_tokens.get(token, 0.0) + dwell_weight
    return [word for word, _ in sorted(weighted_tokens.items(), key=lambda item: item[1], reverse=True)[:max_keywords]]


def extract_post_keywords(text: str, max_keywords: int = 12) -> List[str]:
    tokens = tokenize_text(text)
    keywords: List[str] = []
    seen = set()
    for token in tokens:
        if token in seen:
            continue
        seen.add(token)
        keywords.append(token)
        if len(keywords) >= max_keywords:
            break
    return keywords

def sqlite_get_user_interest_keywords(user_id: str) -> List[str]:
    # The SQLite path derives the same interest profile from UserInteractions,
    # which keeps the prompt-compliance tables and ranking logic aligned.
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT p.text, p.username, i.dwell_time_ms AS dwell_ms
            FROM UserInteractions i
            JOIN posts p ON p.post_id = i.post_id
            WHERE i.user_id = ? AND i.interaction_type = 'view'
            ORDER BY i.created_at DESC
            LIMIT 30
            """,
            (user_id,),
        )
        rows = [dict(row) for row in cursor.fetchall()]
    return collect_interest_keywords_from_dwell_rows(rows)


def sqlite_upsert_user_interest(user_id: str, keyword: str, weight_delta: float) -> None:
    keyword = (keyword or "").strip().lower()
    if not keyword:
        return
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO UserInterests (user_id, keyword, weight, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, keyword)
            DO UPDATE SET weight = MAX(weight + excluded.weight, 0), updated_at = excluded.updated_at
            """,
            (user_id, keyword, float(weight_delta), utc_iso_now()),
        )
        conn.commit()


def sqlite_record_user_interaction(user_id: str, post_id: str, dwell_time_ms: int, interaction_type: str, keywords: Optional[List[str]] = None) -> None:
    # Persist the explicit interaction stream and update the interest weights
    # in one place so feed ranking can consume both raw events and aggregates.
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO UserInteractions (interaction_id, user_id, post_id, dwell_time_ms, interaction_type, keywords, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"interaction_{uuid.uuid4().hex[:12]}",
                user_id,
                post_id,
                int(dwell_time_ms),
                interaction_type,
                json.dumps([keyword for keyword in (keywords or []) if keyword]),
                utc_iso_now(),
            ),
        )
        conn.commit()


def sqlite_get_user_interest_keywords_v2(user_id: str) -> List[str]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT keyword, weight
            FROM UserInterests
            WHERE user_id = ? AND weight > 0
            ORDER BY weight DESC, updated_at DESC
            LIMIT 30
            """,
            (user_id,),
        )
        rows = cursor.fetchall()
    return [str(row["keyword"]) for row in rows if row and row["keyword"]]


def sqlite_get_user_interest_keywords_merged(user_id: str) -> List[str]:
    keywords = sqlite_get_user_interest_keywords_v2(user_id)
    if keywords:
        return keywords
    return sqlite_get_user_interest_keywords(user_id)


def sqlite_get_user_signal_author_ids(user_id: str) -> List[str]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT DISTINCT p.user_id
            FROM likes l
            JOIN posts p ON p.post_id = l.post_id
            WHERE l.user_id = ?
            UNION
            SELECT DISTINCT p.user_id
            FROM comments c
            JOIN posts p ON p.post_id = c.post_id
            WHERE c.user_id = ?
            LIMIT 30
            """,
            (user_id, user_id),
        )
        return [row["user_id"] for row in cursor.fetchall()]

def sqlite_push_broadcast(message: str) -> int:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, username, profile_picture FROM users")
        users = cursor.fetchall()
        for row in users:
            cursor.execute(
                """
                INSERT INTO notifications (
                    notification_id, user_id, actor_user_id, actor_username, actor_profile_picture,
                    type, post_id, comment_id, created_at, is_read
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"notif_{uuid.uuid4().hex[:12]}",
                    row["user_id"],
                    "system",
                    "Admin",
                    None,
                    "system_broadcast",
                    None,
                    None,
                    utc_iso_now(),
                    0,
                ),
            )
        conn.commit()
        return len(users)

def sqlite_store_dwell_event(user_id: str, post_id: str, dwell_ms: int) -> None:
    post = get_sqlite_post(post_id)
    keywords = []
    if post:
        raw_keywords = post.get("keywords") or "[]"
        try:
            parsed_keywords = json.loads(raw_keywords) if isinstance(raw_keywords, str) else raw_keywords
            if isinstance(parsed_keywords, list):
                keywords = [str(keyword).lower() for keyword in parsed_keywords if str(keyword).strip()]
        except Exception:
            keywords = []
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO dwell_events (dwell_id, user_id, post_id, dwell_ms, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (f"dwell_{uuid.uuid4().hex[:12]}", user_id, post_id, dwell_ms, utc_iso_now()),
        )
        cursor.execute(
            """
            INSERT INTO UserInteractions (interaction_id, user_id, post_id, dwell_time_ms, interaction_type, keywords, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"interaction_{uuid.uuid4().hex[:12]}",
                user_id,
                post_id,
                dwell_ms,
                "view",
                json.dumps(keywords),
                utc_iso_now(),
            ),
        )
        for keyword in keywords:
            cursor.execute(
                """
                INSERT INTO UserInterests (user_id, keyword, weight, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, keyword)
                DO UPDATE SET weight = MAX(weight + excluded.weight, 0), updated_at = excluded.updated_at
                """,
                (user_id, keyword, max(1.0, min(10.0, dwell_ms / 5000.0)), utc_iso_now()),
            )
        conn.commit()

def tokenize_text(text: str) -> List[str]:
    words = []
    for raw in (text or "").lower().split():
        token = "".join(ch for ch in raw if ch.isalnum())
        if len(token) >= 2:
            words.append(token)
    return words

def collect_interest_keywords_from_posts(posts: List[Dict[str, Any]], max_keywords: int = 20) -> List[str]:
    counts: Dict[str, int] = {}
    for post in posts:
        for token in tokenize_text(f"{post.get('text', '')} {post.get('username', '')}"):
            counts[token] = counts.get(token, 0) + 1
    return [word for word, _ in sorted(counts.items(), key=lambda item: item[1], reverse=True)[:max_keywords]]

def rank_posts_with_dwell_signal(
    posts: List[Dict[str, Any]],
    dwell_rows: List[Dict[str, Any]],
    max_keywords: int = 20,
) -> List[Dict[str, Any]]:
    if not posts:
        return posts
    interest_keywords = collect_interest_keywords_from_dwell_rows(dwell_rows, max_keywords=max_keywords)
    return score_posts_by_keywords(posts, interest_keywords)

def score_posts_by_keywords(posts: List[Dict[str, Any]], interest_keywords: List[str]) -> List[Dict[str, Any]]:
    if not interest_keywords:
        return posts
    scored = []
    for index, post in enumerate(posts):
        tokens = set(tokenize_text(f"{post.get('text', '')} {post.get('username', '')}"))
        post_keywords = post.get("keywords") or []
        if isinstance(post_keywords, str):
            try:
                post_keywords = json.loads(post_keywords)
            except Exception:
                post_keywords = []
        tokens.update(str(keyword).lower() for keyword in post_keywords if keyword)
        overlap = len(tokens.intersection(interest_keywords))
        recency_bonus = max(0, len(posts) - index)
        popularity_bonus = min(10, int(post.get("likes_count", 0) / 10))
        score = overlap * 12 + recency_bonus + popularity_bonus
        scored.append((score, post))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [post for _, post in scored]


def score_posts_with_user_signals(
    posts: List[Dict[str, Any]],
    followed_user_ids: Optional[List[str]] = None,
    favorite_author_ids: Optional[List[str]] = None,
    user_profile: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    # Fold follows, likes, and comments into the feed score so dwell-time
    # interest is not the only ranking input.
    followed = set(followed_user_ids or [])
    favorites = set(favorite_author_ids or [])
    profile = user_profile or {}
    if not followed and not favorites:
        return posts
    scored = []
    for index, post in enumerate(posts):
        score = max(0, len(posts) - index)
        user_id = post.get("user_id")
        if user_id in followed:
            score += 14
        if user_id in favorites:
            score += 10
        score += min(8, int(post.get("likes_count", 0) / 20))
        score += min(4, int(post.get("comments_count", 0) / 3))
        if int(profile.get("posts_count", 0) or 0) < 3:
            score -= 2
        if int(profile.get("followers_count", 0) or 0) == 0 and int(profile.get("following_count", 0) or 0) == 0:
            score -= 1
        scored.append((score, post))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [post for _, post in scored]


def collect_affinity_keywords_from_posts(posts: List[Dict[str, Any]], author_ids: Optional[List[str]] = None, max_keywords: int = 20) -> List[str]:
    author_filter = set(author_ids or [])
    if not posts or not author_filter:
        return []
    counts: Dict[str, float] = {}
    for post in posts:
        if post.get("user_id") not in author_filter:
            continue
        weight = 1.0 + min(3.0, int(post.get("likes_count", 0) or 0) / 10.0)
        for token in tokenize_text(f"{post.get('text', '')} {post.get('username', '')}"):
            counts[token] = counts.get(token, 0.0) + weight
    return [word for word, _ in sorted(counts.items(), key=lambda item: item[1], reverse=True)[:max_keywords]]


def score_posts_by_author_affinity(posts: List[Dict[str, Any]], affinity_keywords: List[str]) -> List[Dict[str, Any]]:
    if not posts or not affinity_keywords:
        return posts
    affinity = set(affinity_keywords)
    scored = []
    for index, post in enumerate(posts):
        tokens = set(tokenize_text(f"{post.get('text', '')} {post.get('username', '')}"))
        post_keywords = post.get("keywords") or []
        if isinstance(post_keywords, str):
            try:
                post_keywords = json.loads(post_keywords)
            except Exception:
                post_keywords = []
        tokens.update(str(keyword).lower() for keyword in post_keywords if keyword)
        overlap = len(tokens.intersection(affinity))
        score = max(0, len(posts) - index) + overlap * 10 + min(6, int(post.get("likes_count", 0) / 15))
        scored.append((score, post))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [post for _, post in scored]


def mix_in_explore_posts(posts: List[Dict[str, Any]], explore_ratio: float = 0.18) -> List[Dict[str, Any]]:
    # Keep the feed fresh by re-injecting a controlled amount of exploration
    # after the personalized ranking has been computed.
    if len(posts) < 4:
        return posts
    explore_ratio = max(0.0, min(0.4, float(explore_ratio)))
    explore_count = max(0, min(len(posts) // 4, int(len(posts) * explore_ratio)))
    if explore_count == 0:
        return posts

    ranked = posts[:]
    explore_indices = sorted(random.sample(range(len(posts)), explore_count))
    explore_index_set = set(explore_indices)
    explore_bucket = [ranked[index] for index in explore_indices]
    remainder = [post for index, post in enumerate(ranked) if index not in explore_index_set]

    result: List[Dict[str, Any]] = []
    explore_cursor = 0
    inject_every = max(4, len(posts) // max(1, explore_count))
    for index, post in enumerate(remainder):
        result.append(post)
        if explore_cursor < len(explore_bucket) and (index + 1) % inject_every == 0:
            result.append(explore_bucket[explore_cursor])
            explore_cursor += 1
    result.extend(explore_bucket[explore_cursor:])
    return result[: len(posts)]


def get_explore_ratio_for_user(user: Dict[str, Any]) -> float:
    posts_count = int(user.get("posts_count", 0) or 0)
    followers_count = int(user.get("followers_count", 0) or 0)
    following_count = int(user.get("following_count", 0) or 0)
    if posts_count < 3 and followers_count == 0 and following_count <= 2:
        return 0.3
    if posts_count < 10:
        return 0.24
    if followers_count > 10:
        return 0.12
    return 0.18

async def mongo_soft_delete_user(user_id: str, client_ip: Optional[str] = None) -> None:
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if user and user.get("email"):
        await db.blacklist.update_one(
            {"value": user["email"], "value_type": "email"},
            {"$setOnInsert": {
                "blacklist_id": f"bl_{uuid.uuid4().hex[:12]}",
                "value": user["email"],
                "value_type": "email",
                "created_at": utc_now(),
            }},
            upsert=True,
        )
    if client_ip:
        normalized_ip = normalize_ip(client_ip)
        if normalized_ip:
            await db.blacklist.update_one(
                {"value": normalized_ip, "value_type": "ip"},
                {"$setOnInsert": {
                    "blacklist_id": f"bl_{uuid.uuid4().hex[:12]}",
                    "value": normalized_ip,
                    "value_type": "ip",
                    "created_at": utc_now(),
                }},
                upsert=True,
            )
    await db.likes.delete_many({"user_id": user_id})
    await db.follows.delete_many({"$or": [{"follower_id": user_id}, {"following_id": user_id}]})
    await db.blocks.delete_many({"$or": [{"user_id": user_id}, {"target_user_id": user_id}]})
    await db.mutes.delete_many({"$or": [{"user_id": user_id}, {"target_user_id": user_id}]})
    await db.comments.delete_many({"user_id": user_id})
    await db.posts.delete_many({"user_id": user_id})
    await db.reports.delete_many({"user_id": user_id})
    await db.notifications.delete_many({"$or": [{"user_id": user_id}, {"actor_user_id": user_id}]})
    await db.moderation_offenses.delete_many({"user_id": user_id})
    await db.users.delete_one({"user_id": user_id})

async def mongo_add_moderation_offense(user_id: str, score: int, reason: str, ip_address: Optional[str] = None) -> int:
    await db.moderation_offenses.insert_one({
        "offense_id": f"offense_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "score": score,
        "reason": reason,
        "ip_address": normalize_ip(ip_address or ""),
        "created_at": utc_now(),
    })
    return await db.moderation_offenses.count_documents({"user_id": user_id})


def update_sqlite_user(user_id: str, update_dict: Dict[str, Any]) -> None:
    if not update_dict:
        return
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        columns = []
        values = []
        for key, value in update_dict.items():
            columns.append(f"{key} = ?")
            values.append(value)
        values.append(user_id)
        sql = f"UPDATE users SET {', '.join(columns)} WHERE user_id = ?"
        cursor.execute(sql, values)
        conn.commit()


def create_sqlite_post(post: Dict[str, Any]) -> None:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        created_at = post["created_at"]
        if isinstance(created_at, datetime):
            created_at = created_at.isoformat()
        keywords = post.get("keywords") or []
        keywords_json = json.dumps(keywords)
        cursor.execute(
            """
            INSERT INTO posts (
                post_id, user_id, username, profile_picture, text, image, likes_count, comments_count, created_at, keywords
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                post["post_id"],
                post["user_id"],
                post["username"],
                post.get("profile_picture"),
                post.get("text", ""),
                post.get("image"),
                post.get("likes_count", 0),
                post.get("comments_count", 0),
                created_at,
                keywords_json,
            ),
        )
        cursor.execute(
            "UPDATE users SET posts_count = COALESCE(posts_count, 0) + 1 WHERE user_id = ?",
            (post["user_id"],),
        )
        conn.commit()


def get_sqlite_feed(skip: int = 0, limit: int = 20, user_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        if user_ids:
            placeholders = ",".join(["?"] * len(user_ids))
            cursor.execute(
                f"""
                SELECT post_id, user_id, username, profile_picture, text, image, likes_count, comments_count, created_at
                , keywords
                FROM posts
                WHERE user_id IN ({placeholders})
                ORDER BY datetime(created_at) DESC
                LIMIT ? OFFSET ?
                """,
                tuple(user_ids) + (limit, skip),
            )
        else:
            cursor.execute(
                """
                SELECT post_id, user_id, username, profile_picture, text, image, likes_count, comments_count, created_at
                , keywords
                FROM posts
                ORDER BY datetime(created_at) DESC
                LIMIT ? OFFSET ?
                """,
                (limit, skip),
            )
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_sqlite_post(post_id: str) -> Optional[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT post_id, user_id, username, profile_picture, text, image, likes_count, comments_count, created_at, keywords
            FROM posts
            WHERE post_id = ?
            """,
            (post_id,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None


def get_sqlite_comments(post_id: str) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT comment_id, post_id, user_id, username, profile_picture, text, created_at
            FROM comments
            WHERE post_id = ?
            ORDER BY datetime(created_at) ASC
            """,
            (post_id,),
        )
        return [dict(row) for row in cursor.fetchall()]


def get_sqlite_comment_by_id(comment_id: str) -> Optional[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT comment_id, post_id, user_id, username, profile_picture, text, created_at
            FROM comments
            WHERE comment_id = ?
            """,
            (comment_id,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None


def get_sqlite_comments_for_posts(post_ids: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    if not post_ids:
        return {}
    placeholders = ",".join(["?"] * len(post_ids))
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT comment_id, post_id, user_id, username, profile_picture, text, created_at
            FROM comments
            WHERE post_id IN ({placeholders})
            ORDER BY datetime(created_at) ASC
            """,
            tuple(post_ids),
        )
        rows = [dict(row) for row in cursor.fetchall()]
    grouped: Dict[str, List[Dict[str, Any]]] = {pid: [] for pid in post_ids}
    for row in rows:
        grouped.setdefault(row["post_id"], []).append(row)
    return grouped


def sqlite_toggle_like(post_id: str, user_id: str) -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT like_id FROM likes WHERE post_id = ? AND user_id = ?", (post_id, user_id))
        existing = cursor.fetchone()
        if existing:
            cursor.execute("DELETE FROM likes WHERE post_id = ? AND user_id = ?", (post_id, user_id))
            cursor.execute(
                "UPDATE posts SET likes_count = CASE WHEN likes_count > 0 THEN likes_count - 1 ELSE 0 END WHERE post_id = ?",
                (post_id,),
            )
            is_liked = False
        else:
            like_id = f"like_{uuid.uuid4().hex[:12]}"
            created_at = utc_now().isoformat()
            cursor.execute(
                "INSERT INTO likes (like_id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)",
                (like_id, post_id, user_id, created_at),
            )
            cursor.execute("UPDATE posts SET likes_count = likes_count + 1 WHERE post_id = ?", (post_id,))
            is_liked = True

        cursor.execute("SELECT likes_count FROM posts WHERE post_id = ?", (post_id,))
        count_row = cursor.fetchone()
        likes_count = int(count_row["likes_count"]) if count_row else 0
        conn.commit()
        return {"is_liked": is_liked, "likes_count": likes_count}


def create_sqlite_comment(post_id: str, user: Dict[str, Any], text: str) -> Dict[str, Any]:
    comment_id = f"comment_{uuid.uuid4().hex[:12]}"
    created_at = utc_now().isoformat()
    comment = {
        "comment_id": comment_id,
        "post_id": post_id,
        "user_id": user["user_id"],
        "username": user["username"],
        "profile_picture": user.get("profile_picture"),
        "text": text,
        "created_at": created_at,
    }
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO comments (comment_id, post_id, user_id, username, profile_picture, text, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                comment["comment_id"],
                comment["post_id"],
                comment["user_id"],
                comment["username"],
                comment["profile_picture"],
                comment["text"],
                comment["created_at"],
            ),
        )
        cursor.execute("UPDATE posts SET comments_count = comments_count + 1 WHERE post_id = ?", (post_id,))
        conn.commit()
    return comment


def update_sqlite_comment(comment_id: str, new_text: str) -> Optional[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE comments SET text = ? WHERE comment_id = ?", (new_text, comment_id))
        if cursor.rowcount == 0:
            return None
        conn.commit()
    return get_sqlite_comment_by_id(comment_id)


def delete_sqlite_comment(comment_id: str) -> Optional[Dict[str, Any]]:
    existing = get_sqlite_comment_by_id(comment_id)
    if not existing:
        return None
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM comments WHERE comment_id = ?", (comment_id,))
        cursor.execute(
            "UPDATE posts SET comments_count = CASE WHEN comments_count > 0 THEN comments_count - 1 ELSE 0 END WHERE post_id = ?",
            (existing["post_id"],),
        )
        conn.commit()
    return existing


def sqlite_follow_exists(follower_id: str, following_id: str) -> bool:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
            (follower_id, following_id),
        )
        return cursor.fetchone() is not None


def sqlite_following_ids(follower_id: str) -> List[str]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT following_id FROM follows WHERE follower_id = ?", (follower_id,))
        return [row["following_id"] for row in cursor.fetchall()]


def sqlite_toggle_follow(follower_id: str, following_id: str) -> bool:
    """Returns True if now following, False if unfollowed."""
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?",
            (follower_id, following_id),
        )
        exists = cursor.fetchone() is not None
        if exists:
            cursor.execute(
                "DELETE FROM follows WHERE follower_id = ? AND following_id = ?",
                (follower_id, following_id),
            )
            cursor.execute(
                "UPDATE users SET following_count = CASE WHEN following_count > 0 THEN following_count - 1 ELSE 0 END WHERE user_id = ?",
                (follower_id,),
            )
            cursor.execute(
                "UPDATE users SET followers_count = CASE WHEN followers_count > 0 THEN followers_count - 1 ELSE 0 END WHERE user_id = ?",
                (following_id,),
            )
            is_following = False
        else:
            cursor.execute(
                "INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)",
                (follower_id, following_id, datetime.now(timezone.utc).isoformat()),
            )
            cursor.execute(
                "UPDATE users SET following_count = COALESCE(following_count, 0) + 1 WHERE user_id = ?",
                (follower_id,),
            )
            cursor.execute(
                "UPDATE users SET followers_count = COALESCE(followers_count, 0) + 1 WHERE user_id = ?",
                (following_id,),
            )
            is_following = True
        conn.commit()
    return is_following


def create_sqlite_notification(
    user_id: str,
    actor: Dict[str, Any],
    notification_type: str,
    post_id: Optional[str] = None,
    comment_id: Optional[str] = None,
) -> Dict[str, Any]:
    notification = {
        "notification_id": f"notif_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "actor_user_id": actor["user_id"],
        "actor_username": actor["username"],
        "actor_profile_picture": actor.get("profile_picture"),
        "type": notification_type,
        "post_id": post_id,
        "comment_id": comment_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "is_read": 0,
    }
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO notifications (
                notification_id, user_id, actor_user_id, actor_username, actor_profile_picture,
                type, post_id, comment_id, created_at, is_read
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                notification["notification_id"],
                notification["user_id"],
                notification["actor_user_id"],
                notification["actor_username"],
                notification["actor_profile_picture"],
                notification["type"],
                notification["post_id"],
                notification["comment_id"],
                notification["created_at"],
                notification["is_read"],
            ),
        )
        conn.commit()
    notification["is_read"] = bool(notification["is_read"])
    return notification


def get_sqlite_notifications(user_id: str, limit: int = 30) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT notification_id, user_id, actor_user_id, actor_username, actor_profile_picture,
                   type, post_id, comment_id, created_at, is_read
            FROM notifications
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, limit),
        )
        rows = [dict(r) for r in cursor.fetchall()]
    for row in rows:
        row["is_read"] = bool(row.get("is_read"))
    return rows


def get_sqlite_unread_notifications_count(user_id: str) -> int:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND COALESCE(is_read, 0) = 0",
            (user_id,),
        )
        row = cursor.fetchone()
        return int(row["c"]) if row else 0


def mark_sqlite_notification_read(user_id: str, notification_id: str) -> bool:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND notification_id = ?",
            (user_id, notification_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def mark_all_sqlite_notifications_read(user_id: str) -> int:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND COALESCE(is_read, 0) = 0",
            (user_id,),
        )
        conn.commit()
        return cursor.rowcount


def sqlite_toggle_relation(table: str, user_id: str, target_user_id: str) -> bool:
    """Generic toggle for follows-like tables. Returns True if relation exists after toggle."""
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT 1 FROM {table} WHERE user_id = ? AND target_user_id = ?",
            (user_id, target_user_id),
        )
        exists = cursor.fetchone() is not None
        if exists:
            cursor.execute(
                f"DELETE FROM {table} WHERE user_id = ? AND target_user_id = ?",
                (user_id, target_user_id),
            )
            now_exists = False
        else:
            cursor.execute(
                f"INSERT INTO {table} (id, user_id, target_user_id, created_at) VALUES (?, ?, ?, ?)",
                (f"{table[:-1]}_{uuid.uuid4().hex[:12]}", user_id, target_user_id, datetime.now(timezone.utc).isoformat()),
            )
            now_exists = True
        conn.commit()
    return now_exists


def sqlite_related_user_ids(table: str, user_id: str) -> List[str]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"SELECT target_user_id FROM {table} WHERE user_id = ?", (user_id,))
        return [row["target_user_id"] for row in cursor.fetchall()]


async def get_user_with_fresh_counts(user_id: str) -> Optional[Dict[str, Any]]:
    if db is not None:
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
        if not user:
            return None
        followers_count = await db.follows.count_documents({"following_id": user_id})
        following_count = await db.follows.count_documents({"follower_id": user_id})
        posts_count = await db.posts.count_documents({"user_id": user_id})
        user["followers_count"] = followers_count
        user["following_count"] = following_count
        user["posts_count"] = posts_count
        user["role"] = normalize_role(user.get("role"))
        user["banned_until"] = user.get("banned_until")
        return user
    user = get_sqlite_user_by_id(user_id)
    if not user:
        return None
    repo_user = repository_get_user_by_id(user_id)
    if repo_user:
        repo_user["role"] = normalize_role(repo_user.get("role"))
        repo_user["banned_until"] = repo_user.get("banned_until")
        repo_user.setdefault("followers_count", 0)
        repo_user.setdefault("following_count", 0)
        repo_user.setdefault("posts_count", 0)
        return repo_user
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) AS c FROM follows WHERE following_id = ?", (user_id,))
        followers_count = int(cursor.fetchone()["c"])
        cursor.execute("SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?", (user_id,))
        following_count = int(cursor.fetchone()["c"])
        cursor.execute("SELECT COUNT(*) AS c FROM posts WHERE user_id = ?", (user_id,))
        posts_count = int(cursor.fetchone()["c"])
    user["followers_count"] = followers_count
    user["following_count"] = following_count
    user["posts_count"] = posts_count
    user["role"] = normalize_role(user.get("role"))
    user["banned_until"] = user.get("banned_until")
    return user

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Get current authenticated user from token"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = authorization.replace("Bearer ", "")
    
    try:
        if db is not None:
            # First check if it's a Google OAuth session token
            session = await db.user_sessions.find_one(
                {"session_token": token},
                {"_id": 0}
            )
            
            if session:
                # Check if session is expired
                expires_at = session.get('expires_at')
                if expires_at:
                    if expires_at.tzinfo is None:
                        expires_at = expires_at.replace(tzinfo=timezone.utc)
                    if expires_at < datetime.now(timezone.utc):
                        raise HTTPException(status_code=401, detail="Session expired")
                
                # Get user from database
                user = await db.users.find_one(
                    {"user_id": session['user_id']},
                    {"_id": 0}
                )
                if not user:
                    raise HTTPException(status_code=401, detail="User not found")
                return user

            # If not a session token, try JWT
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = payload.get("sub")
            if user_id is None:
                raise HTTPException(status_code=401, detail="Invalid token")
            
            user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
            if user is None:
                raise HTTPException(status_code=401, detail="User not found")
            ensure_not_banned(user)
            
            return user
        else:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = payload.get("sub")
            if user_id is None:
                raise HTTPException(status_code=401, detail="Invalid token")

            user = get_sqlite_user_by_id(user_id)
            if user is None:
                raise HTTPException(status_code=401, detail="User not found")
            ensure_not_banned(user)

            return user
    
    except jwt.JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as e:
        logger.error(f"Error in get_current_user: {str(e)}")
        raise HTTPException(status_code=401, detail="Authentication failed")

# =======================
# AUTH ENDPOINTS
# =======================

@api_router.post("/auth/register", response_model=AuthResponse)
async def register(user_data: UserRegister, request: Request):
    """Register a new user with email/password"""
    await ensure_request_ip_not_blacklisted(request)
    # Check if email already exists
    if db is not None:
        existing_user = await db.users.find_one({"email": user_data.email})
    elif REPOSITORY_ADAPTER is not None:
        existing_user = repository_get_user_by_email(user_data.email)
    else:
        existing_user = get_sqlite_user_by_email(user_data.email)

    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Check if username already exists
    if db is not None:
        existing_username = await db.users.find_one({"username": user_data.username})
    elif REPOSITORY_ADAPTER is not None:
        existing_username = repository_get_user_by_username(user_data.username)
    else:
        existing_username = get_sqlite_user_by_username(user_data.username)

    if existing_username:
        raise HTTPException(status_code=400, detail="Username already taken")
    
    # Create new user
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    hashed_pwd = hash_password(user_data.password)
    
    user = {
        "user_id": user_id,
        "email": user_data.email,
        "password_hash": hashed_pwd,
        "username": user_data.username,
        "profile_picture": None,
        "bio": None,
        "followers_count": 0,
        "following_count": 0,
        "posts_count": 0,
        "created_at": utc_now(),
        "role": "Super Admin" if SUPER_ADMIN_EMAIL and user_data.email == SUPER_ADMIN_EMAIL else "User",
        "banned_until": None,
    }

    if db is not None:
        await db.users.insert_one(user)
    else:
        with get_sqlite_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO users (user_id, email, password_hash, username, profile_picture, bio, followers_count, following_count, posts_count, created_at, role, banned_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    user_id,
                    user_data.email,
                    hashed_pwd,
                    user_data.username,
                    None,
                    None,
                    0,
                    0,
                    0,
                    user["created_at"].isoformat(),
                    user["role"],
                    None,
                )
            )
            conn.commit()
    
    # Create access token
    access_token = create_access_token(data={"sub": user_id})
    
    # Remove sensitive data
    user.pop("password_hash", None)
    user.pop("banned_until", None)
    
    return AuthResponse(
        token=access_token,
        user=UserProfile(**user)
    )

@api_router.post("/auth/login", response_model=AuthResponse)
async def login(credentials: UserLogin):
    """Login with email/password"""
    if db is not None:
        user = await db.users.find_one({"email": credentials.email})
    elif REPOSITORY_ADAPTER is not None:
        user = repository_get_user_by_email(credentials.email)
    else:
        user = get_sqlite_user_by_email(credentials.email)
    
    if not user or not verify_password(credentials.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Create access token
    access_token = create_access_token(data={"sub": user["user_id"]})
    
    # Remove sensitive data
    user.pop("_id", None)
    user.pop("password_hash", None)
    user["role"] = normalize_role(user.get("role"))

    return AuthResponse(
        token=access_token,
        user=UserProfile(**user)
    )

@api_router.post("/auth/google/session", response_model=AuthResponse)
async def google_auth_session(request: GoogleSessionRequest):
    """Process Google OAuth session from Emergent Auth"""
    try:
        # Call Emergent session API
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": request.session_id},
                timeout=10.0
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=400, detail="Invalid session ID")
            
            session_data = response.json()
            email = session_data.get("email")
            name = session_data.get("name", "")
            picture = session_data.get("picture")
            session_token = session_data.get("session_token")
            
            if not email or not session_token:
                raise HTTPException(status_code=400, detail="Invalid session data")
            
            # Check if user exists by email
            existing_user = await db.users.find_one({"email": email})
            
            if existing_user:
                user_id = existing_user["user_id"]
                # Update profile picture if it's from Google
                if picture and not existing_user.get("profile_picture"):
                    await db.users.update_one(
                        {"user_id": user_id},
                        {"$set": {"profile_picture": picture}}
                    )
            else:
                # Create new user
                user_id = f"user_{uuid.uuid4().hex[:12]}"
                username = email.split('@')[0] + str(uuid.uuid4().hex[:4])
                
                new_user = {
                    "user_id": user_id,
                    "email": email,
                    "username": username,
                    "profile_picture": picture,
                    "bio": None,
                    "google_id": session_data.get("id"),
                    "followers_count": 0,
                    "following_count": 0,
                    "posts_count": 0,
                    "created_at": datetime.now(timezone.utc)
                }
                
                await db.users.insert_one(new_user)
            
            # Store session in database
            session_doc = {
                "session_token": session_token,
                "user_id": user_id,
                "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                "created_at": datetime.now(timezone.utc)
            }
            
            await db.user_sessions.update_one(
                {"session_token": session_token},
                {"$set": session_doc},
                upsert=True
            )
            
            # Get updated user
            user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
            
            return AuthResponse(
                token=session_token,
                user=UserProfile(**user)
            )
    
    except httpx.RequestError as e:
        logger.error(f"Error calling Emergent Auth API: {str(e)}")
        raise HTTPException(status_code=500, detail="Authentication service error")
    except Exception as e:
        logger.error(f"Error in Google auth: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/auth/me", response_model=UserProfile)
async def get_me(authorization: Optional[str] = Header(None)):
    """Get current user profile"""
    user = await get_current_user(authorization)
    fresh = await get_user_with_fresh_counts(user["user_id"])
    return UserProfile(**(fresh or user))

@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    """Logout user and invalidate session"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = authorization.replace("Bearer ", "")
    
    # Delete session if it exists
    if db is not None:
        await db.user_sessions.delete_one({"session_token": token})
    
    return {"message": "Logged out successfully"}

# =======================
# USER ENDPOINTS
# =======================

@api_router.get("/users/me", response_model=UserProfile)
async def get_my_profile(authorization: Optional[str] = Header(None)):
    """Get current user's full profile"""
    user = await get_current_user(authorization)
    fresh = await get_user_with_fresh_counts(user["user_id"])
    return UserProfile(**(fresh or user))

@api_router.put("/users/me", response_model=UserProfile)
async def update_my_profile(
    update_data: UserUpdate,
    authorization: Optional[str] = Header(None)
):
    """Update current user's profile"""
    user = await get_current_user(authorization)
    
    update_dict = update_data.dict(exclude_unset=True)
    
    if "username" in update_dict:
        if db is not None:
            existing = await db.users.find_one({
                "username": update_dict["username"],
                "user_id": {"$ne": user["user_id"]}
            })
        elif REPOSITORY_ADAPTER is not None:
            existing = repository_get_user_by_username(update_dict["username"])
        else:
            existing = get_sqlite_user_by_username(update_dict["username"])

        if existing and existing["user_id"] != user["user_id"]:
            raise HTTPException(status_code=400, detail="Username already taken")
    
    if update_dict:
        if db is not None:
            await db.users.update_one(
                {"user_id": user["user_id"]},
                {"$set": update_dict}
            )
            updated_user = await db.users.find_one(
                {"user_id": user["user_id"]},
                {"_id": 0, "password_hash": 0}
            )
        elif REPOSITORY_ADAPTER is not None:
            updated_user = repository_get_user_by_id(user["user_id"])
        else:
            update_sqlite_user(user["user_id"], update_dict)
            updated_user = get_sqlite_user_by_id(user["user_id"])
    else:
        updated_user = user
    
    return UserProfile(**updated_user)

@api_router.get("/users/{user_id}", response_model=UserProfile)
async def get_user_profile(user_id: str, authorization: Optional[str] = Header(None)):
    """Get any user's public profile"""
    await get_current_user(authorization)  # Verify authentication
    user = await get_user_with_fresh_counts(user_id)
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return UserProfile(**user)

# =======================
# POST ENDPOINTS
# =======================

@api_router.post("/posts", response_model=Post)
async def create_post(
    text: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None),
    authorization: Optional[str] = Header(None),
    request: Request = None
):
    """Create a new post. Accepts multipart/form-data with optional image file."""
    if request is not None:
        await ensure_request_ip_not_blacklisted(request)
    user = await get_current_user(authorization)
    ensure_not_banned(user)

    if (not text or not text.strip()) and image is None:
        raise HTTPException(status_code=400, detail="Post must contain text or an image")

    client_ip = normalize_ip(get_client_ip(request))
    locale_hint = normalize_locale_hint((request.headers.get("accept-language") if request else None))
    moderation = await moderate_content(text or "", locale_hint=locale_hint, client_ip=client_ip)
    if moderation.action == "block":
        if db is not None:
            offense_count = await mongo_add_moderation_offense(user["user_id"], moderation.score, moderation.reason or "blocked post", client_ip)
        else:
            offense_count = sqlite_add_moderation_offense(user["user_id"], moderation.score, moderation.reason or "blocked post", client_ip)
        action, banned_until = penalty_for_offense(offense_count)
        if action == "suspend":
            if db is not None:
                await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"banned_until": banned_until}})
            else:
                sqlite_set_user_ban(user["user_id"], banned_until)
            raise HTTPException(status_code=403, detail="Content blocked and user suspended")
        if db is not None:
            await mongo_soft_delete_user(user["user_id"])
        else:
            sqlite_soft_delete_user(user["user_id"], client_ip=client_ip)
        raise HTTPException(status_code=403, detail="Content blocked and user removed")

    post_id = f"post_{uuid.uuid4().hex[:12]}"

    image_url = None
    if image is not None:
        try:
            contents = await image.read()
            # Determine extension from content type
            content_type = (image.content_type or '').lower()
            if 'jpeg' in content_type or 'jpg' in content_type:
                ext = '.jpg'
            elif 'png' in content_type:
                ext = '.png'
            else:
                ext = ''

            filename = f"{post_id}{ext}"
            out_path = uploads_dir / filename
            with open(out_path, 'wb') as f:
                f.write(contents)

            image_url = f"/uploads/{filename}"
        except Exception as e:
            logger.error(f"Error saving uploaded image: {e}")
            raise HTTPException(status_code=500, detail="Failed to save uploaded image")

    post = {
        "post_id": post_id,
        "user_id": user["user_id"],
        "username": user["username"],
        "profile_picture": user.get("profile_picture"),
        "text": text.strip() if text else '',
        "image": image_url,
        "likes_count": 0,
        "comments_count": 0,
        "created_at": datetime.now(timezone.utc),
        "keywords": extract_post_keywords(text or ""),
    }

    if db is not None:
        await db.posts.insert_one(post)
        # Increment user's post count
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$inc": {"posts_count": 1}}
        )
        if moderation.queue:
            await db.moderation_queue.insert_one({
                "moderation_id": f"mod_{uuid.uuid4().hex[:12]}",
                "target_type": "post",
                "target_id": post_id,
                "user_id": user["user_id"],
                "score": moderation.score,
                "status": "queued",
                "reason": moderation.reason or "needs-review",
                "created_at": utc_now(),
                "text": post["text"],
            })
    else:
        if REPOSITORY_ADAPTER is not None:
            REPOSITORY_ADAPTER.create_post(post)
        else:
            create_sqlite_post(post)
        if moderation.queue:
            sqlite_queue_moderation_item({
                "moderation_id": f"mod_{uuid.uuid4().hex[:12]}",
                "target_type": "post",
                "target_id": post_id,
                "user_id": user["user_id"],
                "score": moderation.score,
                "status": "queued",
                "reason": moderation.reason or "needs-review",
                "created_at": utc_iso_now(),
                "text": post["text"],
            })

    post.pop("_id", None)
    return Post(**post, is_liked=False)

@api_router.get("/posts", response_model=List[Post])
async def get_feed(
    skip: int = 0,
    limit: int = 20,
    following_only: bool = False,
    authorization: Optional[str] = Header(None)
):
    """Get feed posts.

    The feed combines dwell-derived interests, explicit social signals, and a
    small explore bucket so the result behaves like a personalized feed rather
    than a strict chronological list.
    """
    current_user = await get_current_user(authorization)
    
    if db is not None:
        muted = await db.mutes.find({"user_id": current_user["user_id"]}, {"target_user_id": 1, "_id": 0}).to_list(length=None)
        blocked = await db.blocks.find({"user_id": current_user["user_id"]}, {"target_user_id": 1, "_id": 0}).to_list(length=None)
        excluded_user_ids = {d["target_user_id"] for d in muted + blocked}

        filter_query: Dict[str, Any] = {}
        if following_only:
            followed = await db.follows.find(
                {"follower_id": current_user["user_id"]},
                {"_id": 0, "following_id": 1},
            ).to_list(length=None)
            followed_ids = [f["following_id"] for f in followed]
            visible_ids = list(set(followed_ids + [current_user["user_id"]]))
            filter_query = {"user_id": {"$in": visible_ids}}
        if excluded_user_ids:
            existing = filter_query.get("user_id")
            if isinstance(existing, dict) and "$in" in existing:
                filter_query["user_id"]["$in"] = [uid for uid in existing["$in"] if uid not in excluded_user_ids]
            else:
                filter_query["user_id"] = {"$nin": list(excluded_user_ids)}

        # Get posts sorted by newest first
        posts_cursor = db.posts.find(
            filter_query,
            {"_id": 0}
        ).sort("created_at", -1).skip(skip).limit(limit)
        
        posts = await posts_cursor.to_list(length=limit)
        
        # Check which posts are liked by current user
        post_ids = [p["post_id"] for p in posts]
        likes = await db.likes.find({
            "post_id": {"$in": post_ids},
            "user_id": current_user["user_id"]
        }).to_list(length=None)
        
        liked_post_ids = {like["post_id"] for like in likes}
        
        # Add is_liked flag
        for post in posts:
            post["is_liked"] = post["post_id"] in liked_post_ids

        comments = await db.comments.find(
            {"post_id": {"$in": post_ids}},
            {"_id": 0}
        ).sort("created_at", 1).to_list(length=None)
        comments_by_post: Dict[str, List[Dict[str, Any]]] = {pid: [] for pid in post_ids}
        for comment in comments:
            comments_by_post.setdefault(comment["post_id"], []).append(comment)
        for post in posts:
            post_comments = comments_by_post.get(post["post_id"], [])
            post["comments"] = post_comments
            post["comments_count"] = len(post_comments)
        interest_keywords = []
        followed_ids = []
        favorite_author_ids = []
        if posts:
            collection_names = await db.list_collection_names()
            followed = await db.follows.find(
                {"follower_id": current_user["user_id"]},
                {"_id": 0, "following_id": 1},
            ).to_list(length=None)
            followed_ids = [f["following_id"] for f in followed]
            liked_posts = await db.likes.find(
                {"user_id": current_user["user_id"]},
                {"_id": 0, "post_id": 1},
            ).to_list(length=30)
            liked_post_ids = [like["post_id"] for like in liked_posts]
            if liked_post_ids:
                liked_authors = await db.posts.find(
                    {"post_id": {"$in": liked_post_ids}},
                    {"_id": 0, "user_id": 1},
                ).to_list(length=None)
                favorite_author_ids.extend([row["user_id"] for row in liked_authors if row.get("user_id")])
            comment_authors = await db.comments.find(
                {"user_id": current_user["user_id"]},
                {"_id": 0, "post_id": 1},
            ).to_list(length=30)
            comment_post_ids = [comment["post_id"] for comment in comment_authors]
            if comment_post_ids:
                commented_authors = await db.posts.find(
                    {"post_id": {"$in": comment_post_ids}},
                    {"_id": 0, "user_id": 1},
                ).to_list(length=None)
                favorite_author_ids.extend([row["user_id"] for row in commented_authors if row.get("user_id")])
            if "dwell_events" in collection_names:
                recent_dwell = await db.dwell_events.find(
                    {"user_id": current_user["user_id"]},
                    {"_id": 0, "post_id": 1, "dwell_ms": 1},
                ).sort("created_at", -1).limit(30).to_list(length=30)
                dwell_ids = [d["post_id"] for d in recent_dwell]
                if dwell_ids:
                    dwell_posts = await db.posts.find(
                        {"post_id": {"$in": dwell_ids}},
                        {"_id": 0, "text": 1, "username": 1, "likes_count": 1},
                    ).to_list(length=None)
                    dwell_rows = []
                    for dwell in recent_dwell:
                        matched = next((post for post in dwell_posts if post.get("post_id") == dwell.get("post_id")), {})
                        dwell_rows.append({
                            "text": matched.get("text", ""),
                            "username": matched.get("username", ""),
                            "dwell_ms": dwell.get("dwell_ms", 0),
                        })
                    posts = rank_posts_with_dwell_signal(posts, dwell_rows)
            affinity_keywords = collect_affinity_keywords_from_posts(posts, followed_ids + favorite_author_ids)
            posts = score_posts_by_author_affinity(posts, affinity_keywords)
        posts = score_posts_with_user_signals(posts, followed_ids, favorite_author_ids, current_user)
    else:
        repo_posts = repository_get_feed(skip=skip, limit=limit)
        if repo_posts is not None:
            posts = repo_posts
        else:
            excluded_user_ids = set(sqlite_related_user_ids("mutes", current_user["user_id"]) + sqlite_related_user_ids("blocks", current_user["user_id"]))
            feed_user_ids = None
            if following_only:
                feed_user_ids = list(set(sqlite_following_ids(current_user["user_id"]) + [current_user["user_id"]]))
                if excluded_user_ids:
                    feed_user_ids = [uid for uid in feed_user_ids if uid not in excluded_user_ids]
            posts = get_sqlite_feed(skip=skip, limit=limit, user_ids=feed_user_ids)
            if excluded_user_ids and not following_only:
                posts = [p for p in posts if p["user_id"] not in excluded_user_ids]
        post_ids = [p["post_id"] for p in posts]
        comments_by_post = get_sqlite_comments_for_posts(post_ids)
        for post in posts:
            post["is_liked"] = False
            post_comments = comments_by_post.get(post["post_id"], [])
            post["comments"] = post_comments
            post["comments_count"] = len(post_comments)
        interest_keywords = sqlite_get_user_interest_keywords_merged(current_user["user_id"])
        followed_ids = sqlite_following_ids(current_user["user_id"])
        favorite_author_ids = sqlite_get_user_signal_author_ids(current_user["user_id"])
        if interest_keywords:
            dwell_rows = [{"text": keyword, "username": "", "dwell_ms": 5000} for keyword in interest_keywords]
            posts = rank_posts_with_dwell_signal(posts, dwell_rows)
        else:
            posts = score_posts_by_keywords(posts, interest_keywords)
        affinity_keywords = collect_affinity_keywords_from_posts(posts, followed_ids + favorite_author_ids)
        posts = score_posts_by_author_affinity(posts, affinity_keywords)
        posts = score_posts_with_user_signals(posts, followed_ids, favorite_author_ids, current_user)
        posts = mix_in_explore_posts(posts, get_explore_ratio_for_user(current_user))
    
    return [Post(**post) for post in posts]

@api_router.get("/posts/{post_id}", response_model=Post)
async def get_post(
    post_id: str,
    authorization: Optional[str] = Header(None)
):
    """Get a specific post"""
    current_user = await get_current_user(authorization)
    post = await db.posts.find_one({"post_id": post_id}, {"_id": 0}) if db is not None else repository_get_post(post_id)
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Check if current user liked this post
    like = await db.likes.find_one({
        "post_id": post_id,
        "user_id": current_user["user_id"]
    })
    
    post["is_liked"] = like is not None
    
    return Post(**post)

# =======================
# LIKE ENDPOINTS
# =======================

@api_router.post("/posts/{post_id}/like")
async def like_post(
    post_id: str,
    authorization: Optional[str] = Header(None)
):
    """Toggle like on a post"""
    user = await get_current_user(authorization)

    if db is not None:
        post = await db.posts.find_one({"post_id": post_id})
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")

        existing_like = await db.likes.find_one({
            "post_id": post_id,
            "user_id": user["user_id"]
        })

        if existing_like:
            await db.likes.delete_one({
                "post_id": post_id,
                "user_id": user["user_id"]
            })
            await db.posts.update_one(
                {"post_id": post_id},
                {"$inc": {"likes_count": -1}}
            )
            is_liked = False
        else:
            like = {
                "like_id": f"like_{uuid.uuid4().hex[:12]}",
                "post_id": post_id,
                "user_id": user["user_id"],
                "created_at": datetime.now(timezone.utc)
            }
            await db.likes.insert_one(like)
            await db.posts.update_one(
                {"post_id": post_id},
                {"$inc": {"likes_count": 1}}
            )
            is_liked = True
            if post["user_id"] != user["user_id"]:
                await db.notifications.insert_one({
                    "notification_id": f"notif_{uuid.uuid4().hex[:12]}",
                    "user_id": post["user_id"],
                    "actor_user_id": user["user_id"],
                    "actor_username": user["username"],
                    "actor_profile_picture": user.get("profile_picture"),
                    "type": "post_like",
                    "post_id": post_id,
                    "comment_id": None,
                    "created_at": datetime.now(timezone.utc),
                    "is_read": False,
                })

        updated_post = await db.posts.find_one({"post_id": post_id}, {"_id": 0, "likes_count": 1})
        likes_count = int(updated_post.get("likes_count", 0)) if updated_post else 0
        return {"message": "Like toggled", "is_liked": is_liked, "likes_count": likes_count}
    else:
        post = get_sqlite_post(post_id)
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        result = sqlite_toggle_like(post_id, user["user_id"])
        if result.get("is_liked") and post["user_id"] != user["user_id"]:
            create_sqlite_notification(
                user_id=post["user_id"],
                actor=user,
                notification_type="post_like",
                post_id=post_id,
            )
        return {"message": "Like toggled", **result}

@api_router.delete("/posts/{post_id}/like")
async def unlike_post(
    post_id: str,
    authorization: Optional[str] = Header(None)
):
    """Unlike a post"""
    user = await get_current_user(authorization)
    
    # Delete like
    result = await db.likes.delete_one({
        "post_id": post_id,
        "user_id": user["user_id"]
    })
    
    if result.deleted_count == 0:
        return {"message": "Like not found"}
    
    # Decrement post likes count
    await db.posts.update_one(
        {"post_id": post_id},
        {"$inc": {"likes_count": -1}}
    )
    
    return {"message": "Post unliked"}

# =======================
# COMMENT ENDPOINTS
# =======================

@api_router.post("/posts/{post_id}/comments", response_model=Comment)
async def create_comment(
    post_id: str,
    comment_data: CommentCreate,
    authorization: Optional[str] = Header(None),
    request: Request = None
):
    """Add a comment to a post"""
    if request is not None:
        await ensure_request_ip_not_blacklisted(request)
    user = await get_current_user(authorization)
    ensure_not_banned(user)
    text = comment_data.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment text cannot be empty")

    client_ip = normalize_ip(get_client_ip(request))
    locale_hint = normalize_locale_hint((request.headers.get("accept-language") if request else None))
    moderation = await moderate_content(text, locale_hint=locale_hint, client_ip=client_ip)
    if moderation.action == "block":
        if db is not None:
            offense_count = await mongo_add_moderation_offense(user["user_id"], moderation.score, moderation.reason or "blocked comment", client_ip)
        else:
            offense_count = sqlite_add_moderation_offense(user["user_id"], moderation.score, moderation.reason or "blocked comment", client_ip)
        action, banned_until = penalty_for_offense(offense_count)
        if action == "suspend":
            if db is not None:
                await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"banned_until": banned_until}})
            else:
                sqlite_set_user_ban(user["user_id"], banned_until)
            raise HTTPException(status_code=403, detail="Content blocked and user suspended")
        if db is not None:
            await mongo_soft_delete_user(user["user_id"])
        else:
            sqlite_soft_delete_user(user["user_id"], client_ip=client_ip)
        raise HTTPException(status_code=403, detail="Content blocked and user removed")

    if db is not None:
        # Check if post exists
        post = await db.posts.find_one({"post_id": post_id})
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        
        comment_id = f"comment_{uuid.uuid4().hex[:12]}"
        
        comment = {
            "comment_id": comment_id,
            "post_id": post_id,
            "user_id": user["user_id"],
            "username": user["username"],
            "profile_picture": user.get("profile_picture"),
            "text": text,
            "created_at": datetime.now(timezone.utc)
        }
        
        await db.comments.insert_one(comment)
        
        # Increment post comments count
        await db.posts.update_one(
            {"post_id": post_id},
            {"$inc": {"comments_count": 1}}
        )
        if moderation.queue:
            await db.moderation_queue.insert_one({
                "moderation_id": f"mod_{uuid.uuid4().hex[:12]}",
                "target_type": "comment",
                "target_id": comment_id,
                "user_id": user["user_id"],
                "score": moderation.score,
                "status": "queued",
                "reason": moderation.reason or "needs-review",
                "created_at": utc_now(),
                "text": text,
            })
        if post["user_id"] != user["user_id"]:
            await db.notifications.insert_one({
                "notification_id": f"notif_{uuid.uuid4().hex[:12]}",
                "user_id": post["user_id"],
                "actor_user_id": user["user_id"],
                "actor_username": user["username"],
                "actor_profile_picture": user.get("profile_picture"),
                "type": "post_comment",
                "post_id": post_id,
                "comment_id": comment_id,
                "created_at": datetime.now(timezone.utc),
                "is_read": False,
            })
        
        comment.pop("_id", None)
        return Comment(**comment)
    else:
        post = get_sqlite_post(post_id)
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        comment = create_sqlite_comment(post_id, user, text)
        if moderation.queue:
            sqlite_queue_moderation_item({
                "moderation_id": f"mod_{uuid.uuid4().hex[:12]}",
                "target_type": "comment",
                "target_id": comment["comment_id"],
                "user_id": user["user_id"],
                "score": moderation.score,
                "status": "queued",
                "reason": moderation.reason or "needs-review",
                "created_at": utc_iso_now(),
                "text": text,
            })
        if post["user_id"] != user["user_id"]:
            create_sqlite_notification(
                user_id=post["user_id"],
                actor=user,
                notification_type="post_comment",
                post_id=post_id,
                comment_id=comment["comment_id"],
            )
        return Comment(**comment)

@api_router.get("/posts/{post_id}/comments", response_model=List[Comment])
async def get_comments(
    post_id: str,
    authorization: Optional[str] = Header(None)
):
    """Get all comments for a post"""
    await get_current_user(authorization)
    if db is not None:
        comments = await db.comments.find(
            {"post_id": post_id},
            {"_id": 0}
        ).sort("created_at", 1).to_list(length=None)
    else:
        comments = get_sqlite_comments(post_id)
    return [Comment(**comment) for comment in comments]


@api_router.put("/posts/{post_id}/comments/{comment_id}", response_model=Comment)
async def update_comment(
    post_id: str,
    comment_id: str,
    comment_data: CommentCreate,
    authorization: Optional[str] = Header(None)
):
    """Update one comment by its author"""
    user = await get_current_user(authorization)
    text = comment_data.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment text cannot be empty")

    if db is not None:
        comment = await db.comments.find_one({"comment_id": comment_id, "post_id": post_id})
        if not comment:
            raise HTTPException(status_code=404, detail="Comment not found")
        if comment["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Not allowed to edit this comment")

        await db.comments.update_one(
            {"comment_id": comment_id, "post_id": post_id},
            {"$set": {"text": text}}
        )
        updated = await db.comments.find_one({"comment_id": comment_id, "post_id": post_id}, {"_id": 0})
        return Comment(**updated)
    else:
        comment = get_sqlite_comment_by_id(comment_id)
        if not comment or comment["post_id"] != post_id:
            raise HTTPException(status_code=404, detail="Comment not found")
        if comment["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Not allowed to edit this comment")
        updated = update_sqlite_comment(comment_id, text)
        if not updated:
            raise HTTPException(status_code=404, detail="Comment not found")
        return Comment(**updated)


@api_router.delete("/posts/{post_id}/comments/{comment_id}")
async def delete_comment(
    post_id: str,
    comment_id: str,
    authorization: Optional[str] = Header(None)
):
    """Delete one comment by its author"""
    user = await get_current_user(authorization)

    if db is not None:
        comment = await db.comments.find_one({"comment_id": comment_id, "post_id": post_id})
        if not comment:
            raise HTTPException(status_code=404, detail="Comment not found")
        if comment["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Not allowed to delete this comment")

        await db.comments.delete_one({"comment_id": comment_id, "post_id": post_id})
        await db.posts.update_one(
            {"post_id": post_id},
            {"$inc": {"comments_count": -1}}
        )
        await db.posts.update_one(
            {"post_id": post_id, "comments_count": {"$lt": 0}},
            {"$set": {"comments_count": 0}}
        )
        return {"message": "Comment deleted"}
    else:
        comment = get_sqlite_comment_by_id(comment_id)
        if not comment or comment["post_id"] != post_id:
            raise HTTPException(status_code=404, detail="Comment not found")
        if comment["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Not allowed to delete this comment")
        deleted = delete_sqlite_comment(comment_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Comment not found")
        return {"message": "Comment deleted"}

# =======================
# FOLLOW ENDPOINTS
# =======================

@api_router.post("/users/{target_user_id}/follow")
async def follow_user(
    target_user_id: str,
    authorization: Optional[str] = Header(None)
):
    """Toggle follow/unfollow for a user"""
    user = await get_current_user(authorization)
    
    if user["user_id"] == target_user_id:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    
    if db is not None:
        # Check if target user exists
        target_user = await db.users.find_one({"user_id": target_user_id})
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
        
        existing_follow = await db.follows.find_one({
            "follower_id": user["user_id"],
            "following_id": target_user_id
        })
        
        if existing_follow:
            await db.follows.delete_one({
                "follower_id": user["user_id"],
                "following_id": target_user_id
            })
            await db.users.update_one(
                {"user_id": user["user_id"]},
                {"$inc": {"following_count": -1}}
            )
            await db.users.update_one(
                {"user_id": target_user_id},
                {"$inc": {"followers_count": -1}}
            )
            await db.users.update_one(
                {"user_id": user["user_id"], "following_count": {"$lt": 0}},
                {"$set": {"following_count": 0}}
            )
            await db.users.update_one(
                {"user_id": target_user_id, "followers_count": {"$lt": 0}},
                {"$set": {"followers_count": 0}}
            )
            is_following = False
        else:
            follow = {
                "follow_id": f"follow_{uuid.uuid4().hex[:12]}",
                "follower_id": user["user_id"],
                "following_id": target_user_id,
                "created_at": datetime.now(timezone.utc)
            }
            await db.follows.insert_one(follow)
            await db.users.update_one(
                {"user_id": user["user_id"]},
                {"$inc": {"following_count": 1}}
            )
            await db.users.update_one(
                {"user_id": target_user_id},
                {"$inc": {"followers_count": 1}}
            )
            is_following = True
            await db.notifications.insert_one({
                "notification_id": f"notif_{uuid.uuid4().hex[:12]}",
                "user_id": target_user_id,
                "actor_user_id": user["user_id"],
                "actor_username": user["username"],
                "actor_profile_picture": user.get("profile_picture"),
                "type": "user_follow",
                "post_id": None,
                "comment_id": None,
                "created_at": datetime.now(timezone.utc),
                "is_read": False,
            })
    else:
        target_user = get_sqlite_user_by_id(target_user_id)
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
        is_following = sqlite_toggle_follow(user["user_id"], target_user_id)
        if is_following:
            create_sqlite_notification(
                user_id=target_user_id,
                actor=user,
                notification_type="user_follow",
            )

    me = await get_user_with_fresh_counts(user["user_id"])
    target = await get_user_with_fresh_counts(target_user_id)
    return {
        "message": "Follow toggled",
        "is_following": is_following,
        "my_following_count": (me or {}).get("following_count", 0),
        "target_followers_count": (target or {}).get("followers_count", 0),
    }

@api_router.delete("/users/{target_user_id}/follow")
async def unfollow_user(
    target_user_id: str,
    authorization: Optional[str] = Header(None)
):
    """Unfollow a user"""
    user = await get_current_user(authorization)
    
    # Delete follow
    result = await db.follows.delete_one({
        "follower_id": user["user_id"],
        "following_id": target_user_id
    })
    
    if result.deleted_count == 0:
        return {"message": "Not following"}
    
    # Decrement counts
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$inc": {"following_count": -1}}
    )
    
    await db.users.update_one(
        {"user_id": target_user_id},
        {"$inc": {"followers_count": -1}}
    )
    
    return {"message": "User unfollowed"}

@api_router.get("/users/{user_id}/is-following")
async def check_following(
    user_id: str,
    authorization: Optional[str] = Header(None)
):
    """Check if current user is following target user"""
    current_user = await get_current_user(authorization)
    if db is not None:
        follow = await db.follows.find_one({
            "follower_id": current_user["user_id"],
            "following_id": user_id
        })
        return {"is_following": follow is not None}
    return {"is_following": sqlite_follow_exists(current_user["user_id"], user_id)}


# =======================
# TRUST & SAFETY ENDPOINTS
# =======================

@api_router.post("/users/{target_user_id}/block")
async def toggle_block_user(
    target_user_id: str,
    authorization: Optional[str] = Header(None)
):
    user = await get_current_user(authorization)
    if user["user_id"] == target_user_id:
        raise HTTPException(status_code=400, detail="Cannot block yourself")

    if db is not None:
        target = await db.users.find_one({"user_id": target_user_id})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        existing = await db.blocks.find_one({"user_id": user["user_id"], "target_user_id": target_user_id})
        if existing:
            await db.blocks.delete_one({"user_id": user["user_id"], "target_user_id": target_user_id})
            is_blocked = False
        else:
            await db.blocks.insert_one({
                "id": f"block_{uuid.uuid4().hex[:12]}",
                "user_id": user["user_id"],
                "target_user_id": target_user_id,
                "created_at": datetime.now(timezone.utc),
            })
            is_blocked = True
    else:
        target = get_sqlite_user_by_id(target_user_id)
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        is_blocked = sqlite_toggle_relation("blocks", user["user_id"], target_user_id)
    return {"is_blocked": is_blocked}


@api_router.post("/users/{target_user_id}/mute")
async def toggle_mute_user(
    target_user_id: str,
    authorization: Optional[str] = Header(None)
):
    user = await get_current_user(authorization)
    if user["user_id"] == target_user_id:
        raise HTTPException(status_code=400, detail="Cannot mute yourself")

    if db is not None:
        target = await db.users.find_one({"user_id": target_user_id})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        existing = await db.mutes.find_one({"user_id": user["user_id"], "target_user_id": target_user_id})
        if existing:
            await db.mutes.delete_one({"user_id": user["user_id"], "target_user_id": target_user_id})
            is_muted = False
        else:
            await db.mutes.insert_one({
                "id": f"mute_{uuid.uuid4().hex[:12]}",
                "user_id": user["user_id"],
                "target_user_id": target_user_id,
                "created_at": datetime.now(timezone.utc),
            })
            is_muted = True
    else:
        target = get_sqlite_user_by_id(target_user_id)
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        is_muted = sqlite_toggle_relation("mutes", user["user_id"], target_user_id)
    return {"is_muted": is_muted}


@api_router.post("/reports")
async def create_report(
    report_data: ReportCreate,
    authorization: Optional[str] = Header(None)
):
    user = await get_current_user(authorization)
    if report_data.target_type not in {"post", "comment", "user"}:
        raise HTTPException(status_code=400, detail="Invalid target_type")

    report_doc = {
        "report_id": f"report_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "target_type": report_data.target_type,
        "target_id": report_data.target_id,
        "reason": report_data.reason.strip(),
        "details": (report_data.details or "").strip() or None,
        "status": "open",
        "created_at": datetime.now(timezone.utc),
    }

    if db is not None:
        await db.reports.insert_one(report_doc)
    else:
        with get_sqlite_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO reports (report_id, user_id, target_type, target_id, reason, details, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    report_doc["report_id"],
                    report_doc["user_id"],
                    report_doc["target_type"],
                    report_doc["target_id"],
                    report_doc["reason"],
                    report_doc["details"],
                    report_doc["status"],
                    report_doc["created_at"].isoformat(),
                ),
            )
            conn.commit()
    return {"message": "Report submitted"}


@api_router.get("/users/me/blocked", response_model=List[UserMini])
async def get_blocked_users(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if db is not None:
        rows = await db.blocks.find({"user_id": user["user_id"]}, {"_id": 0, "target_user_id": 1}).to_list(length=None)
        ids = [r["target_user_id"] for r in rows]
        if not ids:
            return []
        users = await db.users.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "username": 1, "profile_picture": 1}).to_list(length=None)
        by_id = {u["user_id"]: u for u in users}
        ordered = [by_id[i] for i in ids if i in by_id]
        return [UserMini(**u) for u in ordered]
    ids = sqlite_related_user_ids("blocks", user["user_id"])
    return [
        UserMini(
            user_id=u["user_id"],
            username=u["username"],
            profile_picture=u.get("profile_picture"),
        )
        for u in (get_sqlite_user_by_id(i) for i in ids)
        if u
    ]


@api_router.get("/users/me/muted", response_model=List[UserMini])
async def get_muted_users(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if db is not None:
        rows = await db.mutes.find({"user_id": user["user_id"]}, {"_id": 0, "target_user_id": 1}).to_list(length=None)
        ids = [r["target_user_id"] for r in rows]
        if not ids:
            return []
        users = await db.users.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "username": 1, "profile_picture": 1}).to_list(length=None)
        by_id = {u["user_id"]: u for u in users}
        ordered = [by_id[i] for i in ids if i in by_id]
        return [UserMini(**u) for u in ordered]
    ids = sqlite_related_user_ids("mutes", user["user_id"])
    return [
        UserMini(
            user_id=u["user_id"],
            username=u["username"],
            profile_picture=u.get("profile_picture"),
        )
        for u in (get_sqlite_user_by_id(i) for i in ids)
        if u
    ]


@api_router.get("/admin/system-settings")
async def get_system_settings(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        return {
            "roles": list(ALLOWED_ROLES),
            "moderation_queue_count": await db.moderation_queue.count_documents({}),
        }
    return {
        "roles": list(ALLOWED_ROLES),
        "moderation_queue_count": len(sqlite_get_moderation_queue()),
    }


@api_router.get("/admin/finance")
async def get_finance_data(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        campaigns = await db.ad_campaigns.find({}, {"_id": 0, "budget": 1, "currency": 1}).to_list(length=None)
        rates = {
            "EUR": 1.0,
            "USD": 0.92,
            "GBP": 1.17,
            "SEK": 0.089,
            "NOK": 0.086,
            "BTC": 61000.0,
            "CAD": 0.68,
            "AUD": 0.61,
            "CHF": 1.04,
            "JPY": 0.0062,
        }
        ad_total_eur = 0.0
        for campaign in campaigns:
            currency = str(campaign.get("currency") or "EUR").upper()
            ad_total_eur += float(campaign.get("budget") or 0) * rates.get(currency, 1.0)
        return {
            "users_count": await db.users.count_documents({}),
            "posts_count": await db.posts.count_documents({}),
            "moderation_queue_count": await db.moderation_queue.count_documents({}),
            "ad_revenue_eur": round(ad_total_eur, 2),
            "exchange_rates": rates,
        }
    return sqlite_get_finance_snapshot()


@api_router.get("/admin/exchange-rates")
async def get_exchange_rates(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        doc = await db.exchange_rates.find_one({"rates_id": "default"}, {"_id": 0})
        if doc and isinstance(doc.get("value"), dict):
            return {
                "rates": doc["value"],
                "updated_at": doc.get("updated_at").isoformat() if hasattr(doc.get("updated_at"), "isoformat") else doc.get("updated_at"),
            }
        return {
            "rates": {
                "EUR": 1.0,
                "USD": 0.92,
                "GBP": 1.17,
                "SEK": 0.089,
                "NOK": 0.086,
                "BTC": 61000.0,
                "CAD": 0.68,
                "AUD": 0.61,
                "CHF": 1.04,
                "JPY": 0.0062,
            },
            "updated_at": None,
        }
    return sqlite_get_exchange_rates_payload()


@api_router.put("/admin/exchange-rates")
async def update_exchange_rates(payload: ExchangeRateUpdate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    rates = {item.currency.upper(): float(item.rate_to_eur) for item in payload.rates}
    rates["EUR"] = 1.0
    if db is not None:
        await db.exchange_rates.update_one(
            {"rates_id": "default"},
            {"$set": {"rates_id": "default", "value": rates, "updated_at": utc_now()}},
            upsert=True,
        )
        return rates
    return sqlite_update_exchange_rates(rates)


@api_router.post("/admin/exchange-rates/refresh")
async def refresh_exchange_rates(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    return await refresh_exchange_rates_from_provider()


@api_router.get("/admin/moderation-queue")
async def get_moderation_queue(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        queue = await db.moderation_queue.find({}, {"_id": 0}).sort("created_at", -1).to_list(length=100)
        return queue
    repo_queue = repository_get_moderation_queue()
    if repo_queue is not None:
        return repo_queue
    return sqlite_get_moderation_queue()


@api_router.put("/admin/users/{target_user_id}/role")
async def update_user_role(
    target_user_id: str,
    role_update: RoleUpdate,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    role = normalize_role(role_update.role)
    if role == "Super Admin" and not SUPER_ADMIN_EMAIL:
        raise HTTPException(status_code=400, detail="SUPER_ADMIN_EMAIL is not configured")
    if db is not None:
        existing = await db.users.find_one({"user_id": target_user_id})
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one({"user_id": target_user_id}, {"$set": {"role": role}})
    else:
        existing = get_sqlite_user_by_id(target_user_id)
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")
        sqlite_update_user_role(target_user_id, role)
    return {"message": "Role updated", "role": role}


@api_router.delete("/admin/users/{target_user_id}")
async def delete_user_admin(
    target_user_id: str,
    authorization: Optional[str] = Header(None),
    request: Request = None,
):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        existing = await db.users.find_one({"user_id": target_user_id})
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")
        await mongo_soft_delete_user(target_user_id, client_ip=normalize_ip(get_client_ip(request)))
    else:
        existing = get_sqlite_user_by_id(target_user_id)
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")
        sqlite_soft_delete_user(target_user_id, client_ip=normalize_ip(get_client_ip(request)))
    return {"message": "User removed", "user_id": target_user_id, "mode": "nuke"}


@api_router.get("/admin/ads/settings")
async def get_ad_settings(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        doc = await db.ad_settings.find_one({"settings_id": "default"}, {"_id": 0})
        if not doc:
            return AdPlacementSettings().model_dump()
        return doc.get("value", AdPlacementSettings().model_dump())
    return sqlite_get_ad_settings()


@api_router.put("/admin/ads/settings")
async def update_ad_settings(payload: AdPlacementSettings, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    value = payload.model_dump()
    if db is not None:
        await db.ad_settings.update_one(
            {"settings_id": "default"},
            {"$set": {"settings_id": "default", "value": value, "updated_at": utc_now()}},
            upsert=True,
        )
        return value
    return sqlite_update_ad_settings(value)


@api_router.get("/admin/moderation/settings")
async def get_moderation_settings(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        doc = await db.moderation_settings.find_one({"settings_id": "default"}, {"_id": 0})
        if not doc:
            return {"sensitivity": MODERATION_SENSITIVITY}
        value = doc.get("value") or {}
        return {"sensitivity": max(0, min(100, int(value.get("sensitivity", MODERATION_SENSITIVITY))))}
    return sqlite_get_moderation_settings()


@api_router.put("/admin/moderation/settings")
async def update_moderation_settings(payload: ModerationSettings, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    sensitivity = max(0, min(100, int(payload.sensitivity)))
    global MODERATION_SENSITIVITY
    MODERATION_SENSITIVITY = sensitivity
    if db is not None:
        await db.moderation_settings.update_one(
            {"settings_id": "default"},
            {"$set": {"settings_id": "default", "value": {"sensitivity": sensitivity}, "updated_at": utc_now()}},
            upsert=True,
        )
        return {"sensitivity": sensitivity}
    return sqlite_update_moderation_settings({"sensitivity": sensitivity})


@api_router.get("/admin/ads/campaigns")
async def list_ad_campaigns(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        rows = await db.ad_campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(length=100)
        return rows
    return sqlite_list_ad_campaigns()


@api_router.post("/admin/ads/campaigns")
async def create_ad_campaign(payload: AdCampaignCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    campaign = {
        "campaign_id": f"camp_{uuid.uuid4().hex[:12]}",
        "name": payload.name,
        "asset_url": payload.asset_url,
        "asset_type": payload.asset_type,
        "currency": (payload.currency or "EUR").upper(),
        "targeting": payload.targeting or {},
        "budget": payload.budget,
        "start_at": payload.start_at,
        "end_at": payload.end_at,
        "impressions_goal": payload.impressions_goal,
        "clicks_goal": payload.clicks_goal,
        "placements": payload.placements,
        "created_at": utc_iso_now(),
        "status": "active",
    }
    if db is not None:
        await db.ad_campaigns.insert_one(campaign)
        return campaign
    return sqlite_create_ad_campaign(campaign)


@api_router.post("/admin/notifications/broadcast")
async def broadcast_notification(payload: Dict[str, Any], authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    message = str(payload.get("message", "")).strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    if db is not None:
        cursor = await db.users.find({}, {"_id": 0, "user_id": 1}).to_list(length=None)
        for row in cursor:
            await db.notifications.insert_one({
                "notification_id": f"notif_{uuid.uuid4().hex[:12]}",
                "user_id": row["user_id"],
                "actor_user_id": "system",
                "actor_username": "Admin",
                "actor_profile_picture": None,
                "type": "system_broadcast",
                "post_id": None,
                "comment_id": None,
                "created_at": utc_now(),
                "is_read": False,
            })
        return {"message": "Broadcast sent", "recipient_count": len(cursor)}
    count = sqlite_push_broadcast(message)
    return {"message": "Broadcast sent", "recipient_count": count}


@api_router.get("/admin/logs")
async def get_system_logs(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    return SYSTEM_LOGS[-100:]


@api_router.get("/ads/config")
async def get_public_ad_config():
    if db is not None:
        doc = await db.ad_settings.find_one({"settings_id": "default"}, {"_id": 0})
        if not doc:
            return sqlite_get_public_ad_config()
        settings = doc.get("value", {})
        return {
            "placements": {
                "in_feed": bool(settings.get("in_feed_enabled", False)),
                "sidebar": bool(settings.get("sidebar_enabled", False)),
                "interstitial": bool(settings.get("interstitial_enabled", False)),
            },
            "frequency": max(1, int(settings.get("in_feed_frequency", 5))),
            "network_enabled": bool(settings.get("ad_network_enabled", False)),
            "network_tag": settings.get("ad_network_tag") or "",
        }
    return sqlite_get_public_ad_config()


@api_router.get("/notifications", response_model=List[NotificationItem])
async def get_notifications(
    limit: int = 30,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    safe_limit = max(1, min(limit, 100))
    if db is not None:
        notifications = await db.notifications.find(
            {"user_id": user["user_id"]},
            {"_id": 0},
        ).sort("created_at", -1).limit(safe_limit).to_list(length=safe_limit)
        return [NotificationItem(**n) for n in notifications]
    notifications = get_sqlite_notifications(user["user_id"], limit=safe_limit)
    return [NotificationItem(**n) for n in notifications]


@api_router.get("/notifications/unread-count")
async def get_notifications_unread_count(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if db is not None:
        count = await db.notifications.count_documents({
            "user_id": user["user_id"],
            "is_read": {"$ne": True},
        })
        return {"unread_count": int(count)}
    return {"unread_count": get_sqlite_unread_notifications_count(user["user_id"])}


@api_router.post("/analytics/dwell")
async def record_dwell_event(payload: DwellEvent, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_not_banned(user)
    if db is not None:
        await db.dwell_events.insert_one({
            "dwell_id": f"dwell_{uuid.uuid4().hex[:12]}",
            "user_id": user["user_id"],
            "post_id": payload.post_id,
            "dwell_ms": payload.normalized_dwell_ms(),
            "created_at": utc_now(),
        })
    else:
        sqlite_store_dwell_event(user["user_id"], payload.post_id, payload.normalized_dwell_ms())
    return {"message": "Dwell recorded"}


@api_router.post("/interactions/track")
async def track_interaction(payload: DwellEvent, authorization: Optional[str] = Header(None)):
    """Record a dwell-time interaction for feed ranking and interest tracking."""
    return await record_dwell_event(payload, authorization)


@api_router.post("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    if db is not None:
        result = await db.notifications.update_one(
            {"notification_id": notification_id, "user_id": user["user_id"]},
            {"$set": {"is_read": True}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Notification not found")
        return {"message": "Notification marked as read"}

    ok = mark_sqlite_notification_read(user["user_id"], notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "Notification marked as read"}


@api_router.post("/notifications/read-all")
async def mark_all_notifications_read(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if db is not None:
        result = await db.notifications.update_many(
            {"user_id": user["user_id"], "is_read": {"$ne": True}},
            {"$set": {"is_read": True}},
        )
        return {"message": "Notifications marked as read", "updated": int(result.modified_count)}

    updated = mark_all_sqlite_notifications_read(user["user_id"])
    return {"message": "Notifications marked as read", "updated": int(updated)}

# =======================
# DATABASE INDEXES
# =======================

async def create_indexes():
    """Create database indexes"""
    if db is None:
        logger.info("MongoDB is not configured; skipping MongoDB index creation.")
    else:
        try:
            # Users indexes
            await db.users.create_index("email", unique=True)
            await db.users.create_index("user_id", unique=True)
            await db.users.create_index("username", unique=True)
            
            # Sessions indexes
            await db.user_sessions.create_index("session_token", unique=True)
            await db.user_sessions.create_index("user_id")
            await db.user_sessions.create_index(
                "expires_at",
                expireAfterSeconds=0
            )
            
            # Posts indexes
            await db.posts.create_index("post_id", unique=True)
            await db.posts.create_index([("created_at", -1)])
            await db.posts.create_index("user_id")
            
            # Likes indexes
            await db.likes.create_index(
                [("post_id", 1), ("user_id", 1)],
                unique=True
            )
            
            # Comments indexes
            await db.comments.create_index("comment_id", unique=True)
            await db.comments.create_index("post_id")
            
            # Follows indexes
            await db.follows.create_index(
                [("follower_id", 1), ("following_id", 1)],
                unique=True
            )
            # Trust & safety indexes
            await db.blocks.create_index([("user_id", 1), ("target_user_id", 1)], unique=True)
            await db.mutes.create_index([("user_id", 1), ("target_user_id", 1)], unique=True)
            await db.reports.create_index("report_id", unique=True)
            await db.reports.create_index([("target_type", 1), ("target_id", 1)])
            await db.notifications.create_index("notification_id", unique=True)
            await db.notifications.create_index([("user_id", 1), ("created_at", -1)])

            for account in DEMO_ACCOUNTS:
                existing_demo = await db.users.find_one({"email": account["email"]})
                if not existing_demo:
                    user_id = f"user_{uuid.uuid4().hex[:12]}"
                    await db.users.insert_one({
                        "user_id": user_id,
                        "email": account["email"],
                        "password_hash": hash_password(account["password"]),
                        "username": account["username"],
                        "profile_picture": None,
                        "bio": None,
                        "followers_count": 0,
                        "following_count": 0,
                        "posts_count": 0,
                        "created_at": utc_now(),
                        "role": account["role"],
                        "banned_until": None,
                    })
                    logger.info("Inserted default Mongo demo user: %s / %s", account["email"], account["password"])
            
            logger.info("Database indexes created successfully")
        except Exception as e:
            logger.error(f"Error creating indexes: {str(e)}")

    # If a SQLite DATABASE_PATH is provided, ensure a default test user exists
    db_path = os.environ.get('DATABASE_PATH')
    if db_path:
        async def ensure_sqlite_test_user():
            try:
                def _ensure():
                    conn = sqlite3.connect(db_path)
                    cur = conn.cursor()
                    # Create users table if it doesn't exist
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS users (
                        user_id TEXT PRIMARY KEY,
                        email TEXT UNIQUE,
                        password_hash TEXT,
                        username TEXT UNIQUE,
                        profile_picture TEXT,
                        bio TEXT,
                        followers_count INTEGER DEFAULT 0,
                        following_count INTEGER DEFAULT 0,
                        posts_count INTEGER DEFAULT 0,
                        created_at TEXT,
                        role TEXT DEFAULT 'User',
                        banned_until TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS posts (
                        post_id TEXT PRIMARY KEY,
                        user_id TEXT,
                        username TEXT,
                        profile_picture TEXT,
                        text TEXT,
                        image TEXT,
                        likes_count INTEGER DEFAULT 0,
                        comments_count INTEGER DEFAULT 0,
                        created_at TEXT,
                        keywords TEXT DEFAULT '[]'
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS likes (
                        like_id TEXT PRIMARY KEY,
                        post_id TEXT,
                        user_id TEXT,
                        created_at TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS comments (
                        comment_id TEXT PRIMARY KEY,
                        post_id TEXT,
                        user_id TEXT,
                        username TEXT,
                        profile_picture TEXT,
                        text TEXT,
                        created_at TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS follows (
                        follower_id TEXT,
                        following_id TEXT,
                        created_at TEXT,
                        PRIMARY KEY (follower_id, following_id)
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS blocks (
                        id TEXT PRIMARY KEY,
                        user_id TEXT,
                        target_user_id TEXT,
                        created_at TEXT,
                        UNIQUE(user_id, target_user_id)
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS mutes (
                        id TEXT PRIMARY KEY,
                        user_id TEXT,
                        target_user_id TEXT,
                        created_at TEXT,
                        UNIQUE(user_id, target_user_id)
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS reports (
                        report_id TEXT PRIMARY KEY,
                        user_id TEXT,
                        target_type TEXT,
                        target_id TEXT,
                        reason TEXT,
                        details TEXT,
                        status TEXT,
                        created_at TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS moderation_queue (
                        moderation_id TEXT PRIMARY KEY,
                        target_type TEXT,
                        target_id TEXT,
                        user_id TEXT,
                        score INTEGER,
                        status TEXT,
                        reason TEXT,
                        created_at TEXT,
                        text TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS moderation_offenses (
                        offense_id TEXT PRIMARY KEY,
                        user_id TEXT,
                        score INTEGER,
                        reason TEXT,
                        ip_address TEXT,
                        created_at TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS blacklist (
                        blacklist_id TEXT PRIMARY KEY,
                        value TEXT,
                        value_type TEXT,
                        created_at TEXT,
                        UNIQUE(value, value_type)
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS ad_settings (
                        setting_key TEXT PRIMARY KEY,
                        setting_value TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS exchange_rates (
                        currency TEXT PRIMARY KEY,
                        rate_to_eur REAL,
                        updated_at TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS moderation_settings (
                        setting_key TEXT PRIMARY KEY,
                        setting_value TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS ad_campaigns (
                        campaign_id TEXT PRIMARY KEY,
                        name TEXT,
                        asset_url TEXT,
                        asset_type TEXT,
                        currency TEXT DEFAULT 'EUR',
                        targeting TEXT,
                        budget REAL,
                        start_at TEXT,
                        end_at TEXT,
                        impressions_goal INTEGER,
                        clicks_goal INTEGER,
                        placements TEXT,
                        created_at TEXT,
                        status TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS dwell_events (
                        dwell_id TEXT PRIMARY KEY,
                        user_id TEXT,
                        post_id TEXT,
                        dwell_ms INTEGER,
                        created_at TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS UserInteractions (
                        interaction_id TEXT PRIMARY KEY,
                        user_id TEXT,
                        post_id TEXT,
                        dwell_time_ms INTEGER,
                        interaction_type TEXT,
                        keywords TEXT DEFAULT '[]',
                        created_at TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS UserInterests (
                        user_id TEXT,
                        keyword TEXT,
                        weight REAL DEFAULT 0,
                        updated_at TEXT,
                        PRIMARY KEY (user_id, keyword)
                    )
                    ''')
                    try:
                        cur.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'User'")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE users ADD COLUMN banned_until TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE ad_campaigns ADD COLUMN currency TEXT DEFAULT 'EUR'")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE moderation_offenses ADD COLUMN ip_address TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE posts ADD COLUMN keywords TEXT DEFAULT '[]'")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE UserInteractions ADD COLUMN keywords TEXT DEFAULT '[]'")
                    except Exception:
                        pass
                    for key, value in {
                        "in_feed_enabled": "0",
                        "in_feed_frequency": "5",
                        "sidebar_enabled": "0",
                        "interstitial_enabled": "0",
                        "ad_network_enabled": "0",
                        "ad_network_tag": "",
                    }.items():
                        cur.execute(
                            "INSERT OR IGNORE INTO ad_settings (setting_key, setting_value) VALUES (?, ?)",
                            (key, value),
                        )
                    cur.execute(
                        "INSERT OR IGNORE INTO moderation_settings (setting_key, setting_value) VALUES (?, ?)",
                        ("sensitivity", "50"),
                    )
                    for currency, rate in {
                        "EUR": 1.0,
                        "USD": 0.92,
                        "GBP": 1.17,
                        "SEK": 0.089,
                        "NOK": 0.086,
                        "BTC": 61000.0,
                        "CAD": 0.68,
                        "AUD": 0.61,
                        "CHF": 1.04,
                        "JPY": 0.0062,
                    }.items():
                        cur.execute(
                            "INSERT OR IGNORE INTO exchange_rates (currency, rate_to_eur, updated_at) VALUES (?, ?, ?)",
                            (currency, rate, utc_iso_now()),
                        )
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS notifications (
                        notification_id TEXT PRIMARY KEY,
                        user_id TEXT,
                        actor_user_id TEXT,
                        actor_username TEXT,
                        actor_profile_picture TEXT,
                        type TEXT,
                        post_id TEXT,
                        comment_id TEXT,
                        created_at TEXT,
                        is_read INTEGER DEFAULT 0
                    )
                    ''')

                    # Check if test user exists
                    for account in DEMO_ACCOUNTS:
                        cur.execute("SELECT user_id FROM users WHERE email = ?", (account["email"],))
                        row = cur.fetchone()
                        if not row:
                            user_id = f"user_{uuid.uuid4().hex[:12]}"
                            hashed = hash_password(account["password"])
                            created_at = datetime.now(timezone.utc).isoformat()
                            cur.execute(
                                "INSERT INTO users (user_id, email, password_hash, username, created_at, role, banned_until) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                (user_id, account["email"], hashed, account["username"], created_at, account["role"], None)
                            )
                            conn.commit()
                            logger.info(
                                "Inserted default SQLite demo user: %s / %s",
                                account["email"],
                                account["password"],
                            )
                    conn.close()

                await asyncio.to_thread(_ensure)
            except Exception as e:
                logger.error(f"Error ensuring sqlite test user: {e}")

        # Schedule ensuring test user (don't block index creation)
        asyncio.create_task(ensure_sqlite_test_user())

    if EXCHANGE_RATES_API_URL:
        asyncio.create_task(exchange_rate_refresh_loop())

# Include the router in the main app
app.include_router(api_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
