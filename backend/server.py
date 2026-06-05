from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI, APIRouter, HTTPException, Header, Request, UploadFile, File, Form
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
import time
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
import random
from enum import Enum
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
import httpx
from jose import jwt
import secrets
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, JSONResponse
import sqlite3
import asyncio
import ipaddress
import io
import shutil
import subprocess
import tempfile

from PIL import Image, ImageOps

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception:  # pragma: no cover - optional HEIC support
    pillow_heif = None

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
ALLOWED_ROLES = {"super_admin", "moderator", "user"}
ROLE_LABELS = {
    "super_admin": "Super Admin",
    "moderator": "Moderator",
    "user": "User",
}
SUPER_ADMIN_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL")
MINIMUM_SIGNUP_AGE = 18
MODERATION_SENSITIVITY = 50
MODERATION_PROVIDER_URL = os.environ.get("MODERATION_PROVIDER_URL", "").strip()
MODERATION_PROVIDER_API_KEY = os.environ.get("MODERATION_PROVIDER_API_KEY", "").strip()
MODERATION_PROVIDER_MODEL = os.environ.get("MODERATION_PROVIDER_MODEL", "").strip() or "moderation"
MODERATION_PROVIDER_KIND = os.environ.get("MODERATION_PROVIDER_KIND", "").strip().lower() or "http"
GEOIP_LOCALE_PROVIDER_URL = os.environ.get("GEOIP_LOCALE_PROVIDER_URL", "").strip()
EXCHANGE_RATES_API_URL = os.environ.get("EXCHANGE_RATES_API_URL", "").strip()
EXCHANGE_RATES_REFRESH_SECONDS = max(3600, int(os.environ.get("EXCHANGE_RATES_REFRESH_SECONDS", "86400")))
REPOSITORY_ADAPTER = create_repository(get_storage_mode(), DATABASE_URL)
AD_CONFIG_FILE = Path(os.environ.get("AD_CONFIG_FILE", str(ROOT_DIR / "config" / "ad_config.json")))
PAYMENT_CONFIG_FILE = Path(os.environ.get("PAYMENT_CONFIG_FILE", str(ROOT_DIR / "config" / "payment_config.json")))
HOMEPAGE_CONFIG_FILE = Path(os.environ.get("HOMEPAGE_CONFIG_FILE", str(ROOT_DIR / "config" / "homepage_config.json")))

@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_indexes()
    cleanup_task = asyncio.create_task(message_presence_cleanup_loop())
    yield
    cleanup_task.cancel()
    with suppress(asyncio.CancelledError):
        await cleanup_task
    if client is not None:
        client.close()


# Create the main app
app = FastAPI(title="Social Media API", lifespan=lifespan)

# Ensure uploads directory exists and serve it
uploads_dir = ROOT_DIR / 'uploads'
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm"}
MAX_IMAGE_WIDTH = 1600
IMAGE_WEBP_QUALITY = 82


def _upload_extension(upload: UploadFile) -> str:
    return Path(upload.filename or "").suffix.lower()


def _validate_upload_extension(upload: UploadFile, allowed: set[str], media_label: str) -> str:
    ext = _upload_extension(upload)
    if ext not in allowed:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported {media_label} type. Allowed: {', '.join(sorted(allowed))}",
        )
    return ext


def optimize_image_upload(contents: bytes, upload: UploadFile, post_id: str) -> str:
    ext = _validate_upload_extension(upload, ALLOWED_IMAGE_EXTENSIONS, "image")
    if ext in {".heic", ".heif"} and pillow_heif is None:
        raise HTTPException(
            status_code=415,
            detail="HEIC image support requires pillow-heif on the backend.",
        )

    try:
        image = Image.open(io.BytesIO(contents))
        image = ImageOps.exif_transpose(image)
        image.thumbnail((MAX_IMAGE_WIDTH, MAX_IMAGE_WIDTH * 2), Image.Resampling.LANCZOS)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")

        filename = f"{post_id}.webp"
        out_path = uploads_dir / filename
        image.save(out_path, "WEBP", quality=IMAGE_WEBP_QUALITY, method=6)
        return f"/uploads/{filename}"
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error optimizing uploaded image: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to optimize uploaded image")


def transcode_video_upload(contents: bytes, upload: UploadFile, post_id: str) -> str:
    ext = _validate_upload_extension(upload, ALLOWED_VIDEO_EXTENSIONS, "video")
    ffmpeg_path = shutil.which("ffmpeg")

    if ffmpeg_path is None:
        if ext == ".mp4":
            filename = f"{post_id}.mp4"
            out_path = uploads_dir / filename
            with open(out_path, "wb") as file:
                file.write(contents)
            return f"/uploads/{filename}"
        raise HTTPException(
            status_code=500,
            detail="Video transcoding requires ffmpeg on the backend.",
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = Path(tmpdir) / f"input{ext}"
        output_path = Path(tmpdir) / "output.mp4"
        input_path.write_bytes(contents)
        command = [
            ffmpeg_path,
            "-y",
            "-i",
            str(input_path),
            "-map_metadata",
            "-1",
            "-vf",
            "scale='min(1280,iw)':-2",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
        result = subprocess.run(command, capture_output=True, text=True, timeout=180)
        if result.returncode != 0 or not output_path.exists():
            logger.error("ffmpeg failed for %s: %s", upload.filename, result.stderr[-1000:])
            raise HTTPException(status_code=500, detail="Failed to transcode uploaded video")

        filename = f"{post_id}.mp4"
        out_path = uploads_dir / filename
        shutil.move(str(output_path), out_path)
        return f"/uploads/{filename}"

RATE_LIMIT_BUCKETS: Dict[str, Dict[str, Any]] = {}
RATE_LIMITS = {
    "global": {"capacity": 120, "refill_per_sec": 2.0},
    "auth": {"capacity": 20, "refill_per_sec": 0.2},
    "write": {"capacity": 30, "refill_per_sec": 0.5},
    "admin": {"capacity": 40, "refill_per_sec": 0.4},
}
RATE_LIMIT_PATH_GROUPS = {
    "/api/auth/": "auth",
    "/api/posts": "write",
    "/api/comments": "write",
    "/api/messages": "write",
    "/api/notifications": "write",
    "/api/admin/": "admin",
}


def rate_limit_key(request: Request) -> str:
    client_ip = normalize_ip(get_client_ip(request)) or "unknown"
    return f"{client_ip}:{request.url.path}"


def resolve_rate_limit_scope(path: str) -> str:
    for prefix, scope in RATE_LIMIT_PATH_GROUPS.items():
        if path.startswith(prefix):
            return scope
    return "global"


def check_rate_limit(request: Request) -> None:
    scope = resolve_rate_limit_scope(request.url.path)
    policy = RATE_LIMITS.get(scope, RATE_LIMITS["global"])
    key = f"{normalize_ip(get_client_ip(request)) or 'unknown'}:{scope}"
    now = time.monotonic()
    bucket = RATE_LIMIT_BUCKETS.get(key)
    if bucket is None:
        RATE_LIMIT_BUCKETS[key] = {"tokens": float(policy["capacity"]), "updated_at": now}
        return
    elapsed = max(0.0, now - float(bucket.get("updated_at", now)))
    bucket["tokens"] = min(float(policy["capacity"]), float(bucket.get("tokens", policy["capacity"])) + elapsed * float(policy["refill_per_sec"]))
    bucket["updated_at"] = now
    if bucket["tokens"] < 1.0:
        raise HTTPException(status_code=429, detail="Too many requests")
    bucket["tokens"] -= 1.0


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        try:
            check_rate_limit(request)
        except HTTPException as exc:
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    return await call_next(request)


def collect_upload_artifacts(post_rows: List[Dict[str, Any]]) -> List[Path]:
    """Return every local upload artifact we can safely associate with the given posts."""
    artifact_paths: List[Path] = []
    seen: set[str] = set()
    for row in post_rows:
        post_id = str(row.get("post_id") or "").strip()
        image_value = str(row.get("image") or "").strip()
        if image_value:
            candidate = uploads_dir / Path(image_value).name
            key = str(candidate)
            if key not in seen:
                seen.add(key)
                artifact_paths.append(candidate)
        if post_id:
            for candidate in uploads_dir.glob(f"{post_id}*"):
                key = str(candidate)
                if key in seen:
                    continue
                seen.add(key)
                artifact_paths.append(candidate)
    return artifact_paths


def delete_upload_artifacts(post_rows: List[Dict[str, Any]]) -> None:
    for artifact_path in collect_upload_artifacts(post_rows):
        try:
            if artifact_path.exists():
                artifact_path.unlink()
        except Exception:
            pass

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
SYSTEM_LOGS: List[Dict[str, Any]] = []
MESSAGE_CONVERSATIONS: Dict[str, List[Dict[str, Any]]] = {}
MESSAGE_TYPING_TTL_SECONDS = 18
USER_ONLINE_TTL_SECONDS = 120
DEMO_ACCOUNTS = [
    {"email": "test@test.com", "username": "testuser", "password": "password123", "role": "super_admin"},
    {"email": "demo_user_20260529@test.com", "username": "demo_user_20260529", "password": "password123", "role": "user"},
]

def push_system_log(level: str, message: str, component: str = "backend", details: Optional[str] = None) -> None:
    SYSTEM_LOGS.append({
        "log_id": f"log_{uuid.uuid4().hex[:12]}",
        "level": level,
        "component": component,
        "message": message,
        "details": details,
        "created_at": utc_iso_now(),
    })
    del SYSTEM_LOGS[:-200]

def push_audit_log(action: str, subject_id: str, actor_id: Optional[str] = None, details: Optional[str] = None) -> None:
    message = f"{action} target={subject_id}"
    if actor_id:
        message += f" actor={actor_id}"
    push_system_log("warning", message, component="audit", details=details)
    SYSTEM_LOGS[-1]["action"] = action
    SYSTEM_LOGS[-1]["subject_id"] = subject_id
    SYSTEM_LOGS[-1]["actor_id"] = actor_id

# =======================
# MODELS
# =======================

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    username: str
    date_of_birth: str
    accept_terms: bool = False
    accept_privacy: bool = False

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
    role: str = "user"
    banned_until: Optional[datetime] = None

class UserUpdate(BaseModel):
    username: Optional[str] = None
    profile_picture: Optional[str] = None
    bio: Optional[str] = None
    role: Optional[str] = None

class PostCreate(BaseModel):
    text: str
    image: Optional[str] = None
    video: Optional[str] = None
    repost_post_id: Optional[str] = None
    is_nsfw: bool = False

class Post(BaseModel):
    post_id: str
    user_id: str
    username: str
    profile_picture: Optional[str] = None
    is_online: bool = False
    text: str
    image: Optional[str] = None
    video: Optional[str] = None
    hashtags: List[str] = Field(default_factory=list)
    mentions: List[str] = Field(default_factory=list)
    repost_post_id: Optional[str] = None
    repost_count: int = 0
    likes_count: int = 0
    comments_count: int = 0
    is_liked: bool = False
    moderation_status: Optional[str] = None
    is_nsfw: bool = False
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
    is_online: bool = False
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
    reason_tags: List[str] = Field(default_factory=list)
    reason_custom: Optional[str] = None
    reviewed_reason: Optional[str] = None


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

class PaymentMethodKind(str, Enum):
    card = "card"
    wallet = "wallet"
    crypto = "crypto"

class PaymentSettings(BaseModel):
    card_enabled: bool = True
    wallet_enabled: bool = True
    crypto_enabled: bool = True
    card_provider: str = "visa-or-psp"
    wallet_provider: str = "internal-wallet"
    crypto_provider: str = "onchain"
    settlement_currency: str = "EUR"
    wallet_topup_enabled: bool = True
    supported_currencies: List[str] = Field(default_factory=lambda: ["EUR", "USD", "BTC"])

class PaymentSettingsUpdate(PaymentSettings):
    pass

class PaymentIntentCreate(BaseModel):
    user_id: Optional[str] = None
    purpose: str = "ad_campaign"
    reference_type: Optional[str] = None
    reference_id: Optional[str] = None
    payment_method: PaymentMethodKind = PaymentMethodKind.card
    amount: float = 0.0
    currency: str = "EUR"
    provider: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class PaymentIntentUpdate(BaseModel):
    status: str
    provider_reference: Optional[str] = None
    notes: Optional[str] = None

class WalletAdjustRequest(BaseModel):
    amount: float
    currency: str = "EUR"
    reason: Optional[str] = None

class HomepageSettings(BaseModel):
    title: str = "Tervetuloa YOSLA SOME LIFE"
    subtitle: str = "Suomalainen some, jossa voit julkaista, keskustella ja rakentaa verkoston yhdessä paikassa."
    badge: str = "Suomalainen some"
    hero_image_url: Optional[str] = None
    hero_image_alt: str = "YOSLA SOME LIFE"

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

class ExploreTopicItem(BaseModel):
    label: str
    count: int

class CreatorSuggestionItem(BaseModel):
    user_id: str
    username: str
    post_count: int

class MessageThreadItem(BaseModel):
    id: str
    title: str
    preview: str
    time: str
    unread_count: int = 0
    avatar_url: Optional[str] = None
    participant_user_id: Optional[str] = None
    last_sender_user_id: Optional[str] = None
    last_sender_username: Optional[str] = None
    direction: Optional[str] = None
    last_read_at: Optional[str] = None
    last_message_state: Optional[str] = None
    is_typing: bool = False
    is_online: bool = False

class MessageItem(BaseModel):
    id: str
    thread_id: str
    sender_user_id: str
    sender_username: str
    text: str
    created_at: str
    is_outgoing: bool = False
    delivered_at: Optional[str] = None
    read_at: Optional[str] = None

class MessageSendRequest(BaseModel):
    text: str
    recipient_user_id: Optional[str] = None

class CommunityItem(BaseModel):
    name: str
    members: int
    description: str
    is_member: bool = False

class ProjectItem(BaseModel):
    name: str
    status: str
    description: str

class NetworkMetricItem(BaseModel):
    label: str
    value: str

class SearchPostItem(BaseModel):
    post_id: str
    user_id: str
    username: str
    text: str
    image: Optional[str] = None
    likes_count: int = 0
    comments_count: int = 0
    created_at: datetime
    score: float = 0
    match_reason: Optional[str] = None
    score_breakdown: Optional[Dict[str, float]] = None

class SearchUserItem(BaseModel):
    user_id: str
    username: str
    bio: Optional[str] = None
    followers_count: int = 0
    posts_count: int = 0
    role: str = "user"
    score: float = 0
    match_reason: Optional[str] = None
    score_breakdown: Optional[Dict[str, float]] = None

class SearchResultResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "query": "design",
            "posts": [
                {
                    "post_id": "post_1",
                    "user_id": "user_1",
                    "username": "teamflow",
                    "text": "Looking for #design inspiration",
                    "image": None,
                    "likes_count": 5,
                    "comments_count": 2,
                    "created_at": "2026-06-03T12:00:00Z",
                }
            ],
            "users": [
                {
                    "user_id": "user_2",
                    "username": "designer",
                    "bio": "UI/UX",
                    "followers_count": 24,
                    "posts_count": 8,
                    "role": "User",
                }
            ],
            "hashtags": [{"label": "#design", "count": 12}],
            "communities": [{"name": "Design", "members": 120, "description": "Teemallinen yhteisö UI-ideoille ja palautteelle."}],
        }
    })

    query: str
    posts: List[SearchPostItem]
    users: List[SearchUserItem]
    hashtags: List[ExploreTopicItem]
    communities: List[CommunityItem]

class ExploreDirectoryResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "topics": [{"label": "#design", "count": 12}, {"label": "#build", "count": 8}],
            "creators": [
                {"user_id": "user_1", "username": "teamflow", "post_count": 4},
            ],
            "posts": [],
            "user": {"user_id": "user_1", "username": "teamflow", "is_new_user": False},
        }
    })

    topics: List[ExploreTopicItem]
    creators: List[CreatorSuggestionItem]
    posts: List[Dict[str, Any]]
    user: Dict[str, Any]

class MessagesDirectoryResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "threads": [
                {"id": "thread_1", "title": "@teamflow", "preview": "post like", "time": "2026-06-03T12:00:00Z"}
            ],
            "unread_count": 2,
        }
    })

    threads: List[MessageThreadItem]
    unread_count: int

class MessageThreadResponse(BaseModel):
    thread: MessageThreadItem
    messages: List[MessageItem]
    unread_count: int
    has_more: bool = False
    has_newer: bool = False
    next_before: Optional[str] = None
    next_after: Optional[str] = None
    typing_usernames: List[str] = Field(default_factory=list)

class MessagePresenceItem(BaseModel):
    thread_id: str
    user_id: str
    username: str
    is_typing: bool = False
    updated_at: str

class UserPresenceItem(BaseModel):
    user_id: str
    username: str
    last_active_at: str

class NetworkDirectoryResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "metrics": [
                {"label": "Aktiiviset yhteydet", "value": "24"},
                {"label": "Lukemattomat", "value": "3"},
            ],
            "user": {"user_id": "user_1", "username": "teamflow", "role": "super_admin"},
        }
    })

    metrics: List[NetworkMetricItem]
    user: Dict[str, Any]

class CommunitiesDirectoryResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "communities": [
                {"name": "Design", "members": 120, "description": "Teemallinen yhteisö UI-ideoille ja palautteelle."}
            ]
        }
    })

    communities: List[CommunityItem]

class CommunityMembershipResponse(BaseModel):
    community_name: str
    is_member: bool
    members: int

class CommunityPostItem(BaseModel):
    post_id: str
    user_id: str
    username: str
    text: str
    image: Optional[str] = None
    video: Optional[str] = None
    hashtags: List[str] = Field(default_factory=list)
    mentions: List[str] = Field(default_factory=list)
    likes_count: int = 0
    comments_count: int = 0
    repost_count: int = 0
    created_at: datetime
    is_liked: bool = False

class CommunityDetailResponse(BaseModel):
    community_name: str
    is_member: bool = False
    members: int = 0
    description: str
    posts: List[CommunityPostItem]

class ProjectsDirectoryResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "projects": [
                {"name": "Alpha launch", "status": "Luonnos", "description": "Julkaisun valmistelut ja testaus."}
            ]
        }
    })

    projects: List[ProjectItem]

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
    if not role:
        return "user"
    normalized = str(role).strip().lower().replace(" ", "_")
    alias_map = {
        "super_admin": "super_admin",
        "superadmin": "super_admin",
        "super-admin": "super_admin",
        "admin": "super_admin",
        "moderator": "moderator",
        "mod": "moderator",
        "user": "user",
    }
    if normalized in alias_map:
        return alias_map[normalized]
    return "user"


def role_label(role: Optional[str]) -> str:
    return ROLE_LABELS.get(normalize_role(role), ROLE_LABELS["user"])

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
    if get_user_role(raw_user) == "super_admin":
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

def ensure_super_admin(raw_user: Dict[str, Any]) -> None:
    ensure_admin_access(raw_user)

def ensure_moderator_access(raw_user: Dict[str, Any]) -> None:
    if get_user_role(raw_user) not in {"super_admin", "moderator"}:
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

def normalize_topic_token(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum() or ch == "#").strip()

def extract_hashtags_from_text(text: str) -> List[str]:
    hashtags: List[str] = []
    seen: set[str] = set()
    for raw_word in str(text or "").split():
        token = normalize_topic_token(raw_word)
        if token.startswith("#") and len(token) > 1 and token not in seen:
            seen.add(token)
            hashtags.append(token)
    return hashtags

def extract_mentions_from_text(text: str) -> List[str]:
    mentions: List[str] = []
    seen: set[str] = set()
    for raw_word in str(text or "").split():
        token = raw_word.strip()
        if not token.startswith("@"):
            continue
        token = "".join(ch for ch in token if ch.isalnum() or ch == "_")
        if len(token) > 1:
            username = token[1:]
            if username and username not in seen:
                seen.add(username)
                mentions.append(username)
    return mentions

def derive_explore_topics_from_posts(posts: List[Dict[str, Any]], limit: int = 8) -> List[Dict[str, Any]]:
    counts: Dict[str, int] = {}
    for post in posts:
        text = str(post.get("text", "") or "")
        for raw_word in text.split():
            word = normalize_topic_token(raw_word)
            if not word.startswith("#") or len(word) < 3:
                continue
            counts[word] = counts.get(word, 0) + 1
    return [
        {"label": label, "count": count}
        for label, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]
    ]

def derive_creator_suggestions_from_posts(posts: List[Dict[str, Any]], limit: int = 6) -> List[Dict[str, Any]]:
    creators: Dict[str, Dict[str, Any]] = {}
    for post in posts:
        user_id = str(post.get("user_id", "") or "")
        username = str(post.get("username", "") or "")
        if not user_id or not username:
            continue
        existing = creators.get(user_id)
        creators[user_id] = {
            "user_id": user_id,
            "username": username,
            "post_count": int(existing.get("post_count", 0) if existing else 0) + 1,
        }
    return sorted(creators.values(), key=lambda item: (-item["post_count"], item["username"]))[:limit]

def build_community_suggestions_from_topics(topics: List[Dict[str, Any]], limit: int = 5) -> List[Dict[str, Any]]:
    communities = [
        {
            "name": topic["label"].lstrip("#").capitalize() or "Community",
            "members": max(10, topic["count"] * 12),
            "description": f"Aiheen ympärille muodostunut yhteisö ({topic['count']} osumaa).",
        }
        for topic in topics[:limit]
    ]
    if communities:
        return communities
    return []

def normalize_community_name(name: str) -> str:
    cleaned = " ".join(part for part in str(name or "").strip().split() if part)
    return cleaned[:80]

async def get_user_community_memberships(user_id: str) -> List[str]:
    if not user_id:
        return []
    if db is not None:
        rows = await db.community_memberships.find({"user_id": user_id}, {"_id": 0, "community_name": 1}).to_list(length=100)
        return [normalize_community_name(str(row.get("community_name") or "")) for row in rows if row.get("community_name")]
    return sqlite_get_user_community_memberships(user_id)

async def get_community_membership_count(community_name: str) -> int:
    normalized_name = normalize_community_name(community_name)
    if not normalized_name:
        return 0
    if db is not None:
        return int(await db.community_memberships.count_documents({"community_name": normalized_name}))
    return sqlite_get_community_membership_count(normalized_name)

def build_message_thread_id(user_id_a: str, user_id_b: str) -> str:
    return "::".join(sorted([str(user_id_a), str(user_id_b)]))

def build_message_preview(item: Dict[str, Any]) -> str:
    preview = str(item.get("text") or item.get("type") or "Message")
    if len(preview) > 56:
        preview = preview[:53].rstrip() + "..."
    return preview

def _normalize_message_row(row: Dict[str, Any], current_user_id: str) -> Dict[str, Any]:
    sender_user_id = str(row.get("sender_user_id") or "")
    return {
        "id": str(row.get("message_id") or row.get("id") or f"msg_{uuid.uuid4().hex[:10]}"),
        "thread_id": str(row.get("thread_id") or ""),
        "sender_user_id": sender_user_id,
        "sender_username": str(row.get("sender_username") or "user"),
        "text": str(row.get("text") or ""),
        "created_at": str(row.get("created_at") or utc_iso_now()),
        "is_outgoing": sender_user_id == current_user_id or bool(row.get("is_outgoing")),
        "delivered_at": row.get("delivered_at"),
        "read_at": row.get("read_at"),
    }

def _message_sort_key(row: Dict[str, Any]) -> str:
    return str(row.get("created_at") or "")

def sqlite_save_message(message: Dict[str, Any]) -> None:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO messages (
                message_id, thread_id, sender_user_id, sender_username,
                recipient_user_id, text, created_at, is_read, delivered_at, read_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                message["message_id"],
                message["thread_id"],
                message["sender_user_id"],
                message["sender_username"],
                message.get("recipient_user_id"),
                message["text"],
                message["created_at"],
                int(bool(message.get("is_read", 0))),
                message.get("delivered_at"),
                message.get("read_at"),
            ),
        )
        conn.commit()

def sqlite_get_message_thread(user_id: str, thread_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT message_id, thread_id, sender_user_id, sender_username, recipient_user_id, text, created_at, is_read
            FROM messages
            WHERE thread_id = ? AND (sender_user_id = ? OR recipient_user_id = ?)
            ORDER BY datetime(created_at) ASC
            LIMIT ?
            """,
            (thread_id, user_id, user_id, limit),
        )
        return [normalize_post_payload(dict(row)) for row in cursor.fetchall()]

def sqlite_get_message_thread_page(user_id: str, thread_id: str, limit: int = 50, before: Optional[str] = None) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        if before:
            cursor.execute(
                """
                SELECT message_id, thread_id, sender_user_id, sender_username, recipient_user_id, text, created_at, is_read, delivered_at, read_at
                FROM messages
                WHERE thread_id = ? AND (sender_user_id = ? OR recipient_user_id = ?) AND datetime(created_at) < datetime(?)
                ORDER BY datetime(created_at) ASC
                LIMIT ?
                """,
                (thread_id, user_id, user_id, before, limit),
            )
        else:
            cursor.execute(
                """
                SELECT message_id, thread_id, sender_user_id, sender_username, recipient_user_id, text, created_at, is_read, delivered_at, read_at
                FROM messages
                WHERE thread_id = ? AND (sender_user_id = ? OR recipient_user_id = ?)
                ORDER BY datetime(created_at) ASC
                LIMIT ?
                """,
                (thread_id, user_id, user_id, limit),
            )
        return [dict(row) for row in cursor.fetchall()]

def sqlite_get_message_thread_newer_page(user_id: str, thread_id: str, after: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        if after:
            cursor.execute(
                """
                SELECT message_id, thread_id, sender_user_id, sender_username, recipient_user_id, text, created_at, is_read, delivered_at, read_at
                FROM messages
                WHERE thread_id = ? AND (sender_user_id = ? OR recipient_user_id = ?) AND datetime(created_at) > datetime(?)
                ORDER BY datetime(created_at) ASC
                LIMIT ?
                """,
                (thread_id, user_id, user_id, after, limit),
            )
        else:
            cursor.execute(
                """
                SELECT message_id, thread_id, sender_user_id, sender_username, recipient_user_id, text, created_at, is_read, delivered_at, read_at
                FROM messages
                WHERE thread_id = ? AND (sender_user_id = ? OR recipient_user_id = ?)
                ORDER BY datetime(created_at) ASC
                LIMIT ?
                """,
                (thread_id, user_id, user_id, limit),
            )
        return [dict(row) for row in cursor.fetchall()]

def sqlite_list_message_threads(user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT message_id, thread_id, sender_user_id, sender_username, recipient_user_id, text, created_at, is_read, delivered_at, read_at
            FROM messages
            WHERE sender_user_id = ? OR recipient_user_id = ?
            ORDER BY datetime(created_at) DESC
            """,
            (user_id, user_id),
        )
        rows = [dict(row) for row in cursor.fetchall()]
    threads: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        thread_id = str(row.get("thread_id") or "")
        if not thread_id or thread_id in threads:
            continue
        threads[thread_id] = row
    return list(threads.values())[:limit]

def sqlite_count_thread_unread(user_id: str, thread_id: str) -> int:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) AS c FROM messages WHERE thread_id = ? AND recipient_user_id = ? AND COALESCE(is_read, 0) = 0",
            (thread_id, user_id),
        )
        row = cursor.fetchone()
        return int(row["c"]) if row else 0

def sqlite_mark_thread_read(user_id: str, thread_id: str) -> None:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE messages SET is_read = 1, read_at = ? WHERE thread_id = ? AND recipient_user_id = ?",
            (utc_iso_now(), thread_id, user_id),
        )
        conn.commit()

def sqlite_get_unread_message_count(user_id: str) -> int:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) AS c FROM messages WHERE recipient_user_id = ? AND COALESCE(is_read, 0) = 0",
            (user_id,),
        )
        row = cursor.fetchone()
        return int(row["c"]) if row else 0

def mongo_message_document_to_item(doc: Dict[str, Any], current_user_id: str) -> Dict[str, Any]:
    return _normalize_message_row(doc, current_user_id)

async def get_thread_typing_usernames(thread_id: str, current_user_id: str) -> List[str]:
    typing_map: Dict[str, Dict[str, str]] = {}
    if db is not None:
        rows = await db.message_presence.find(
            {"thread_id": thread_id, "is_typing": True},
            {"_id": 0, "user_id": 1, "username": 1, "updated_at": 1},
        ).to_list(length=50)
        for row in rows:
            typing_map[str(row["user_id"])] = {"username": str(row.get("username") or ""), "updated_at": str(row.get("updated_at") or "")}
    else:
        with get_sqlite_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT thread_id, user_id, username, is_typing, updated_at
                FROM message_presence
                WHERE thread_id = ? AND is_typing = 1
                """,
                (thread_id,),
            )
            for row in cursor.fetchall():
                typing_map[str(row["user_id"])] = {"username": str(row["username"]), "updated_at": str(row["updated_at"])}
    now = datetime.now(timezone.utc)
    active: List[str] = []
    for user_id, payload in list(typing_map.items()):
        username = str(payload.get("username") or "")
        updated_at_raw = str(payload.get("updated_at") or "")
        if not username:
            continue
        try:
            updated_at = datetime.fromisoformat(updated_at_raw.replace("Z", "+00:00"))
        except Exception:
            continue
        if (now - updated_at).total_seconds() <= MESSAGE_TYPING_TTL_SECONDS and user_id != current_user_id:
            active.append(username)
        elif user_id in typing_map:
            typing_map.pop(user_id, None)
    return sorted(set(active))

async def get_thread_presence_is_typing(thread_id: str, current_user_id: str) -> bool:
    return bool(await get_thread_typing_usernames(thread_id, current_user_id))

async def touch_user_presence(user_id: str, username: str) -> None:
    updated_at = utc_iso_now()
    if db is not None:
        await db.user_presence.update_one(
            {"user_id": user_id},
            {"$set": {"user_id": user_id, "username": username, "last_active_at": updated_at}},
            upsert=True,
        )
        return
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO user_presence (user_id, username, last_active_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id)
            DO UPDATE SET username = excluded.username, last_active_at = excluded.last_active_at
            """,
            (user_id, username, updated_at),
        )
        conn.commit()

async def get_user_presence_snapshot(user_id: str, username: Optional[str] = None) -> Dict[str, Any]:
    if not user_id:
        return {"user_id": user_id, "username": username, "is_online": False, "last_active_at": None}
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=USER_ONLINE_TTL_SECONDS)).isoformat()
    if db is not None:
        row = await db.user_presence.find_one(
            {"user_id": user_id, "last_active_at": {"$gte": cutoff}},
            {"_id": 0, "user_id": 1, "username": 1, "last_active_at": 1},
        )
        if row:
            return {
                "user_id": str(row.get("user_id") or user_id),
                "username": str(row.get("username") or username or ""),
                "is_online": True,
                "last_active_at": str(row.get("last_active_at") or ""),
            }
        return {"user_id": user_id, "username": username, "is_online": False, "last_active_at": None}
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT user_id, username, last_active_at FROM user_presence WHERE user_id = ? AND datetime(last_active_at) >= datetime(?) LIMIT 1",
            (user_id, cutoff),
        )
        row = cursor.fetchone()
        if row:
            return {
                "user_id": str(row["user_id"]),
                "username": str(row["username"] or username or ""),
                "is_online": True,
                "last_active_at": str(row["last_active_at"] or ""),
            }
    return {"user_id": user_id, "username": username, "is_online": False, "last_active_at": None}

async def get_user_presence_status(user_id: str) -> bool:
    return bool((await get_user_presence_snapshot(user_id)).get("is_online"))

async def set_thread_typing(thread_id: str, user_id: str, username: str, is_typing: bool) -> None:
    updated_at = utc_iso_now()
    if db is not None:
        await db.message_presence.update_one(
            {"thread_id": thread_id, "user_id": user_id},
            {"$set": {"thread_id": thread_id, "user_id": user_id, "username": username, "is_typing": bool(is_typing), "updated_at": updated_at}},
            upsert=True,
        )
        return
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO message_presence (thread_id, user_id, username, is_typing, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(thread_id, user_id)
            DO UPDATE SET username = excluded.username, is_typing = excluded.is_typing, updated_at = excluded.updated_at
            """,
            (thread_id, user_id, username, int(bool(is_typing)), updated_at),
        )
        conn.commit()

async def cleanup_stale_message_presence() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=MESSAGE_TYPING_TTL_SECONDS)).isoformat()
    if db is not None:
        await db.message_presence.delete_many({"updated_at": {"$lt": cutoff}})
        return
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM message_presence WHERE datetime(updated_at) < datetime(?)",
            (cutoff,),
        )
        conn.commit()

async def get_message_presence_telemetry() -> Dict[str, Any]:
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=MESSAGE_TYPING_TTL_SECONDS)).isoformat()
    online_cutoff = (datetime.now(timezone.utc) - timedelta(seconds=USER_ONLINE_TTL_SECONDS)).isoformat()
    if db is not None:
        total = int(await db.message_presence.count_documents({}))
        active = int(await db.message_presence.count_documents({"is_typing": True, "updated_at": {"$gte": cutoff}}))
        online = int(await db.user_presence.count_documents({"last_active_at": {"$gte": online_cutoff}}))
        stale = max(0, total - active)
        return {
            "storage": "mongodb",
            "total_presence_rows": total,
            "active_typing_rows": active,
            "online_users_rows": online,
            "stale_presence_rows_estimate": stale,
            "ttl_seconds": MESSAGE_TYPING_TTL_SECONDS,
            "online_ttl_seconds": USER_ONLINE_TTL_SECONDS,
            "cutoff": cutoff,
        }
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) AS c FROM message_presence")
        total = int(cursor.fetchone()["c"] or 0)
        cursor.execute(
            "SELECT COUNT(*) AS c FROM message_presence WHERE is_typing = 1 AND datetime(updated_at) >= datetime(?)",
            (cutoff,),
        )
        active = int(cursor.fetchone()["c"] or 0)
        cursor.execute(
            "SELECT COUNT(*) AS c FROM user_presence WHERE datetime(last_active_at) >= datetime(?)",
            (online_cutoff,),
        )
        online = int(cursor.fetchone()["c"] or 0)
        return {
            "storage": "sqlite",
            "total_presence_rows": total,
            "active_typing_rows": active,
            "online_users_rows": online,
            "stale_presence_rows_estimate": max(0, total - active),
            "ttl_seconds": MESSAGE_TYPING_TTL_SECONDS,
            "online_ttl_seconds": USER_ONLINE_TTL_SECONDS,
            "cutoff": cutoff,
        }

async def message_presence_cleanup_loop() -> None:
    while True:
        try:
            await cleanup_stale_message_presence()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("Message presence cleanup failed: %s", exc)
        await asyncio.sleep(max(30, MESSAGE_TYPING_TTL_SECONDS))

def message_avatar_url(profile_picture: Optional[str]) -> Optional[str]:
    if not profile_picture:
        return None
    picture = str(profile_picture).strip()
    if not picture:
        return None
    if picture.startswith(("http://", "https://", "/")):
        return picture
    return f"/uploads/{Path(picture).name}"

def get_user_profile_picture_by_id(user_id: str) -> Optional[str]:
    if not user_id:
        return None
    if db is not None:
        return None
    user = get_sqlite_user_by_id(user_id)
    return str(user.get("profile_picture") or "") if user else None

async def build_message_thread_response(user: Dict[str, Any], thread_id: str, before: Optional[str] = None, after: Optional[str] = None, limit: int = 200) -> MessageThreadResponse:
    if db is not None:
        query: Dict[str, Any] = {
            "thread_id": thread_id,
            "$or": [{"sender_user_id": user["user_id"]}, {"recipient_user_id": user["user_id"]}],
        }
        if before:
            query["created_at"] = {"$lt": before}
        if after:
            query["created_at"] = {"$gt": after}
        stored_messages = await db.messages.find(query, {"_id": 0}).sort("created_at", 1).limit(limit).to_list(length=limit)
        if stored_messages:
            partner_candidate = next((item for item in stored_messages if str(item.get("sender_user_id") or "") != user["user_id"]), stored_messages[-1])
            partner_user_id = str(partner_candidate.get("sender_user_id") or "")
            if partner_user_id:
                await touch_user_presence(partner_user_id, str(partner_candidate.get("sender_username") or "user"))
        read_at = utc_iso_now()
        await db.messages.update_many(
            {"thread_id": thread_id, "recipient_user_id": user["user_id"]},
            {"$set": {"is_read": True, "read_at": read_at}},
        )
        unread_count = int(await db.messages.count_documents({"recipient_user_id": user["user_id"], "is_read": {"$ne": True}}))
    else:
        if after:
            stored_messages = sqlite_get_message_thread_newer_page(user["user_id"], thread_id, after=after, limit=limit)
        else:
            stored_messages = sqlite_get_message_thread_page(user["user_id"], thread_id, limit=limit, before=before)
        if stored_messages:
            partner_candidate = next((item for item in stored_messages if str(item.get("sender_user_id") or "") != user["user_id"]), stored_messages[-1])
            partner_user_id = str(partner_candidate.get("sender_user_id") or "")
            if partner_user_id:
                await touch_user_presence(partner_user_id, str(partner_candidate.get("sender_username") or "user"))
        sqlite_mark_thread_read(user["user_id"], thread_id)
        unread_count = sqlite_count_thread_unread(user["user_id"], thread_id)
    partner_message = next((item for item in stored_messages if str(item.get("sender_user_id") or "") != user["user_id"]), None)
    partner_username = str(partner_message.get("sender_username") if partner_message else "user")
    partner_user_id = str(partner_message.get("sender_user_id") if partner_message else "")
    last_sender_user_id = str(stored_messages[-1].get("sender_user_id") or "") if stored_messages else ""
    direction = "sent" if last_sender_user_id == user["user_id"] else "received"
    messages = [_normalize_message_row(item, user["user_id"]) for item in stored_messages]
    avatar_source = None
    if partner_message:
        avatar_source = partner_message.get("sender_profile_picture") or partner_message.get("profile_picture")
        if not avatar_source:
            if db is not None and partner_user_id:
                partner_user = await db.users.find_one({"user_id": partner_user_id}, {"_id": 0, "profile_picture": 1})
                avatar_source = str(partner_user.get("profile_picture") or "") if partner_user else None
            else:
                avatar_source = get_user_profile_picture_by_id(partner_user_id)
    read_marks = [str(item.get("read_at") or "") for item in stored_messages if item.get("read_at")]
    last_read_at = max(read_marks) if read_marks else None
    partner_presence = await get_user_presence_snapshot(partner_user_id, partner_username) if partner_message else {"is_online": False}
    return MessageThreadResponse(
        thread=MessageThreadItem(
            id=thread_id,
            title=f"@{partner_username}",
            preview=messages[-1]["text"] if messages else "",
            time=messages[-1]["created_at"] if messages else utc_iso_now(),
            unread_count=unread_count,
            avatar_url=message_avatar_url(avatar_source if isinstance(avatar_source, str) else None),
            participant_user_id=partner_user_id or None,
            last_sender_user_id=last_sender_user_id or None,
            last_sender_username=partner_username,
            direction=direction,
            last_read_at=last_read_at,
            is_typing=bool(await get_thread_typing_usernames(thread_id, user["user_id"])),
            is_online=bool(partner_presence.get("is_online")),
        ),
        messages=[MessageItem(**message) for message in messages],
        unread_count=unread_count,
        has_more=len(messages) >= limit,
        has_newer=bool(after and len(messages) >= limit),
        next_before=messages[0]["created_at"] if messages else None,
        next_after=messages[-1]["created_at"] if messages else None,
        typing_usernames=await get_thread_typing_usernames(thread_id, user["user_id"]),
    )

def build_search_posts_from_posts(posts: List[Dict[str, Any]], limit: int = 12) -> List[Dict[str, Any]]:
    return [
        {
            "post_id": str(post.get("post_id", "")),
            "user_id": str(post.get("user_id", "")),
            "username": str(post.get("username", "")),
            "text": str(post.get("text", "")),
            "image": post.get("image"),
            "likes_count": int(post.get("likes_count", 0) or 0),
            "comments_count": int(post.get("comments_count", 0) or 0),
            "created_at": post.get("created_at") or utc_iso_now(),
            "score": float(post.get("score", 0) or 0),
            "match_reason": str(post.get("match_reason") or ""),
            "score_breakdown": post.get("score_breakdown"),
        }
        for post in posts[:limit]
    ]

def build_last_message_state(item: Dict[str, Any]) -> str:
    if item.get("read_at"):
        return "read"
    if item.get("delivered_at"):
        return "delivered"
    return "sending"

def search_query_tokenize(query: str) -> List[str]:
    normalized = normalize_topic_token(query)
    if not normalized:
        return []
    return [token for token in normalized.split() if token]

def score_search_text(text: str, tokens: List[str], weight: float = 1.0) -> float:
    if not tokens:
        return 0.0
    lowered = str(text or "").lower()
    score = 0.0
    for token in tokens:
        if not token:
            continue
        if lowered == token:
            score += 5.0 * weight
        elif lowered.startswith(token):
            score += 3.0 * weight
        elif token in lowered:
            score += 1.5 * weight
    return score

def rank_search_posts(posts: List[Dict[str, Any]], tokens: List[str]) -> List[Dict[str, Any]]:
    def post_score(post: Dict[str, Any]) -> tuple[float, str]:
        likes = float(post.get("likes_count", 0) or 0)
        comments = float(post.get("comments_count", 0) or 0)
        recency = datetime.now(timezone.utc)
        created_raw = str(post.get("created_at") or "")
        try:
            created_at = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
        except Exception:
            created_at = recency - timedelta(days=365)
        age_hours = max(1.0, (recency - created_at).total_seconds() / 3600.0)
        text_score = score_search_text(post.get("text", ""), tokens, 2.0)
        user_score = score_search_text(post.get("username", ""), tokens, 2.5)
        keyword_score = score_search_text(str(post.get("keywords") or ""), tokens, 1.6)
        hashtag_score = score_search_text(str(post.get("hashtags") or ""), tokens, 1.4)
        engagement_score = (likes * 1.8) + (comments * 2.5)
        recency_score = 1.5 / age_hours
        score = ((text_score + user_score + keyword_score + hashtag_score + engagement_score) / age_hours) + recency_score
        reasons: List[str] = []
        if text_score:
            reasons.append("text match")
        if user_score:
            reasons.append("author match")
        if keyword_score:
            reasons.append("keyword match")
        if hashtag_score:
            reasons.append("hashtag match")
        if likes or comments:
            reasons.append("engagement")
        reasons.append("recent" if age_hours < 24 else "older")
        post["score_breakdown"] = {
            "text": round(text_score, 2),
            "author": round(user_score, 2),
            "keywords": round(keyword_score, 2),
            "hashtags": round(hashtag_score, 2),
            "engagement": round(engagement_score, 2),
            "recency_bonus": round(recency_score, 2),
        }
        return score, ", ".join(reasons)
    scored_posts = []
    for post in posts:
        score, reason = post_score(post)
        post["score"] = round(score, 2)
        post["match_reason"] = reason
        scored_posts.append(post)
    return sorted(scored_posts, key=lambda post: (float(post.get("score", 0) or 0), str(post.get("created_at") or "")), reverse=True)

def rank_search_users(users: List[Dict[str, Any]], tokens: List[str]) -> List[Dict[str, Any]]:
    def user_score(user: Dict[str, Any]) -> tuple[float, str]:
        username_score = score_search_text(user.get("username", ""), tokens, 3.0)
        bio_score = score_search_text(user.get("bio", ""), tokens, 2.0)
        display_score = score_search_text(str(user.get("display_name") or ""), tokens, 2.5)
        role_score = 1.0 if str(user.get("role") or "").lower() == "super admin" else 0.0
        social_score = (float(user.get("followers_count", 0) or 0) * 0.03) + (float(user.get("posts_count", 0) or 0) * 0.04)
        score = (username_score * 1.15) + (bio_score * 0.9) + (display_score * 1.05) + role_score + social_score
        reasons: List[str] = []
        if username_score:
            reasons.append("username match")
        if bio_score:
            reasons.append("bio match")
        if display_score:
            reasons.append("name match")
        if role_score:
            reasons.append("role boost")
        if social_score:
            reasons.append("social proof")
        user["score_breakdown"] = {
            "username": round(username_score, 2),
            "display_name": round(display_score, 2),
            "bio": round(bio_score, 2),
            "role": round(role_score, 2),
            "social": round(social_score, 2),
        }
        return score, ", ".join(reasons or ["popular"])
    scored_users = []
    for user in users:
        score, reason = user_score(user)
        user["score"] = round(score, 2)
        user["match_reason"] = reason
        scored_users.append(user)
    return sorted(scored_users, key=lambda user: (float(user.get("score", 0) or 0), float(user.get("followers_count", 0) or 0), float(user.get("posts_count", 0) or 0), str(user.get("username") or "")), reverse=True)

def sqlite_search_posts(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    tokens = [token for token in query.split() if token]
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        if tokens:
            like_clauses = []
            params: List[str] = []
            for token in tokens:
                like_clauses.append("(LOWER(text) LIKE ? OR LOWER(username) LIKE ? OR LOWER(COALESCE(keywords, '')) LIKE ?)")
                lowered = f"%{token.lower()}%"
                params.extend([lowered, lowered, lowered])
            cursor.execute(
                f"""
                SELECT post_id, user_id, username, profile_picture, text, image, likes_count, comments_count, created_at
                FROM posts
                WHERE {' AND '.join(like_clauses)}
                ORDER BY datetime(created_at) DESC
                LIMIT ?
                """,
                tuple(params) + (limit,),
            )
        else:
            cursor.execute(
                """
                SELECT post_id, user_id, username, profile_picture, text, image, likes_count, comments_count, created_at
                FROM posts
                ORDER BY datetime(created_at) DESC
                LIMIT ?
                """,
                (limit,),
            )
        return [dict(row) for row in cursor.fetchall()]

def sqlite_search_users(query: str, limit: int = 8) -> List[Dict[str, Any]]:
    tokens = [token for token in query.split() if token]
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        if tokens:
            like_clauses = []
            params: List[str] = []
            for token in tokens:
                like_clauses.append("(LOWER(username) LIKE ? OR LOWER(COALESCE(bio, '')) LIKE ? OR LOWER(email) LIKE ?)")
                lowered = f"%{token.lower()}%"
                params.extend([lowered, lowered, lowered])
            cursor.execute(
                f"""
                SELECT user_id, username, bio, followers_count, posts_count, role
                FROM users
                WHERE {' AND '.join(like_clauses)}
                ORDER BY followers_count DESC, posts_count DESC, username ASC
                LIMIT ?
                """,
                tuple(params) + (limit,),
            )
        else:
            cursor.execute(
                """
                SELECT user_id, username, bio, followers_count, posts_count, role
                FROM users
                ORDER BY followers_count DESC, posts_count DESC, username ASC
                LIMIT ?
                """,
                (limit,),
            )
        return [dict(row) for row in cursor.fetchall()]

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
    reason_tags = payload.get("reason_tags")
    if not isinstance(reason_tags, list):
        reason_tags = []
    reason_tags = [str(tag).strip() for tag in reason_tags if str(tag).strip()]
    reason_custom = payload.get("reason_custom")
    reason_custom = str(reason_custom).strip() if reason_custom is not None else None
    reviewed_reason = payload.get("reviewed_reason")
    reviewed_reason = str(reviewed_reason).strip() if reviewed_reason is not None else None
    try:
        score = int(payload.get("score", fallback.score))
    except Exception:
        score = fallback.score
    if not reviewed_reason:
        reviewed_parts = [part for part in [*reason_tags, reason_custom or reason or ""] if str(part).strip()]
        reviewed_reason = ", ".join(str(part).strip() for part in reviewed_parts)
    return ModerationDecision(
        score=max(0, min(100, score)),
        action=action,
        queue=bool(queue),
        reason=reason,
        reason_tags=reason_tags,
        reason_custom=reason_custom,
        reviewed_reason=reviewed_reason or None,
    )


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
    cursor = conn.cursor()
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        thread_id TEXT,
        sender_user_id TEXT,
        sender_username TEXT,
        recipient_user_id TEXT,
        text TEXT,
        created_at TEXT,
        is_read INTEGER DEFAULT 0
    )
    ''')
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS message_presence (
        thread_id TEXT,
        user_id TEXT,
        username TEXT,
        is_typing INTEGER DEFAULT 0,
        updated_at TEXT,
        PRIMARY KEY (thread_id, user_id)
    )
    ''')
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS user_presence (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        last_active_at TEXT
    )
    ''')
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS community_memberships (
        membership_id TEXT PRIMARY KEY,
        user_id TEXT,
        community_name TEXT,
        created_at TEXT,
        UNIQUE(user_id, community_name)
    )
    ''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_message_presence_thread_updated ON message_presence(thread_id, updated_at DESC)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_thread_id_created_at ON messages(thread_id, created_at DESC)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_recipient_is_read ON messages(recipient_user_id, is_read)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_presence_last_active ON user_presence(last_active_at DESC)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_community_memberships_name ON community_memberships(community_name)")
    conn.commit()
    return conn

def sqlite_get_messages_for_thread(user_id: str, thread_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT message_id, thread_id, sender_user_id, sender_username, recipient_user_id, text, created_at, is_read
            FROM messages
            WHERE thread_id = ? AND (sender_user_id = ? OR recipient_user_id = ?)
            ORDER BY datetime(created_at) ASC
            LIMIT ?
            """,
            (thread_id, user_id, user_id, limit),
        )
        return [dict(row) for row in cursor.fetchall()]

def sqlite_list_messages_for_user(user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT message_id, thread_id, sender_user_id, sender_username, recipient_user_id, text, created_at, is_read
            FROM messages
            WHERE sender_user_id = ? OR recipient_user_id = ?
            ORDER BY datetime(created_at) DESC
            """,
            (user_id, user_id),
        )
        rows = [dict(row) for row in cursor.fetchall()]
    latest_by_thread: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        thread_id = str(row.get("thread_id") or "")
        if thread_id and thread_id not in latest_by_thread:
            latest_by_thread[thread_id] = row
    return list(latest_by_thread.values())[:limit]

def sqlite_count_unread_messages(user_id: str) -> int:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) AS c FROM messages WHERE recipient_user_id = ? AND COALESCE(is_read, 0) = 0",
            (user_id,),
        )
        row = cursor.fetchone()
        return int(row["c"]) if row else 0


def get_sqlite_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
        row = cursor.fetchone()
        return normalize_post_payload(dict(row)) if row else None


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

def sqlite_get_thread_last_read_at(user_id: str, thread_id: str) -> Optional[str]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT MAX(COALESCE(read_at, created_at)) AS last_read
            FROM messages
            WHERE thread_id = ? AND recipient_user_id = ? AND COALESCE(is_read, 0) = 1
            """,
            (thread_id, user_id),
        )
        row = cursor.fetchone()
        value = row["last_read"] if row else None
        return str(value) if value else None


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


def repository_get_feed(skip: int = 0, limit: int = 20, user_ids: Optional[List[str]] = None, exclude_nsfw: bool = False) -> Optional[List[Dict[str, Any]]]:
    if REPOSITORY_ADAPTER is not None:
        return REPOSITORY_ADAPTER.get_feed(skip=skip, limit=limit, user_ids=user_ids, exclude_nsfw=exclude_nsfw)
    return None


def repository_get_post(post_id: str) -> Optional[Dict[str, Any]]:
    if REPOSITORY_ADAPTER is not None:
        return REPOSITORY_ADAPTER.get_post(post_id)
    return None


def repository_get_moderation_queue(limit: int = 100) -> Optional[List[Dict[str, Any]]]:
    if REPOSITORY_ADAPTER is not None:
        return REPOSITORY_ADAPTER.get_moderation_queue(limit=limit)
    return None

async def get_unread_notifications_count_for_user(user_id: str) -> int:
    if db is not None:
        return int(await db.notifications.count_documents({"user_id": user_id, "is_read": {"$ne": True}}))
    return get_sqlite_unread_notifications_count(user_id)


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
    user_posts = get_sqlite_posts_by_user(user_id)
    post_ids = [row["post_id"] for row in user_posts]
    repost_source_ids = [str(row.get("repost_post_id") or "") for row in user_posts if row.get("repost_post_id")]
    user_comment_ids: List[str] = []
    post_comment_ids: List[str] = []
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT comment_id FROM comments WHERE user_id = ?", (user_id,))
        user_comment_ids = [row["comment_id"] for row in cursor.fetchall()]
        if post_ids:
            placeholders = ",".join(["?"] * len(post_ids))
            cursor.execute(f"SELECT comment_id FROM comments WHERE post_id IN ({placeholders})", tuple(post_ids))
            post_comment_ids = [row["comment_id"] for row in cursor.fetchall()]
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM likes WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM follows WHERE follower_id = ? OR following_id = ?", (user_id, user_id))
        cursor.execute("DELETE FROM blocks WHERE user_id = ? OR target_user_id = ?", (user_id, user_id))
        cursor.execute("DELETE FROM mutes WHERE user_id = ? OR target_user_id = ?", (user_id, user_id))
        cursor.execute("DELETE FROM comments WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM posts WHERE user_id = ?", (user_id,))
        if post_ids:
            placeholders = ",".join(["?"] * len(post_ids))
            cursor.execute(f"DELETE FROM likes WHERE post_id IN ({placeholders})", tuple(post_ids))
            cursor.execute(f"DELETE FROM comments WHERE post_id IN ({placeholders})", tuple(post_ids))
            cursor.execute(f"DELETE FROM reports WHERE target_id IN ({placeholders})", tuple(post_ids))
            cursor.execute(f"DELETE FROM dwell_events WHERE post_id IN ({placeholders})", tuple(post_ids))
            cursor.execute(f"DELETE FROM notifications WHERE post_id IN ({placeholders})", tuple(post_ids))
        all_comment_ids = sorted(set(user_comment_ids + post_comment_ids))
        if all_comment_ids:
            placeholders = ",".join(["?"] * len(all_comment_ids))
            cursor.execute(f"DELETE FROM reports WHERE target_id IN ({placeholders})", tuple(all_comment_ids))
            cursor.execute(f"DELETE FROM notifications WHERE comment_id IN ({placeholders})", tuple(all_comment_ids))
        cursor.execute("DELETE FROM reports WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM notifications WHERE user_id = ? OR actor_user_id = ?", (user_id, user_id))
        cursor.execute("DELETE FROM moderation_offenses WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM UserInteractions WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM dwell_events WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM community_memberships WHERE user_id = ?", (user_id,))
        for source_post_id in repost_source_ids:
            cursor.execute(
                "UPDATE posts SET repost_count = CASE WHEN repost_count > 0 THEN repost_count - 1 ELSE 0 END WHERE post_id = ?",
                (source_post_id,),
            )
        cursor.execute("DELETE FROM users WHERE user_id = ?", (user_id,))
        conn.commit()
    delete_upload_artifacts(user_posts)
    push_audit_log("user_deleted", user_id, details="sqlite_hard_delete")


def sqlite_hard_delete_user(user_id: str) -> None:
    user = get_sqlite_user_by_id(user_id)
    user_posts = get_sqlite_posts_by_user(user_id)
    post_ids = [row["post_id"] for row in user_posts]
    repost_source_ids = [str(row.get("repost_post_id") or "") for row in user_posts if row.get("repost_post_id")]
    user_comment_ids: List[str] = []
    post_comment_ids: List[str] = []
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT comment_id FROM comments WHERE user_id = ?", (user_id,))
        user_comment_ids = [row["comment_id"] for row in cursor.fetchall()]
        if post_ids:
            placeholders = ",".join(["?"] * len(post_ids))
            cursor.execute(f"SELECT comment_id FROM comments WHERE post_id IN ({placeholders})", tuple(post_ids))
            post_comment_ids = [row["comment_id"] for row in cursor.fetchall()]
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM likes WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM follows WHERE follower_id = ? OR following_id = ?", (user_id, user_id))
        cursor.execute("DELETE FROM blocks WHERE user_id = ? OR target_user_id = ?", (user_id, user_id))
        cursor.execute("DELETE FROM mutes WHERE user_id = ? OR target_user_id = ?", (user_id, user_id))
        cursor.execute("DELETE FROM comments WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM posts WHERE user_id = ?", (user_id,))
        if post_ids:
            placeholders = ",".join(["?"] * len(post_ids))
            cursor.execute(f"DELETE FROM likes WHERE post_id IN ({placeholders})", tuple(post_ids))
            cursor.execute(f"DELETE FROM comments WHERE post_id IN ({placeholders})", tuple(post_ids))
            cursor.execute(f"DELETE FROM reports WHERE target_id IN ({placeholders})", tuple(post_ids))
            cursor.execute(f"DELETE FROM dwell_events WHERE post_id IN ({placeholders})", tuple(post_ids))
            cursor.execute(f"DELETE FROM notifications WHERE post_id IN ({placeholders})", tuple(post_ids))
        all_comment_ids = sorted(set(user_comment_ids + post_comment_ids))
        if all_comment_ids:
            placeholders = ",".join(["?"] * len(all_comment_ids))
            cursor.execute(f"DELETE FROM reports WHERE target_id IN ({placeholders})", tuple(all_comment_ids))
            cursor.execute(f"DELETE FROM notifications WHERE comment_id IN ({placeholders})", tuple(all_comment_ids))
        cursor.execute("DELETE FROM reports WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM notifications WHERE user_id = ? OR actor_user_id = ?", (user_id, user_id))
        cursor.execute("DELETE FROM moderation_offenses WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM UserInteractions WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM dwell_events WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM community_memberships WHERE user_id = ?", (user_id,))
        for source_post_id in repost_source_ids:
            cursor.execute(
                "UPDATE posts SET repost_count = CASE WHEN repost_count > 0 THEN repost_count - 1 ELSE 0 END WHERE post_id = ?",
                (source_post_id,),
            )
        cursor.execute("DELETE FROM users WHERE user_id = ?", (user_id,))
        conn.commit()
    delete_upload_artifacts(user_posts)
    push_audit_log("user_hard_deleted", user_id, details=f"sqlite_hard_delete:{bool(user)}")

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

def sqlite_get_user_community_memberships(user_id: str) -> List[str]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT community_name FROM community_memberships WHERE user_id = ?",
            (user_id,),
        )
        return [str(row["community_name"]) for row in cursor.fetchall()]

def sqlite_get_community_membership_count(community_name: str) -> int:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) AS c FROM community_memberships WHERE community_name = ?",
            (community_name,),
        )
        row = cursor.fetchone()
        return int(row["c"]) if row else 0

def sqlite_toggle_community_membership(user_id: str, community_name: str) -> bool:
    normalized_name = normalize_community_name(community_name)
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT 1 FROM community_memberships WHERE user_id = ? AND community_name = ?",
            (user_id, normalized_name),
        )
        exists = cursor.fetchone() is not None
        if exists:
            cursor.execute(
                "DELETE FROM community_memberships WHERE user_id = ? AND community_name = ?",
                (user_id, normalized_name),
            )
            joined = False
        else:
            cursor.execute(
                "INSERT OR IGNORE INTO community_memberships (membership_id, user_id, community_name, created_at) VALUES (?, ?, ?, ?)",
                (f"cm_{uuid.uuid4().hex[:12]}", user_id, normalized_name, utc_iso_now()),
            )
            joined = True
        conn.commit()
    return joined

def sqlite_queue_moderation_item(item: Dict[str, Any]) -> None:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO moderation_queue (
                moderation_id, target_type, target_id, user_id, score, status, reason, created_at, text, post_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                item.get("post_id"),
            ),
        )
        conn.commit()

def sqlite_get_moderation_queue(limit: int = 100) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT moderation_id, target_type, target_id, user_id, score, status, reason, created_at, text, post_id
            FROM moderation_queue
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]

def sqlite_get_moderation_history(limit: int = 100) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT moderation_id, target_type, target_id, user_id, score, status, reason, created_at, text, post_id, reviewed_at, reviewed_by, reviewed_reason, reviewed_reason_tags, reviewed_reason_custom
            FROM moderation_queue
            WHERE status != 'pending'
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]

def sqlite_get_post_summary(post_id: str) -> Optional[Dict[str, Any]]:
    post = get_sqlite_post(post_id)
    if not post:
        return None
    text = str(post.get("text", "") or "").strip()
    return {
        "post_id": post.get("post_id"),
        "username": post.get("username"),
        "text": text[:160],
    }

def sqlite_update_moderation_queue_status(moderation_id: str, status: str) -> bool:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE moderation_queue SET status = ?, reviewed_at = ?, reviewed_by = ?, reviewed_reason = ? WHERE moderation_id = ?",
            (status, utc_iso_now(), "system", None, moderation_id),
        )
        conn.commit()
        return cursor.rowcount > 0

def sqlite_get_finance_snapshot() -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) AS c FROM users")
        users_count = int(cursor.fetchone()["c"])
        cursor.execute("SELECT COUNT(*) AS c FROM posts")
        posts_count = int(cursor.fetchone()["c"])
        cursor.execute("SELECT COUNT(*) AS c FROM moderation_queue")
        moderation_items = int(cursor.fetchone()["c"])
        cursor.execute("SELECT COUNT(*) AS c FROM payment_intents")
        payment_intents_count = int(cursor.fetchone()["c"])
        cursor.execute("SELECT COALESCE(SUM(balance), 0) AS total_balance FROM wallet_accounts")
        wallet_balance_total = float(cursor.fetchone()["total_balance"] or 0)
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
        "payment_intents_count": payment_intents_count,
        "wallet_balance_total": round(wallet_balance_total, 2),
        "ad_revenue_eur": round(ad_total_eur, 2),
        "exchange_rates": rates,
    }

def sqlite_get_system_overview_snapshot() -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) AS c FROM comments")
        comments_count = int(cursor.fetchone()["c"])
        cursor.execute("SELECT COUNT(*) AS c FROM likes")
        likes_count = int(cursor.fetchone()["c"])
        cursor.execute("SELECT COUNT(*) AS c FROM notifications")
        notifications_total = int(cursor.fetchone()["c"])
        cursor.execute("SELECT COUNT(*) AS c FROM notifications WHERE COALESCE(is_read, 0) = 0")
        unread_notifications = int(cursor.fetchone()["c"])
        cursor.execute("SELECT COUNT(*) AS c FROM moderation_queue")
        moderation_queue_count = int(cursor.fetchone()["c"])
        cursor.execute("SELECT COUNT(*) AS c FROM ad_campaigns")
        campaigns_count = int(cursor.fetchone()["c"])
        cursor.execute("SELECT setting_key, setting_value FROM ad_settings")
        ad_rows = {row["setting_key"]: row["setting_value"] for row in cursor.fetchall()}
    return {
        "comments_count": comments_count,
        "likes_count": likes_count,
        "notifications_total": notifications_total,
        "unread_notifications_count": unread_notifications,
        "moderation_queue_count": moderation_queue_count,
        "campaigns_count": campaigns_count,
        "audit_logs_count": len([log for log in SYSTEM_LOGS if log.get("component") == "audit"]),
        "ads_enabled_count": sum(
            1 for key in ("in_feed_enabled", "sidebar_enabled", "interstitial_enabled", "ad_network_enabled")
            if str(ad_rows.get(key, "0")) in {"1", "true", "True"}
        ),
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


def load_local_ad_config() -> Dict[str, Any]:
    default_config = {
        "placements": {
            "in_feed": False,
            "sidebar": False,
            "interstitial": False,
        },
        "frequency": 5,
        "network_enabled": False,
        "network_tag": "",
    }
    try:
        if AD_CONFIG_FILE.exists():
            with AD_CONFIG_FILE.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            if isinstance(payload, dict):
                placements = payload.get("placements") if isinstance(payload.get("placements"), dict) else {}
                return {
                    "placements": {
                        "in_feed": bool(placements.get("in_feed", default_config["placements"]["in_feed"])),
                        "sidebar": bool(placements.get("sidebar", default_config["placements"]["sidebar"])),
                        "interstitial": bool(placements.get("interstitial", default_config["placements"]["interstitial"])),
                    },
                    "frequency": max(1, int(payload.get("frequency", default_config["frequency"]))),
                    "network_enabled": bool(payload.get("network_enabled", default_config["network_enabled"])),
                    "network_tag": str(payload.get("network_tag", default_config["network_tag"]) or ""),
                }
    except Exception as exc:
        logger.warning("Local ad config fallback failed: %s", exc)
    return default_config


def load_local_payment_config() -> Dict[str, Any]:
    default_config = {
        "card_enabled": True,
        "wallet_enabled": True,
        "crypto_enabled": True,
        "card_provider": "visa-or-psp",
        "wallet_provider": "internal-wallet",
        "crypto_provider": "onchain",
        "settlement_currency": "EUR",
        "wallet_topup_enabled": True,
        "supported_currencies": ["EUR", "USD", "BTC"],
    }
    try:
        if PAYMENT_CONFIG_FILE.exists():
            with PAYMENT_CONFIG_FILE.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            if isinstance(payload, dict):
                supported_currencies = payload.get("supported_currencies")
                return {
                    "card_enabled": bool(payload.get("card_enabled", default_config["card_enabled"])),
                    "wallet_enabled": bool(payload.get("wallet_enabled", default_config["wallet_enabled"])),
                    "crypto_enabled": bool(payload.get("crypto_enabled", default_config["crypto_enabled"])),
                    "card_provider": str(payload.get("card_provider", default_config["card_provider"]) or ""),
                    "wallet_provider": str(payload.get("wallet_provider", default_config["wallet_provider"]) or ""),
                    "crypto_provider": str(payload.get("crypto_provider", default_config["crypto_provider"]) or ""),
                    "settlement_currency": str(payload.get("settlement_currency", default_config["settlement_currency"]) or "EUR").upper(),
                    "wallet_topup_enabled": bool(payload.get("wallet_topup_enabled", default_config["wallet_topup_enabled"])),
                    "supported_currencies": [
                        str(item).upper()
                        for item in (supported_currencies if isinstance(supported_currencies, list) else default_config["supported_currencies"])
                        if str(item).strip()
                    ],
                }
    except Exception as exc:
        logger.warning("Local payment config fallback failed: %s", exc)
    return default_config


def load_local_homepage_config() -> Dict[str, Any]:
    default_config = {
        "title": "Tervetuloa YOSLA SOME LIFE",
        "subtitle": "Suomalainen some, jossa voit julkaista, keskustella ja rakentaa verkoston yhdessä paikassa.",
        "badge": "Suomalainen some",
        "hero_image_url": None,
        "hero_image_alt": "YOSLA SOME LIFE",
    }
    try:
        if HOMEPAGE_CONFIG_FILE.exists():
            with HOMEPAGE_CONFIG_FILE.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            if isinstance(payload, dict):
                return {
                    "title": str(payload.get("title", default_config["title"]) or default_config["title"]),
                    "subtitle": str(payload.get("subtitle", default_config["subtitle"]) or default_config["subtitle"]),
                    "badge": str(payload.get("badge", default_config["badge"]) or default_config["badge"]),
                    "hero_image_url": str(payload.get("hero_image_url") or "") or None,
                    "hero_image_alt": str(payload.get("hero_image_alt", default_config["hero_image_alt"]) or default_config["hero_image_alt"]),
                }
    except Exception as exc:
        logger.warning("Local homepage config fallback failed: %s", exc)
    return default_config


def _normalize_supported_currencies(raw: Any) -> List[str]:
    if isinstance(raw, list):
        return [str(item).upper() for item in raw if str(item).strip()]
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(item).upper() for item in parsed if str(item).strip()]
        except Exception:
            return [part.strip().upper() for part in raw.split(",") if part.strip()]
    return ["EUR", "USD", "BTC"]


def sqlite_get_payment_settings() -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT setting_key, setting_value FROM payment_settings")
        rows = {row["setting_key"]: row["setting_value"] for row in cursor.fetchall()}
    return {
        "card_enabled": rows.get("card_enabled", "1") in {"1", "true", "True"},
        "wallet_enabled": rows.get("wallet_enabled", "1") in {"1", "true", "True"},
        "crypto_enabled": rows.get("crypto_enabled", "1") in {"1", "true", "True"},
        "card_provider": rows.get("card_provider", "visa-or-psp"),
        "wallet_provider": rows.get("wallet_provider", "internal-wallet"),
        "crypto_provider": rows.get("crypto_provider", "onchain"),
        "settlement_currency": str(rows.get("settlement_currency", "EUR") or "EUR").upper(),
        "wallet_topup_enabled": rows.get("wallet_topup_enabled", "1") in {"1", "true", "True"},
        "supported_currencies": _normalize_supported_currencies(rows.get("supported_currencies", json.dumps(["EUR", "USD", "BTC"]))),
    }


def sqlite_update_payment_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        for key, value in settings.items():
            if key == "supported_currencies" and not isinstance(value, str):
                stored_value = json.dumps([str(item).upper() for item in value if str(item).strip()])
            elif isinstance(value, bool):
                stored_value = "1" if value else "0"
            else:
                stored_value = str(value)
            cursor.execute(
                "INSERT OR REPLACE INTO payment_settings (setting_key, setting_value) VALUES (?, ?)",
                (key, stored_value),
            )
        conn.commit()
    return sqlite_get_payment_settings()


def sqlite_get_public_payment_config() -> Dict[str, Any]:
    settings = sqlite_get_payment_settings()
    return {
        "card": {
            "enabled": settings["card_enabled"],
            "provider": settings["card_provider"],
        },
        "wallet": {
            "enabled": settings["wallet_enabled"],
            "provider": settings["wallet_provider"],
            "topup_enabled": settings["wallet_topup_enabled"],
        },
        "crypto": {
            "enabled": settings["crypto_enabled"],
            "provider": settings["crypto_provider"],
        },
        "settlement_currency": settings["settlement_currency"],
        "supported_currencies": settings["supported_currencies"],
        "payment_methods": [
            method for method, enabled in (
                ("card", settings["card_enabled"]),
                ("wallet", settings["wallet_enabled"]),
                ("crypto", settings["crypto_enabled"]),
            ) if enabled
        ],
        "updated_at": utc_iso_now(),
    }


def get_public_payment_config_fallback() -> Dict[str, Any]:
    if SQLITE_DB_PATH:
        try:
            return sqlite_get_public_payment_config()
        except Exception as exc:
            logger.warning("SQLite payment config fallback failed: %s", exc)
    return load_local_payment_config()


def sqlite_get_homepage_settings() -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT setting_key, setting_value FROM homepage_settings")
        rows = {row["setting_key"]: row["setting_value"] for row in cursor.fetchall()}
    return {
        "title": rows.get("title", "Tervetuloa YOSLA SOME LIFE"),
        "subtitle": rows.get("subtitle", "Suomalainen some, jossa voit julkaista, keskustella ja rakentaa verkoston yhdessä paikassa."),
        "badge": rows.get("badge", "Suomalainen some"),
        "hero_image_url": rows.get("hero_image_url") or None,
        "hero_image_alt": rows.get("hero_image_alt", "YOSLA SOME LIFE"),
    }


def sqlite_update_homepage_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        for key, value in settings.items():
            cursor.execute(
                "INSERT OR REPLACE INTO homepage_settings (setting_key, setting_value) VALUES (?, ?)",
                (key, str(value) if value is not None else ""),
            )
        conn.commit()
    return sqlite_get_homepage_settings()


def get_public_homepage_config_fallback() -> Dict[str, Any]:
    if SQLITE_DB_PATH:
        try:
            return sqlite_get_homepage_settings()
        except Exception as exc:
            logger.warning("SQLite homepage config fallback failed: %s", exc)
    return load_local_homepage_config()


def sqlite_create_payment_intent(intent: Dict[str, Any]) -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO payment_intents (
                payment_id, user_id, purpose, reference_type, reference_id, payment_method, amount, currency,
                status, provider, provider_reference, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                intent["payment_id"],
                intent.get("user_id"),
                intent.get("purpose", "ad_campaign"),
                intent.get("reference_type"),
                intent.get("reference_id"),
                intent.get("payment_method"),
                float(intent.get("amount") or 0),
                str(intent.get("currency") or "EUR").upper(),
                intent.get("status", "pending"),
                intent.get("provider"),
                intent.get("provider_reference"),
                json.dumps(intent.get("metadata") or {}),
                intent.get("created_at"),
                intent.get("updated_at"),
            ),
        )
        conn.commit()
    return intent


def sqlite_list_payment_intents(limit: int = 100) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT payment_id, user_id, purpose, reference_type, reference_id, payment_method, amount, currency,
                   status, provider, provider_reference, metadata, created_at, updated_at
            FROM payment_intents
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = []
        for row in cursor.fetchall():
            item = dict(row)
            item["metadata"] = json.loads(item["metadata"] or "{}")
            rows.append(item)
        return rows


def sqlite_update_payment_intent(payment_id: str, updates: Dict[str, Any]) -> bool:
    allowed_fields = {"status", "provider_reference", "updated_at", "metadata"}
    assignments = []
    values: List[Any] = []
    for key, value in updates.items():
        if key not in allowed_fields:
            continue
        assignments.append(f"{key} = ?")
        values.append(json.dumps(value) if key == "metadata" and not isinstance(value, str) else value)
    if not assignments:
        return False
    values.append(payment_id)
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE payment_intents SET {', '.join(assignments)} WHERE payment_id = ?",
            tuple(values),
        )
        conn.commit()
        return cursor.rowcount > 0


def sqlite_get_wallet_account(user_id: str) -> Dict[str, Any]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT wallet_id, user_id, currency, balance, updated_at FROM wallet_accounts WHERE user_id = ?",
            (user_id,),
        )
        row = cursor.fetchone()
        if row:
            return dict(row)
    return {
        "wallet_id": f"wallet_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "currency": "EUR",
        "balance": 0.0,
        "updated_at": utc_iso_now(),
    }


def sqlite_upsert_wallet_account(user_id: str, currency: str, balance: float) -> Dict[str, Any]:
    account = sqlite_get_wallet_account(user_id)
    wallet_id = account.get("wallet_id") or f"wallet_{uuid.uuid4().hex[:12]}"
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT OR REPLACE INTO wallet_accounts (wallet_id, user_id, currency, balance, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (wallet_id, user_id, currency.upper(), float(balance), utc_iso_now()),
        )
        conn.commit()
    return sqlite_get_wallet_account(user_id)


def sqlite_adjust_wallet_balance(user_id: str, amount: float, currency: str, reason: Optional[str], payment_id: Optional[str] = None, method: str = "wallet") -> Dict[str, Any]:
    account = sqlite_get_wallet_account(user_id)
    current_balance = float(account.get("balance") or 0)
    next_balance = current_balance + float(amount)
    updated = sqlite_upsert_wallet_account(user_id, currency, next_balance)
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO payment_ledger (
                ledger_id, payment_id, user_id, currency, amount, direction, method, status, reference_type,
                reference_id, created_at, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"ledger_{uuid.uuid4().hex[:12]}",
                payment_id,
                user_id,
                currency.upper(),
                float(amount),
                "credit" if amount >= 0 else "debit",
                method,
                "succeeded",
                "wallet",
                reason,
                utc_iso_now(),
                reason,
            ),
        )
        conn.commit()
    updated["balance"] = next_balance
    updated["currency"] = currency.upper()
    return updated


def sqlite_list_payment_ledger(limit: int = 100) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT ledger_id, payment_id, user_id, currency, amount, direction, method, status, reference_type,
                   reference_id, created_at, notes
            FROM payment_ledger
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]


def build_public_ad_config_from_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "placements": {
            "in_feed": bool(settings.get("in_feed_enabled", False)),
            "sidebar": bool(settings.get("sidebar_enabled", False)),
            "interstitial": bool(settings.get("interstitial_enabled", False)),
        },
        "frequency": max(1, int(settings.get("in_feed_frequency", 5))),
        "network_enabled": bool(settings.get("ad_network_enabled", False)),
        "network_tag": str(settings.get("ad_network_tag") or ""),
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


def get_public_ad_config_fallback() -> Dict[str, Any]:
    if SQLITE_DB_PATH:
        try:
            return sqlite_get_public_ad_config()
        except Exception as exc:
            logger.warning("SQLite ad config fallback failed: %s", exc)
    return load_local_ad_config()


def default_exchange_rate_map() -> Dict[str, float]:
    return {
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


def get_exchange_rate_map_sync() -> Dict[str, float]:
    rates = default_exchange_rate_map()
    if SQLITE_DB_PATH:
        try:
            rates.update({currency.upper(): rate for currency, rate in sqlite_get_exchange_rates().items()})
        except Exception:
            pass
    return rates


def convert_amount_between_currencies(amount: float, from_currency: str, to_currency: str, rates: Optional[Dict[str, float]] = None) -> float:
    normalized_rates = {key.upper(): float(value) for key, value in (rates or get_exchange_rate_map_sync()).items()}
    source = str(from_currency or "EUR").upper()
    target = str(to_currency or "EUR").upper()
    source_rate = normalized_rates.get(source, 1.0)
    target_rate = normalized_rates.get(target, 1.0)
    if target_rate <= 0:
        return float(amount)
    eur_value = float(amount) * source_rate
    return eur_value / target_rate


def payment_config_to_public_payload(settings: Dict[str, Any]) -> Dict[str, Any]:
    supported = settings.get("supported_currencies") or ["EUR", "USD", "BTC"]
    return {
        "card": {
            "enabled": bool(settings.get("card_enabled", True)),
            "provider": str(settings.get("card_provider") or "visa-or-psp"),
        },
        "wallet": {
            "enabled": bool(settings.get("wallet_enabled", True)),
            "provider": str(settings.get("wallet_provider") or "internal-wallet"),
            "topup_enabled": bool(settings.get("wallet_topup_enabled", True)),
        },
        "crypto": {
            "enabled": bool(settings.get("crypto_enabled", True)),
            "provider": str(settings.get("crypto_provider") or "onchain"),
        },
        "settlement_currency": str(settings.get("settlement_currency") or "EUR").upper(),
        "supported_currencies": [str(item).upper() for item in supported if str(item).strip()],
        "payment_methods": [
            method for method, enabled in (
                ("card", bool(settings.get("card_enabled", True))),
                ("wallet", bool(settings.get("wallet_enabled", True))),
                ("crypto", bool(settings.get("crypto_enabled", True))),
            ) if enabled
        ],
        "updated_at": utc_iso_now(),
    }


def sqlite_list_payment_summary() -> Dict[str, Any]:
    intents = sqlite_list_payment_intents()
    wallets = []
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT wallet_id, user_id, currency, balance, updated_at FROM wallet_accounts ORDER BY updated_at DESC LIMIT 50")
        wallets = [dict(row) for row in cursor.fetchall()]
    return {
        "intents_count": len(intents),
        "wallets_count": len(wallets),
        "wallet_balance_total": round(sum(float(item.get("balance") or 0) for item in wallets), 2),
        "recent_intents": intents[:10],
        "recent_wallets": wallets[:10],
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

def _create_mention_notification_payload(post: Dict[str, Any], target_user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "notification_id": f"notif_{uuid.uuid4().hex[:12]}",
        "user_id": target_user["user_id"],
        "actor_user_id": post.get("user_id"),
        "actor_username": post.get("username"),
        "actor_profile_picture": post.get("profile_picture"),
        "type": "user_mention",
        "post_id": post.get("post_id"),
        "comment_id": None,
        "created_at": utc_now(),
        "is_read": False,
    }

def _dispatch_mention_notifications(post: Dict[str, Any], mention_usernames: List[str]) -> None:
    usernames = [username for username in dict.fromkeys(mention_usernames) if username and username != post.get("username")]
    if not usernames:
        return
    if db is not None:
        async def _mongo_worker() -> None:
            for username in usernames:
                target_user = await db.users.find_one({"username": username}, {"_id": 0, "user_id": 1, "username": 1})
                if not target_user:
                    continue
                await db.notifications.insert_one(_create_mention_notification_payload(post, target_user))
        asyncio.create_task(_mongo_worker())
        return
    for username in usernames:
        target_user = get_sqlite_user_by_username(username)
        if not target_user:
            continue
        create_sqlite_notification(
            target_user["user_id"],
            {
                "user_id": post.get("user_id"),
                "username": post.get("username"),
                "profile_picture": post.get("profile_picture"),
            },
            "user_mention",
            post_id=post.get("post_id"),
        )

def increment_post_repost_count(post_id: str) -> None:
    if db is not None:
        async def _mongo() -> None:
            await db.posts.update_one({"post_id": post_id}, {"$inc": {"repost_count": 1}})
        asyncio.create_task(_mongo())
        return
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE posts SET repost_count = COALESCE(repost_count, 0) + 1 WHERE post_id = ?", (post_id,))
        conn.commit()

def normalize_post_payload(post: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(post)
    for field_name in ("keywords", "hashtags", "mentions"):
        value = normalized.get(field_name)
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                normalized[field_name] = parsed if isinstance(parsed, list) else []
            except Exception:
                normalized[field_name] = []
        elif value is None:
            normalized[field_name] = []
    normalized["is_nsfw"] = bool(normalized.get("is_nsfw", False))
    if normalized.get("video") is None:
        normalized["video"] = None
    return normalized

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

def parse_post_created_at(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except Exception:
            pass
    return utc_now()

def rank_posts_by_explicit_formula(posts: List[Dict[str, Any]], dwell_rows: List[Dict[str, Any]], explore_ratio: float = 0.2) -> List[Dict[str, Any]]:
    if not posts:
        return posts
    dwell_seconds_by_post: Dict[str, float] = {}
    for row in dwell_rows:
        post_id = str(row.get("post_id") or "")
        if not post_id:
            continue
        dwell_ms = float(row.get("dwell_ms") or 0)
        dwell_seconds_by_post[post_id] = dwell_seconds_by_post.get(post_id, 0.0) + max(0.0, dwell_ms / 1000.0)

    scored: List[tuple[float, Dict[str, Any]]] = []
    now = utc_now()
    for post in posts:
        created_at = parse_post_created_at(post.get("created_at"))
        age_hours = max((now - created_at).total_seconds() / 3600.0, 0.25)
        dwell_seconds = max(0.0, dwell_seconds_by_post.get(post.get("post_id", ""), 0.0))
        interaction_multiplier = 1.0 + (float(post.get("likes_count", 0) or 0) * 5.0) + (float(post.get("comments_count", 0) or 0) * 10.0)
        score = (dwell_seconds * interaction_multiplier) / (age_hours ** 1.5)
        scored.append((score, post))

    scored.sort(key=lambda item: item[0], reverse=True)
    ranked = [post for _, post in scored]
    if len(ranked) < 4:
        return ranked
    explore_ratio = max(0.0, min(0.4, float(explore_ratio)))
    explore_count = max(1, min(len(ranked) // 4, int(round(len(ranked) * explore_ratio)))) if ranked else 0
    if explore_count <= 0:
        return ranked
    explore_count = min(explore_count, len(ranked))
    explore_indices = set(random.sample(range(len(ranked)), explore_count))
    explore_bucket = [post for idx, post in enumerate(ranked) if idx in explore_indices]
    ranked_bucket = [post for idx, post in enumerate(ranked) if idx not in explore_indices]
    result: List[Dict[str, Any]] = []
    inject_every = max(1, len(ranked_bucket) // max(1, explore_count))
    explore_cursor = 0
    for index, post in enumerate(ranked_bucket):
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


async def annotate_posts_with_moderation_status(posts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not posts:
        return posts
    post_ids = [str(post.get("post_id") or "") for post in posts if post.get("post_id")]
    if not post_ids:
        return posts
    status_by_post_id: Dict[str, str] = {}
    if db is not None:
        queue_items = await db.moderation_queue.find(
            {"post_id": {"$in": post_ids}},
            {"_id": 0, "post_id": 1, "status": 1},
        ).to_list(length=None)
        for item in queue_items:
            post_id = str(item.get("post_id") or "")
            if post_id:
                status_by_post_id[post_id] = str(item.get("status") or "queued")
    else:
        for item in sqlite_get_moderation_queue(limit=200):
            post_id = str(item.get("post_id") or "")
            if post_id and post_id in post_ids:
                status_by_post_id[post_id] = str(item.get("status") or "queued")
    for post in posts:
        post_id = str(post.get("post_id") or "")
        if post_id in status_by_post_id:
            post["moderation_status"] = status_by_post_id[post_id]
    return posts

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
    user_posts = await db.posts.find({"user_id": user_id}, {"_id": 0, "post_id": 1, "image": 1, "video": 1, "repost_post_id": 1}).to_list(length=None)
    post_ids = [row["post_id"] for row in user_posts]
    repost_source_ids = [str(row.get("repost_post_id") or "") for row in user_posts if row.get("repost_post_id")]
    user_comments = await db.comments.find({"user_id": user_id}, {"_id": 0, "comment_id": 1}).to_list(length=None)
    user_comment_ids = [row["comment_id"] for row in user_comments]
    post_comments = await db.comments.find({"post_id": {"$in": post_ids}}, {"_id": 0, "comment_id": 1}).to_list(length=None) if post_ids else []
    post_comment_ids = [row["comment_id"] for row in post_comments]
    await db.likes.delete_many({"user_id": user_id})
    await db.follows.delete_many({"$or": [{"follower_id": user_id}, {"following_id": user_id}]})
    await db.blocks.delete_many({"$or": [{"user_id": user_id}, {"target_user_id": user_id}]})
    await db.mutes.delete_many({"$or": [{"user_id": user_id}, {"target_user_id": user_id}]})
    await db.community_memberships.delete_many({"user_id": user_id})
    await db.comments.delete_many({"user_id": user_id})
    await db.posts.delete_many({"user_id": user_id})
    if post_ids:
        await db.likes.delete_many({"post_id": {"$in": post_ids}})
        await db.comments.delete_many({"post_id": {"$in": post_ids}})
        await db.reports.delete_many({"target_id": {"$in": post_ids}})
        await db.dwell_events.delete_many({"post_id": {"$in": post_ids}})
        await db.notifications.delete_many({"post_id": {"$in": post_ids}})
        await db.moderation_queue.delete_many({"post_id": {"$in": post_ids}})
        await db.moderation_queue.delete_many({"target_id": {"$in": post_ids}})
    for source_post_id in repost_source_ids:
        await db.posts.update_one({"post_id": source_post_id}, {"$inc": {"repost_count": -1}})
    all_comment_ids = sorted(set(user_comment_ids + post_comment_ids))
    if all_comment_ids:
        await db.reports.delete_many({"target_id": {"$in": all_comment_ids}})
        await db.notifications.delete_many({"comment_id": {"$in": all_comment_ids}})
    await db.reports.delete_many({"user_id": user_id})
    await db.notifications.delete_many({"$or": [{"user_id": user_id}, {"actor_user_id": user_id}]})
    await db.moderation_offenses.delete_many({"user_id": user_id})
    await db.users.delete_one({"user_id": user_id})
    delete_upload_artifacts(user_posts)
    push_audit_log("user_deleted", user_id, details="mongo_soft_delete")


async def mongo_hard_delete_user(user_id: str) -> None:
    user_posts = await db.posts.find({"user_id": user_id}, {"_id": 0, "post_id": 1, "image": 1, "video": 1, "repost_post_id": 1}).to_list(length=None)
    post_ids = [row["post_id"] for row in user_posts]
    repost_source_ids = [str(row.get("repost_post_id") or "") for row in user_posts if row.get("repost_post_id")]
    user_comments = await db.comments.find({"user_id": user_id}, {"_id": 0, "comment_id": 1}).to_list(length=None)
    user_comment_ids = [row["comment_id"] for row in user_comments]
    post_comments = await db.comments.find({"post_id": {"$in": post_ids}}, {"_id": 0, "comment_id": 1}).to_list(length=None) if post_ids else []
    post_comment_ids = [row["comment_id"] for row in post_comments]
    await db.likes.delete_many({"user_id": user_id})
    await db.follows.delete_many({"$or": [{"follower_id": user_id}, {"following_id": user_id}]})
    await db.blocks.delete_many({"$or": [{"user_id": user_id}, {"target_user_id": user_id}]})
    await db.mutes.delete_many({"$or": [{"user_id": user_id}, {"target_user_id": user_id}]})
    await db.community_memberships.delete_many({"user_id": user_id})
    await db.comments.delete_many({"user_id": user_id})
    await db.posts.delete_many({"user_id": user_id})
    if post_ids:
        await db.likes.delete_many({"post_id": {"$in": post_ids}})
        await db.comments.delete_many({"post_id": {"$in": post_ids}})
        await db.reports.delete_many({"target_id": {"$in": post_ids}})
        await db.dwell_events.delete_many({"post_id": {"$in": post_ids}})
        await db.notifications.delete_many({"post_id": {"$in": post_ids}})
        await db.moderation_queue.delete_many({"post_id": {"$in": post_ids}})
        await db.moderation_queue.delete_many({"target_id": {"$in": post_ids}})
    for source_post_id in repost_source_ids:
        await db.posts.update_one({"post_id": source_post_id}, {"$inc": {"repost_count": -1}})
    all_comment_ids = sorted(set(user_comment_ids + post_comment_ids))
    if all_comment_ids:
        await db.reports.delete_many({"target_id": {"$in": all_comment_ids}})
        await db.notifications.delete_many({"comment_id": {"$in": all_comment_ids}})
    await db.reports.delete_many({"user_id": user_id})
    await db.notifications.delete_many({"$or": [{"user_id": user_id}, {"actor_user_id": user_id}]})
    await db.moderation_offenses.delete_many({"user_id": user_id})
    await db.users.delete_one({"user_id": user_id})
    delete_upload_artifacts(user_posts)
    push_audit_log("user_hard_deleted", user_id, details="mongo_hard_delete")

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
        hashtags_json = json.dumps(post.get("hashtags") or [])
        mentions_json = json.dumps(post.get("mentions") or [])
        cursor.execute(
            """
            INSERT INTO posts (
                post_id, user_id, username, profile_picture, text, image, video, repost_post_id, repost_count, likes_count, comments_count, created_at, keywords, hashtags, mentions, is_nsfw
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                post["post_id"],
                post["user_id"],
                post["username"],
                post.get("profile_picture"),
                post.get("text", ""),
                post.get("image"),
                post.get("video"),
                post.get("repost_post_id"),
                int(post.get("repost_count", 0) or 0),
                post.get("likes_count", 0),
                post.get("comments_count", 0),
                created_at,
                keywords_json,
                hashtags_json,
                mentions_json,
                int(bool(post.get("is_nsfw", False))),
            ),
        )
        cursor.execute(
            "UPDATE users SET posts_count = COALESCE(posts_count, 0) + 1 WHERE user_id = ?",
            (post["user_id"],),
        )
        conn.commit()


def get_sqlite_feed(skip: int = 0, limit: int = 20, user_ids: Optional[List[str]] = None, hide_nsfw: bool = False) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        if user_ids:
            placeholders = ",".join(["?"] * len(user_ids))
            nsfw_clause = " AND COALESCE(is_nsfw, 0) = 0" if hide_nsfw else ""
            cursor.execute(
                f"""
                SELECT post_id, user_id, username, profile_picture, text, image, video, repost_post_id, repost_count, likes_count, comments_count, created_at, is_nsfw
                , keywords, hashtags, mentions
                FROM posts
                WHERE user_id IN ({placeholders}){nsfw_clause}
                ORDER BY datetime(created_at) DESC
                LIMIT ? OFFSET ?
                """,
                tuple(user_ids) + (limit, skip),
            )
        else:
            nsfw_clause = "WHERE COALESCE(is_nsfw, 0) = 0" if hide_nsfw else ""
            cursor.execute(
                f"""
                SELECT post_id, user_id, username, profile_picture, text, image, video, repost_post_id, repost_count, likes_count, comments_count, created_at, is_nsfw
                , keywords, hashtags, mentions
                FROM posts
                {nsfw_clause}
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
            SELECT post_id, user_id, username, profile_picture, text, image, video, repost_post_id, repost_count, likes_count, comments_count, created_at, is_nsfw, keywords
            , hashtags, mentions
            FROM posts
            WHERE post_id = ?
            """,
            (post_id,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None

def get_sqlite_posts_by_user(user_id: str) -> List[Dict[str, Any]]:
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT post_id, image, video, repost_post_id
            FROM posts
            WHERE user_id = ?
            """,
            (user_id,),
        )
        return [dict(row) for row in cursor.fetchall()]


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
                user["role"] = normalize_role(user.get("role"))
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
            user["role"] = normalize_role(user.get("role"))
            
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
            user["role"] = normalize_role(user.get("role"))

            return user
    
    except jwt.JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as e:
        logger.error(f"Error in get_current_user: {str(e)}")
        raise HTTPException(status_code=401, detail="Authentication failed")


def parse_birth_date(date_text: str) -> datetime:
    value = str(date_text or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Date of birth is required")
    try:
        parsed = datetime.fromisoformat(value)
    except Exception:
        try:
            parsed = datetime.strptime(value, "%Y-%m-%d")
        except Exception:
            raise HTTPException(status_code=400, detail="Date of birth must be YYYY-MM-DD")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def calculate_age(date_of_birth: datetime) -> int:
    today = datetime.now(timezone.utc).date()
    dob = date_of_birth.date()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def is_user_adult(raw_user: Dict[str, Any]) -> bool:
    date_text = raw_user.get("date_of_birth")
    if not date_text:
        return True
    try:
        dob = parse_birth_date(str(date_text))
    except Exception:
        return True
    return calculate_age(dob) >= MINIMUM_SIGNUP_AGE

# =======================
# AUTH ENDPOINTS
# =======================

@api_router.post("/auth/register", response_model=AuthResponse)
async def register(user_data: UserRegister, request: Request):
    """Register a new user with email/password"""
    await ensure_request_ip_not_blacklisted(request)
    if not user_data.accept_terms or not user_data.accept_privacy:
        raise HTTPException(status_code=400, detail="Terms and privacy policy must be accepted")
    dob = parse_birth_date(user_data.date_of_birth)
    age = calculate_age(dob)
    if age < MINIMUM_SIGNUP_AGE:
        raise HTTPException(status_code=400, detail=f"Sign-up requires users to be at least {MINIMUM_SIGNUP_AGE} years old")
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
        "date_of_birth": dob.date().isoformat(),
        "age_verified_at": utc_now(),
        "role": "super_admin" if SUPER_ADMIN_EMAIL and user_data.email == SUPER_ADMIN_EMAIL else "user",
        "banned_until": None,
    }

    if db is not None:
        await db.users.insert_one(user)
    else:
        with get_sqlite_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO users (user_id, email, password_hash, username, profile_picture, bio, followers_count, following_count, posts_count, created_at, date_of_birth, age_verified_at, role, banned_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                    user["date_of_birth"],
                    user["age_verified_at"].isoformat(),
                    normalize_role(user["role"]),
                    None,
                )
            )
            conn.commit()
    
    # Create access token
    access_token = create_access_token(data={"sub": user_id, "role": user["role"]})
    
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
    access_token = create_access_token(data={"sub": user["user_id"], "role": user["role"]})
    
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
    video: Optional[UploadFile] = File(None),
    is_nsfw: bool = Form(False),
    authorization: Optional[str] = Header(None),
    request: Request = None
):
    """Create a new post. Accepts multipart/form-data with optional image or video file."""
    if request is not None:
        await ensure_request_ip_not_blacklisted(request)
    user = await get_current_user(authorization)
    ensure_not_banned(user)

    if (not text or not text.strip()) and image is None and video is None:
        raise HTTPException(status_code=400, detail="Post must contain text, an image, or a video")

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
            image_url = optimize_image_upload(contents, image, post_id)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error saving uploaded image: {e}")
            raise HTTPException(status_code=500, detail="Failed to save uploaded image")

    video_url = None
    if video is not None:
        try:
            contents = await video.read()
            video_url = transcode_video_upload(contents, video, post_id)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error saving uploaded video: {e}")
            raise HTTPException(status_code=500, detail="Failed to save uploaded video")

    post = {
        "post_id": post_id,
        "user_id": user["user_id"],
        "username": user["username"],
        "profile_picture": user.get("profile_picture"),
        "text": text.strip() if text else '',
        "image": image_url,
        "video": video_url,
        "hashtags": extract_hashtags_from_text(text or ""),
        "mentions": extract_mentions_from_text(text or ""),
        "likes_count": 0,
        "comments_count": 0,
        "is_nsfw": bool(is_nsfw),
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
            moderation_doc = {
                "moderation_id": f"mod_{uuid.uuid4().hex[:12]}",
                "target_type": "post",
                "target_id": post_id,
                "user_id": user["user_id"],
                "score": moderation.score,
                "status": "queued",
                "reason": moderation.reason or "needs-review",
                "created_at": utc_now(),
                "text": post["text"],
                "post_id": post_id,
            }
            await db.moderation_queue.insert_one(moderation_doc)
            push_audit_log(
                "content_flagged",
                post_id,
                actor_id=user["user_id"],
                details=json.dumps({"target_type": "post", "score": moderation.score, "reason": moderation.reason or "needs-review", "status": "queued", "storage": "mongodb"}),
            )
    else:
        if REPOSITORY_ADAPTER is not None:
            REPOSITORY_ADAPTER.create_post(post)
        else:
            create_sqlite_post(post)
        if moderation.queue:
            moderation_doc = {
                "moderation_id": f"mod_{uuid.uuid4().hex[:12]}",
                "target_type": "post",
                "target_id": post_id,
                "user_id": user["user_id"],
                "score": moderation.score,
                "status": "queued",
                "reason": moderation.reason or "needs-review",
                "created_at": utc_iso_now(),
                "text": post["text"],
                "post_id": post_id,
            }
            sqlite_queue_moderation_item(moderation_doc)
            push_audit_log(
                "content_flagged",
                post_id,
                actor_id=user["user_id"],
                details=json.dumps({"target_type": "post", "score": moderation.score, "reason": moderation.reason or "needs-review", "status": "queued", "storage": "sqlite"}),
            )

    _dispatch_mention_notifications(post, post.get("mentions") or [])
    post.pop("_id", None)
    return Post(**post, is_liked=False)

@api_router.post("/posts/{post_id}/repost", response_model=Post)
async def repost_post(
    post_id: str,
    text: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
    request: Request = None,
):
    if request is not None:
        await ensure_request_ip_not_blacklisted(request)
    user = await get_current_user(authorization)
    ensure_not_banned(user)

    if db is not None:
        source_post = await db.posts.find_one({"post_id": post_id}, {"_id": 0})
    else:
        source_post = get_sqlite_post(post_id)
    if not source_post:
        raise HTTPException(status_code=404, detail="Post not found")

    repost_id = f"post_{uuid.uuid4().hex[:12]}"
    repost_text = text.strip() if text and text.strip() else source_post.get("text", "")
    post = {
        "post_id": repost_id,
        "user_id": user["user_id"],
        "username": user["username"],
        "profile_picture": user.get("profile_picture"),
        "text": repost_text,
        "image": source_post.get("image"),
        "hashtags": list(source_post.get("hashtags") or []),
        "mentions": list(source_post.get("mentions") or []),
        "repost_post_id": post_id,
        "repost_count": 0,
        "likes_count": 0,
        "comments_count": 0,
        "created_at": datetime.now(timezone.utc),
        "keywords": extract_post_keywords(repost_text),
    }
    if db is not None:
        await db.posts.insert_one(post)
        await db.users.update_one({"user_id": user["user_id"]}, {"$inc": {"posts_count": 1}})
        await db.posts.update_one({"post_id": post_id}, {"$inc": {"repost_count": 1}})
    else:
        create_sqlite_post(post)
        increment_post_repost_count(post_id)
    post["is_online"] = bool((await get_user_presence_snapshot(user["user_id"], user["username"])).get("is_online"))
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
    hide_nsfw = not is_user_adult(current_user)
    
    if db is not None:
        muted = await db.mutes.find({"user_id": current_user["user_id"]}, {"target_user_id": 1, "_id": 0}).to_list(length=None)
        blocked = await db.blocks.find({"user_id": current_user["user_id"]}, {"target_user_id": 1, "_id": 0}).to_list(length=None)
        excluded_user_ids = {d["target_user_id"] for d in muted + blocked}

        filter_query: Dict[str, Any] = {}
        if hide_nsfw:
            filter_query["is_nsfw"] = {"$ne": True}
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
        dwell_rows: List[Dict[str, Any]] = []
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
                dwell_rows = [
                    {"post_id": dwell.get("post_id"), "dwell_ms": dwell.get("dwell_ms", 0)}
                    for dwell in recent_dwell
                ]
            affinity_keywords = collect_affinity_keywords_from_posts(posts, followed_ids + favorite_author_ids)
            posts = score_posts_by_author_affinity(posts, affinity_keywords)
        posts = score_posts_with_user_signals(posts, followed_ids, favorite_author_ids, current_user)
        posts = rank_posts_by_explicit_formula(posts, dwell_rows, explore_ratio=0.2)
        posts = await annotate_posts_with_moderation_status(posts)
    else:
        repo_posts = repository_get_feed(skip=skip, limit=limit, exclude_nsfw=hide_nsfw)
        if repo_posts is not None:
            posts = repo_posts
        else:
            excluded_user_ids = set(sqlite_related_user_ids("mutes", current_user["user_id"]) + sqlite_related_user_ids("blocks", current_user["user_id"]))
            feed_user_ids = None
            if following_only:
                feed_user_ids = list(set(sqlite_following_ids(current_user["user_id"]) + [current_user["user_id"]]))
                if excluded_user_ids:
                    feed_user_ids = [uid for uid in feed_user_ids if uid not in excluded_user_ids]
            posts = get_sqlite_feed(skip=skip, limit=limit, user_ids=feed_user_ids, hide_nsfw=hide_nsfw)
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
        with get_sqlite_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT post_id, dwell_time_ms
                FROM UserInteractions
                WHERE user_id = ? AND interaction_type = 'view'
                ORDER BY created_at DESC
                LIMIT 30
                """,
                (current_user["user_id"],),
            )
            dwell_rows = [dict(row) for row in cursor.fetchall()]
        affinity_keywords = collect_affinity_keywords_from_posts(posts, followed_ids + favorite_author_ids)
        posts = score_posts_by_author_affinity(posts, affinity_keywords)
        posts = score_posts_with_user_signals(posts, followed_ids, favorite_author_ids, current_user)
        posts = rank_posts_by_explicit_formula(posts, dwell_rows, explore_ratio=0.2)
        posts = await annotate_posts_with_moderation_status(posts)
    
    enriched_posts = []
    for post in posts:
        post = normalize_post_payload(post)
        presence = await get_user_presence_snapshot(str(post.get("user_id") or ""), str(post.get("username") or ""))
        post["is_online"] = bool(presence.get("is_online"))
        enriched_posts.append(Post(**post))
    return enriched_posts

@api_router.get("/posts/{post_id}", response_model=Post)
async def get_post(
    post_id: str,
    authorization: Optional[str] = Header(None)
):
    """Get a specific post"""
    current_user = await get_current_user(authorization)
    if db is not None:
        post = await db.posts.find_one({"post_id": post_id}, {"_id": 0})
        like = await db.likes.find_one({
            "post_id": post_id,
            "user_id": current_user["user_id"]
        })
    else:
        post = get_sqlite_post(post_id)
        like = None
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    post = normalize_post_payload(post)
    if not is_user_adult(current_user) and bool(post.get("is_nsfw")):
        raise HTTPException(status_code=403, detail="Content restricted")
    post["is_liked"] = like is not None
    post["is_online"] = bool((await get_user_presence_snapshot(str(post.get("user_id") or ""), str(post.get("username") or ""))).get("is_online"))
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
            moderation_doc = {
                "moderation_id": f"mod_{uuid.uuid4().hex[:12]}",
                "target_type": "comment",
                "target_id": comment_id,
                "user_id": user["user_id"],
                "score": moderation.score,
                "status": "queued",
                "reason": moderation.reason or "needs-review",
                "created_at": utc_now(),
                "text": text,
                "post_id": post_id,
            }
            await db.moderation_queue.insert_one(moderation_doc)
            push_audit_log(
                "content_flagged",
                comment_id,
                actor_id=user["user_id"],
                details=json.dumps({"target_type": "comment", "score": moderation.score, "reason": moderation.reason or "needs-review", "status": "queued", "storage": "mongodb"}),
            )
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
        comment["is_online"] = bool((await get_user_presence_snapshot(str(comment.get("user_id") or ""), str(comment.get("username") or ""))).get("is_online"))
        return Comment(**comment)
    else:
        post = get_sqlite_post(post_id)
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        comment = create_sqlite_comment(post_id, user, text)
        if moderation.queue:
            moderation_doc = {
                "moderation_id": f"mod_{uuid.uuid4().hex[:12]}",
                "target_type": "comment",
                "target_id": comment["comment_id"],
                "user_id": user["user_id"],
                "score": moderation.score,
                "status": "queued",
                "reason": moderation.reason or "needs-review",
                "created_at": utc_iso_now(),
                "text": text,
                "post_id": post_id,
            }
            sqlite_queue_moderation_item(moderation_doc)
            push_audit_log(
                "content_flagged",
                comment["comment_id"],
                actor_id=user["user_id"],
                details=json.dumps({"target_type": "comment", "score": moderation.score, "reason": moderation.reason or "needs-review", "status": "queued", "storage": "sqlite"}),
            )
        if post["user_id"] != user["user_id"]:
            create_sqlite_notification(
                user_id=post["user_id"],
                actor=user,
                notification_type="post_comment",
                post_id=post_id,
                comment_id=comment["comment_id"],
            )
        comment["is_online"] = bool((await get_user_presence_snapshot(str(comment.get("user_id") or ""), str(comment.get("username") or ""))).get("is_online"))
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
    enriched_comments = []
    for comment in comments:
        comment["is_online"] = bool((await get_user_presence_snapshot(str(comment.get("user_id") or ""), str(comment.get("username") or ""))).get("is_online"))
        enriched_comments.append(Comment(**comment))
    return enriched_comments


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
        payment_intents_count = await db.payment_intents.count_documents({})
        wallet_accounts = await db.wallet_accounts.find({}, {"_id": 0, "balance": 1}).to_list(length=None)
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
            "payment_intents_count": payment_intents_count,
            "wallet_balance_total": round(sum(float(item.get("balance") or 0) for item in wallet_accounts), 2),
            "ad_revenue_eur": round(ad_total_eur, 2),
            "exchange_rates": rates,
        }
    return sqlite_get_finance_snapshot()


@api_router.get("/payments/config")
async def get_public_payment_config():
    if db is not None:
        doc = await db.payment_settings.find_one({"settings_id": "default"}, {"_id": 0})
        if doc and isinstance(doc.get("value"), dict):
            return payment_config_to_public_payload(doc["value"])
    return get_public_payment_config_fallback()


@api_router.get("/homepage/config")
async def get_public_homepage_config():
    if db is not None:
        doc = await db.homepage_settings.find_one({"settings_id": "default"}, {"_id": 0})
        if doc and isinstance(doc.get("value"), dict):
            return doc["value"]
    return get_public_homepage_config_fallback()


@api_router.get("/admin/homepage/config")
async def get_homepage_settings(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        doc = await db.homepage_settings.find_one({"settings_id": "default"}, {"_id": 0})
        return doc.get("value", HomepageSettings().model_dump()) if doc else HomepageSettings().model_dump()
    return sqlite_get_homepage_settings()


@api_router.put("/admin/homepage/config")
async def update_homepage_settings(payload: HomepageSettings, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    value = payload.model_dump()
    if db is not None:
        await db.homepage_settings.update_one(
            {"settings_id": "default"},
            {"$set": {"settings_id": "default", "value": value, "updated_at": utc_iso_now()}},
            upsert=True,
        )
        push_audit_log("homepage_settings_updated", "default", actor_id=user["user_id"], details=json.dumps({"storage": "mongodb", "value": value}))
        return value
    push_audit_log("homepage_settings_updated", "default", actor_id=user["user_id"], details=json.dumps({"storage": "sqlite", "value": value}))
    return sqlite_update_homepage_settings(value)


@api_router.post("/admin/homepage/hero-image")
async def upload_homepage_hero_image(
    image: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    suffix = Path(image.filename or "").suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"}:
        suffix = ".jpg"
    filename = f"homepage_{uuid.uuid4().hex[:12]}{suffix}"
    file_path = uploads_dir / filename
    content = await image.read()
    file_path.write_bytes(content)
    image_url = f"/uploads/{filename}"
    push_audit_log("homepage_image_uploaded", filename, actor_id=user["user_id"], details=json.dumps({"image_url": image_url}))
    return {"image_url": image_url, "filename": filename}


@api_router.get("/admin/payments/config")
async def get_payment_settings(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        doc = await db.payment_settings.find_one({"settings_id": "default"}, {"_id": 0})
        return doc.get("value", PaymentSettings().model_dump()) if doc else PaymentSettings().model_dump()
    return sqlite_get_payment_settings()


@api_router.put("/admin/payments/config")
async def update_payment_settings(payload: PaymentSettingsUpdate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    value = payload.model_dump()
    value["supported_currencies"] = [str(item).upper() for item in value.get("supported_currencies") or [] if str(item).strip()]
    if db is not None:
        await db.payment_settings.update_one(
            {"settings_id": "default"},
            {"$set": {"settings_id": "default", "value": value, "updated_at": utc_iso_now()}},
            upsert=True,
        )
        push_audit_log("payment_settings_updated", "default", actor_id=user["user_id"], details=json.dumps({"storage": "mongodb", "value": value}))
        return value
    push_audit_log("payment_settings_updated", "default", actor_id=user["user_id"], details=json.dumps({"storage": "sqlite", "value": value}))
    return sqlite_update_payment_settings(value)


@api_router.get("/admin/payments/summary")
async def get_payment_summary(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        intents = await db.payment_intents.find({}, {"_id": 0}).sort("created_at", -1).to_list(length=100)
        wallets = await db.wallet_accounts.find({}, {"_id": 0}).sort("updated_at", -1).to_list(length=100)
        return {
            "intents_count": len(intents),
            "wallets_count": len(wallets),
            "wallet_balance_total": round(sum(float(item.get("balance") or 0) for item in wallets), 2),
            "recent_intents": intents[:10],
            "recent_wallets": wallets[:10],
        }
    return sqlite_list_payment_summary()


@api_router.get("/admin/payments/intents")
async def list_payment_intents(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        rows = await db.payment_intents.find({}, {"_id": 0}).sort("created_at", -1).to_list(length=100)
        return rows
    return sqlite_list_payment_intents()


@api_router.post("/admin/payments/intents")
async def create_payment_intent(payload: PaymentIntentCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    settings = await get_payment_settings(authorization)
    method = payload.payment_method.value if isinstance(payload.payment_method, PaymentMethodKind) else str(payload.payment_method)
    method = method.lower()
    amount = max(0.0, float(payload.amount))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    currency = str(payload.currency or settings.get("settlement_currency") or "EUR").upper()
    if currency not in set(settings.get("supported_currencies") or [currency]):
        raise HTTPException(status_code=400, detail="Currency not supported")
    payment_id = f"pay_{uuid.uuid4().hex[:12]}"
    status = "pending"
    provider_reference = None
    provider = str(payload.provider or (
        settings.get("card_provider") if method == "card"
        else settings.get("wallet_provider") if method == "wallet"
        else settings.get("crypto_provider") if method == "crypto"
        else "unknown"
    ) or "unknown")
    reference_type = str(payload.reference_type or payload.purpose or "ad_campaign")
    if reference_type == "wallet_topup" and not payload.user_id:
        raise HTTPException(status_code=400, detail="user_id is required for wallet top-up payments")
    settlement_currency = str(settings.get("settlement_currency") or "EUR").upper()
    rates = get_exchange_rate_map_sync()
    settlement_amount = convert_amount_between_currencies(amount, currency, settlement_currency, rates)
    metadata = payload.metadata or {}

    if method == "card":
        if not settings.get("card_enabled", True):
            raise HTTPException(status_code=400, detail="Card payments are disabled")
        status = "succeeded"
        provider_reference = f"card_{payment_id}_mock"
        if reference_type == "wallet_topup" and payload.user_id:
            if db is not None:
                wallet = await db.wallet_accounts.find_one({"user_id": payload.user_id}, {"_id": 0}) or {}
                balance = float(wallet.get("balance") or 0)
                next_balance = balance + settlement_amount
                await db.wallet_accounts.update_one(
                    {"user_id": payload.user_id},
                    {
                        "$set": {
                            "wallet_id": wallet.get("wallet_id") or f"wallet_{uuid.uuid4().hex[:12]}",
                            "user_id": payload.user_id,
                            "currency": settlement_currency,
                            "balance": round(next_balance, 2),
                            "updated_at": utc_iso_now(),
                        }
                    },
                    upsert=True,
                )
                await db.payment_ledger.insert_one({
                    "ledger_id": f"ledger_{uuid.uuid4().hex[:12]}",
                    "payment_id": payment_id,
                    "user_id": payload.user_id,
                    "currency": settlement_currency,
                    "amount": round(settlement_amount, 2),
                    "direction": "credit",
                    "method": method,
                    "status": status,
                    "reference_type": reference_type,
                    "reference_id": payload.reference_id,
                    "created_at": utc_iso_now(),
                    "notes": payload.metadata or {},
                })
            else:
                sqlite_adjust_wallet_balance(payload.user_id, settlement_amount, settlement_currency, payload.reference_id or payload.purpose, payment_id=payment_id, method=method)
    elif method == "wallet":
        if not settings.get("wallet_enabled", True):
            raise HTTPException(status_code=400, detail="Wallet payments are disabled")
        if not payload.user_id:
            raise HTTPException(status_code=400, detail="user_id is required for wallet payments")
        wallet_balance = 0.0
        if db is not None:
            wallet = await db.wallet_accounts.find_one({"user_id": payload.user_id}, {"_id": 0}) or {}
            wallet_balance = float(wallet.get("balance") or 0)
        else:
            wallet = sqlite_get_wallet_account(payload.user_id)
            wallet_balance = float(wallet.get("balance") or 0)
        if wallet_balance < settlement_amount:
            raise HTTPException(status_code=402, detail="Insufficient wallet balance")
        status = "succeeded"
        provider_reference = f"wallet_{payment_id}_debit"
        if db is not None:
            await db.wallet_accounts.update_one(
                {"user_id": payload.user_id},
                {
                    "$set": {
                        "wallet_id": wallet.get("wallet_id") or f"wallet_{uuid.uuid4().hex[:12]}",
                        "user_id": payload.user_id,
                        "currency": settlement_currency,
                        "balance": round(wallet_balance - settlement_amount, 2),
                        "updated_at": utc_iso_now(),
                    }
                },
                upsert=True,
            )
            await db.payment_ledger.insert_one({
                "ledger_id": f"ledger_{uuid.uuid4().hex[:12]}",
                "payment_id": payment_id,
                "user_id": payload.user_id,
                "currency": settlement_currency,
                "amount": round(settlement_amount, 2),
                "direction": "debit",
                "method": method,
                "status": status,
                "reference_type": reference_type,
                "reference_id": payload.reference_id,
                "created_at": utc_iso_now(),
                "notes": payload.metadata or {},
            })
        else:
            sqlite_adjust_wallet_balance(payload.user_id, -settlement_amount, settlement_currency, payload.reference_id or payload.purpose, payment_id=payment_id, method=method)
    elif method == "crypto":
        if not settings.get("crypto_enabled", True):
            raise HTTPException(status_code=400, detail="Crypto payments are disabled")
        status = "pending_confirmation"
        provider_reference = f"tx_{payment_id}_pending"
    else:
        raise HTTPException(status_code=400, detail="Unsupported payment method")

    intent = {
        "payment_id": payment_id,
        "user_id": payload.user_id,
        "purpose": payload.purpose,
        "reference_type": reference_type,
        "reference_id": payload.reference_id,
        "payment_method": method,
        "amount": round(amount, 2),
        "currency": currency,
        "status": status,
        "provider": provider,
        "provider_reference": provider_reference,
        "metadata": metadata,
        "created_at": utc_iso_now(),
        "updated_at": utc_iso_now(),
    }
    if db is not None:
        await db.payment_intents.insert_one(intent)
        return intent
    return sqlite_create_payment_intent(intent)


@api_router.post("/admin/payments/intents/{payment_id}/confirm")
async def confirm_payment_intent(payment_id: str, payload: PaymentIntentUpdate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        intent = await db.payment_intents.find_one({"payment_id": payment_id}, {"_id": 0})
        if not intent:
            raise HTTPException(status_code=404, detail="Payment intent not found")
        update_fields = {
            "status": payload.status,
            "provider_reference": payload.provider_reference or intent.get("provider_reference"),
            "updated_at": utc_iso_now(),
        }
        if payload.notes:
            update_fields["metadata"] = {**(intent.get("metadata") or {}), "notes": payload.notes}
        await db.payment_intents.update_one({"payment_id": payment_id}, {"$set": update_fields})
        if str(intent.get("payment_method")) == "crypto" and str(payload.status).lower() in {"succeeded", "paid", "completed"}:
            wallet_user_id = intent.get("user_id")
            if wallet_user_id:
                rates = default_exchange_rate_map()
                settlement_currency = "EUR"
                settlement_amount = convert_amount_between_currencies(float(intent.get("amount") or 0), str(intent.get("currency") or "EUR"), settlement_currency, rates)
                wallet = await db.wallet_accounts.find_one({"user_id": wallet_user_id}, {"_id": 0}) or {}
                balance = float(wallet.get("balance") or 0)
                await db.wallet_accounts.update_one(
                    {"user_id": wallet_user_id},
                    {
                        "$set": {
                            "wallet_id": wallet.get("wallet_id") or f"wallet_{uuid.uuid4().hex[:12]}",
                            "user_id": wallet_user_id,
                            "currency": settlement_currency,
                            "balance": round(balance + settlement_amount, 2),
                            "updated_at": utc_iso_now(),
                        }
                    },
                    upsert=True,
                )
        push_audit_log("payment_intent_confirmed", payment_id, actor_id=user["user_id"], details=json.dumps({"status": payload.status, "storage": "mongodb"}))
        return {"payment_id": payment_id, "status": payload.status}
    updated = sqlite_update_payment_intent(payment_id, {
        "status": payload.status,
        "provider_reference": payload.provider_reference,
        "metadata": {"notes": payload.notes} if payload.notes else {},
        "updated_at": utc_iso_now(),
    })
    if not updated:
        raise HTTPException(status_code=404, detail="Payment intent not found")
    intent_rows = [item for item in sqlite_list_payment_intents(limit=1000) if item["payment_id"] == payment_id]
    if not intent_rows:
        raise HTTPException(status_code=404, detail="Payment intent not found")
    intent = intent_rows[0]
    if intent.get("payment_method") == "crypto" and str(payload.status).lower() in {"succeeded", "paid", "completed"} and intent.get("user_id"):
        rates = get_exchange_rate_map_sync()
        settlement_currency = "EUR"
        settlement_amount = convert_amount_between_currencies(float(intent.get("amount") or 0), str(intent.get("currency") or "EUR"), settlement_currency, rates)
        sqlite_adjust_wallet_balance(str(intent["user_id"]), settlement_amount, settlement_currency, intent.get("reference_id") or intent.get("purpose"), payment_id=payment_id, method="crypto")
    push_audit_log("payment_intent_confirmed", payment_id, actor_id=user["user_id"], details=json.dumps({"status": payload.status, "storage": "sqlite"}))
    return {"payment_id": payment_id, "status": payload.status}


@api_router.get("/admin/payments/wallets/{wallet_user_id}")
async def get_payment_wallet(wallet_user_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        wallet = await db.wallet_accounts.find_one({"user_id": wallet_user_id}, {"_id": 0})
        if not wallet:
            wallet = {
                "wallet_id": f"wallet_{uuid.uuid4().hex[:12]}",
                "user_id": wallet_user_id,
                "currency": "EUR",
                "balance": 0.0,
                "updated_at": utc_iso_now(),
            }
        ledger = await db.payment_ledger.find({"user_id": wallet_user_id}, {"_id": 0}).sort("created_at", -1).to_list(length=50)
        return {"wallet": wallet, "ledger": ledger}
    wallet = sqlite_get_wallet_account(wallet_user_id)
    ledger = [item for item in sqlite_list_payment_ledger(limit=50) if item.get("user_id") == wallet_user_id]
    return {"wallet": wallet, "ledger": ledger}


@api_router.post("/admin/payments/wallets/{wallet_user_id}/adjust")
async def adjust_payment_wallet(wallet_user_id: str, payload: WalletAdjustRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    amount = float(payload.amount)
    if amount == 0:
        raise HTTPException(status_code=400, detail="Amount cannot be zero")
    currency = str(payload.currency or "EUR").upper()
    rates = get_exchange_rate_map_sync()
    settlement_amount = convert_amount_between_currencies(amount, currency, "EUR", rates)
    if db is not None:
        wallet = await db.wallet_accounts.find_one({"user_id": wallet_user_id}, {"_id": 0}) or {}
        balance = float(wallet.get("balance") or 0)
        next_balance = balance + settlement_amount
        await db.wallet_accounts.update_one(
            {"user_id": wallet_user_id},
            {
                "$set": {
                    "wallet_id": wallet.get("wallet_id") or f"wallet_{uuid.uuid4().hex[:12]}",
                    "user_id": wallet_user_id,
                    "currency": "EUR",
                    "balance": round(next_balance, 2),
                    "updated_at": utc_iso_now(),
                }
            },
            upsert=True,
        )
        await db.payment_ledger.insert_one({
            "ledger_id": f"ledger_{uuid.uuid4().hex[:12]}",
            "payment_id": None,
            "user_id": wallet_user_id,
            "currency": "EUR",
            "amount": round(settlement_amount, 2),
            "direction": "credit" if settlement_amount >= 0 else "debit",
            "method": "admin_adjustment",
            "status": "succeeded",
            "reference_type": "wallet_adjustment",
            "reference_id": None,
            "created_at": utc_iso_now(),
            "notes": payload.reason or "Admin adjustment",
        })
        push_audit_log("wallet_adjusted", wallet_user_id, actor_id=user["user_id"], details=json.dumps({"amount": amount, "currency": currency, "storage": "mongodb"}))
        return {"wallet": {"user_id": wallet_user_id, "currency": "EUR", "balance": round(next_balance, 2)}}
    wallet = sqlite_adjust_wallet_balance(wallet_user_id, settlement_amount, "EUR", payload.reason or "Admin adjustment", method="admin_adjustment")
    push_audit_log("wallet_adjusted", wallet_user_id, actor_id=user["user_id"], details=json.dumps({"amount": amount, "currency": currency, "storage": "sqlite"}))
    return {"wallet": wallet}


@api_router.get("/admin/system-overview")
async def get_system_overview(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        posts_count = await db.posts.count_documents({})
        comments_count = await db.comments.count_documents({})
        likes_count = await db.likes.count_documents({})
        notifications_total = await db.notifications.count_documents({})
        unread_notifications = await db.notifications.count_documents({"is_read": {"$ne": True}})
        moderation_queue_count = await db.moderation_queue.count_documents({})
        campaigns_count = await db.ad_campaigns.count_documents({})
        ad_settings_doc = await db.ad_settings.find_one({"settings_id": "default"}, {"_id": 0})
        ad_settings_value = (ad_settings_doc or {}).get("value", {}) if ad_settings_doc else {}
        presence = await get_message_presence_telemetry()
        return {
            "posts_count": posts_count,
            "comments_count": comments_count,
            "likes_count": likes_count,
            "notifications_total": notifications_total,
            "unread_notifications_count": unread_notifications,
            "moderation_queue_count": moderation_queue_count,
            "campaigns_count": campaigns_count,
            "audit_logs_count": len([log for log in SYSTEM_LOGS if log.get("component") == "audit"]),
            "system_logs_count": len(SYSTEM_LOGS),
            "ads_enabled_count": sum(
                1 for key in ("in_feed_enabled", "sidebar_enabled", "interstitial_enabled", "ad_network_enabled")
                if bool(ad_settings_value.get(key, False))
            ),
            "online_users_count": int(presence.get("online_users_rows") or 0),
            "active_typing_count": int(presence.get("active_typing_rows") or 0),
            "stale_presence_count": int(presence.get("stale_presence_rows_estimate") or 0),
            "storage": presence.get("storage"),
            "updated_at": utc_iso_now(),
        }
    if SQLITE_DB_PATH:
        snapshot = sqlite_get_system_overview_snapshot()
        presence = await get_message_presence_telemetry()
        snapshot.update({
            "system_logs_count": len(SYSTEM_LOGS),
            "online_users_count": int(presence.get("online_users_rows") or 0),
            "active_typing_count": int(presence.get("active_typing_rows") or 0),
            "stale_presence_count": int(presence.get("stale_presence_rows_estimate") or 0),
            "storage": presence.get("storage"),
            "updated_at": utc_iso_now(),
        })
        return snapshot
    presence = await get_message_presence_telemetry()
    return {
        "posts_count": 0,
        "comments_count": 0,
        "likes_count": 0,
        "notifications_total": 0,
        "unread_notifications_count": 0,
        "moderation_queue_count": 0,
        "campaigns_count": 0,
        "audit_logs_count": len([log for log in SYSTEM_LOGS if log.get("component") == "audit"]),
        "system_logs_count": len(SYSTEM_LOGS),
        "ads_enabled_count": 0,
        "online_users_count": int(presence.get("online_users_rows") or 0),
        "active_typing_count": int(presence.get("active_typing_rows") or 0),
        "stale_presence_count": int(presence.get("stale_presence_rows_estimate") or 0),
        "storage": presence.get("storage"),
        "updated_at": utc_iso_now(),
    }


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
    ensure_moderator_access(user)
    if db is not None:
        queue = await db.moderation_queue.find({}, {"_id": 0}).sort("created_at", -1).to_list(length=100)
        for item in queue:
            item["author_presence"] = await get_user_presence_snapshot(str(item.get("user_id") or ""), str(item.get("username") or ""))
            post_id = str(item.get("post_id") or "")
            if post_id:
                item["post_summary"] = sqlite_get_post_summary(post_id)
        return queue
    repo_queue = repository_get_moderation_queue()
    if repo_queue is not None:
        for item in repo_queue:
            item["author_presence"] = await get_user_presence_snapshot(str(item.get("user_id") or ""), str(item.get("username") or ""))
            post_id = str(item.get("post_id") or "")
            if post_id:
                item["post_summary"] = sqlite_get_post_summary(post_id)
        return repo_queue
    queue = sqlite_get_moderation_queue()
    for item in queue:
        item["author_presence"] = await get_user_presence_snapshot(str(item.get("user_id") or ""), str(item.get("username") or ""))
        post_id = str(item.get("post_id") or "")
        if post_id:
            item["post_summary"] = sqlite_get_post_summary(post_id)
    return queue


@api_router.post("/admin/moderation-queue/{moderation_id}/action")
async def resolve_moderation_queue_item(
    moderation_id: str,
    decision: ModerationDecision,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    ensure_moderator_access(user)
    next_status = "approved" if decision.action.lower() == "approve" else "rejected" if decision.action.lower() in {"reject", "dismiss"} else "resolved"
    if db is not None:
        result = await db.moderation_queue.update_one(
            {"moderation_id": moderation_id},
            {"$set": {"status": next_status, "reviewed_at": utc_now(), "reviewed_by": user["user_id"], "reviewed_reason": decision.reviewed_reason or decision.reason, "reviewed_reason_tags": decision.reason_tags, "reviewed_reason_custom": decision.reason_custom}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Moderation item not found")
        push_audit_log(
            "moderation_queue_resolved",
            moderation_id,
            actor_id=user["user_id"],
            details=json.dumps({
                "status": next_status,
                "decision": decision.action,
                "reviewed_reason": decision.reviewed_reason or decision.reason,
                "reason_tags": decision.reason_tags,
                "reason_custom": decision.reason_custom,
                "storage": "mongodb",
            }),
        )
        return {"moderation_id": moderation_id, "status": next_status}
    with get_sqlite_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE moderation_queue SET status = ?, reviewed_at = ?, reviewed_by = ?, reviewed_reason = ?, reviewed_reason_tags = ?, reviewed_reason_custom = ? WHERE moderation_id = ?",
            (next_status, utc_iso_now(), user["user_id"], decision.reviewed_reason or decision.reason, json.dumps(decision.reason_tags), decision.reason_custom, moderation_id),
        )
        conn.commit()
        updated = cursor.rowcount > 0
    if not updated:
        raise HTTPException(status_code=404, detail="Moderation item not found")
    push_audit_log(
        "moderation_queue_resolved",
        moderation_id,
        actor_id=user["user_id"],
        details=json.dumps({
            "status": next_status,
            "decision": decision.action,
            "reviewed_reason": decision.reviewed_reason or decision.reason,
            "reason_tags": decision.reason_tags,
            "reason_custom": decision.reason_custom,
            "storage": "sqlite",
        }),
    )
    return {"moderation_id": moderation_id, "status": next_status}


@api_router.get("/admin/moderation-history")
async def get_moderation_history(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_moderator_access(user)
    if db is not None:
        history = await db.moderation_queue.find(
            {"status": {"$ne": "pending"}},
            {"_id": 0},
        ).sort("created_at", -1).to_list(length=100)
        post_ids = [item.get("post_id") for item in history if item.get("post_id")]
        post_summaries: Dict[str, Dict[str, Any]] = {}
        if post_ids:
          posts = await db.posts.find({"post_id": {"$in": post_ids}}, {"_id": 0, "post_id": 1, "username": 1, "text": 1}).to_list(length=None)
          post_summaries = {
              post["post_id"]: {
                  "post_id": post["post_id"],
                  "username": post.get("username"),
                  "text": str(post.get("text", "") or "")[:160],
              }
              for post in posts
          }
        enriched_history = []
        for item in history:
            post_summary = post_summaries.get(item.get("post_id"))
            if post_summary:
                item["post_summary"] = post_summary
            enriched_history.append(item)
        return enriched_history
    repo_queue = repository_get_moderation_queue()
    if repo_queue is not None:
        history = [item for item in repo_queue if str(item.get("status", "")).lower() != "pending"]
        for item in history:
            if item.get("post_id"):
                item["post_summary"] = sqlite_get_post_summary(str(item["post_id"]))
        return history
    history = sqlite_get_moderation_history()
    for item in history:
        if item.get("post_id"):
            item["post_summary"] = sqlite_get_post_summary(str(item["post_id"]))
    return history


@api_router.put("/admin/users/{target_user_id}/role")
async def update_user_role(
    target_user_id: str,
    role_update: RoleUpdate,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    role = normalize_role(role_update.role)
    if role == "super_admin" and not SUPER_ADMIN_EMAIL:
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
    push_audit_log(
        "user_role_updated",
        target_user_id,
        actor_id=user["user_id"],
        details=json.dumps({"role": role}),
    )
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
        push_audit_log("user_deleted", target_user_id, actor_id=user["user_id"], details="admin_delete_mongo")
    else:
        existing = get_sqlite_user_by_id(target_user_id)
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")
        sqlite_soft_delete_user(target_user_id, client_ip=normalize_ip(get_client_ip(request)))
        push_audit_log("user_deleted", target_user_id, actor_id=user["user_id"], details="admin_delete_sqlite")
    return {"message": "User removed", "user_id": target_user_id, "mode": "nuke"}


@api_router.delete("/admin/users/{target_user_id}/hard-delete")
async def hard_delete_user_admin(
    target_user_id: str,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    if db is not None:
        existing = await db.users.find_one({"user_id": target_user_id})
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")
        await mongo_hard_delete_user(target_user_id)
        push_audit_log("user_hard_deleted", target_user_id, actor_id=user["user_id"], details="admin_hard_delete_mongo")
    else:
        existing = get_sqlite_user_by_id(target_user_id)
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")
        sqlite_hard_delete_user(target_user_id)
        push_audit_log("user_hard_deleted", target_user_id, actor_id=user["user_id"], details="admin_hard_delete_sqlite")
    return {"message": "User permanently removed", "user_id": target_user_id, "mode": "hard-delete"}


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
        push_audit_log("ad_settings_updated", "default", actor_id=user["user_id"], details=json.dumps({"storage": "mongodb", "value": value}))
        return value
    push_audit_log("ad_settings_updated", "default", actor_id=user["user_id"], details=json.dumps({"storage": "sqlite", "value": value}))
    return sqlite_update_ad_settings(value)


@api_router.get("/admin/moderation/settings")
async def get_moderation_settings(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_moderator_access(user)
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
    ensure_moderator_access(user)
    sensitivity = max(0, min(100, int(payload.sensitivity)))
    global MODERATION_SENSITIVITY
    MODERATION_SENSITIVITY = sensitivity
    if db is not None:
        await db.moderation_settings.update_one(
            {"settings_id": "default"},
            {"$set": {"settings_id": "default", "value": {"sensitivity": sensitivity}, "updated_at": utc_now()}},
            upsert=True,
        )
        push_audit_log("moderation_settings_updated", "default", actor_id=user["user_id"], details=json.dumps({"storage": "mongodb", "sensitivity": sensitivity}))
        return {"sensitivity": sensitivity}
    push_audit_log("moderation_settings_updated", "default", actor_id=user["user_id"], details=json.dumps({"storage": "sqlite", "sensitivity": sensitivity}))
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
        push_audit_log("ad_campaign_created", campaign["campaign_id"], actor_id=user["user_id"], details=json.dumps({"storage": "mongodb", "name": campaign["name"], "budget": campaign["budget"]}))
        return campaign
    push_audit_log("ad_campaign_created", campaign["campaign_id"], actor_id=user["user_id"], details=json.dumps({"storage": "sqlite", "name": campaign["name"], "budget": campaign["budget"]}))
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
        push_audit_log("notification_broadcast", "all_users", actor_id=user["user_id"], details=json.dumps({"storage": "mongodb", "recipient_count": len(cursor), "message_preview": message[:120]}))
        return {"message": "Broadcast sent", "recipient_count": len(cursor)}
    count = sqlite_push_broadcast(message)
    push_audit_log("notification_broadcast", "all_users", actor_id=user["user_id"], details=json.dumps({"storage": "sqlite", "recipient_count": count, "message_preview": message[:120]}))
    return {"message": "Broadcast sent", "recipient_count": count}


@api_router.get("/admin/logs")
async def get_system_logs(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    return SYSTEM_LOGS[-100:]


@api_router.get("/admin/audit-logs")
async def get_audit_logs(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ensure_admin_access(user)
    return [log for log in SYSTEM_LOGS[-200:] if log.get("component") == "audit"]


@api_router.get("/ads/config")
async def get_public_ad_config():
    if db is not None:
        try:
            doc = await db.ad_settings.find_one({"settings_id": "default"}, {"_id": 0})
            if doc:
                return build_public_ad_config_from_settings(doc.get("value", {}))
        except Exception as exc:
            logger.warning("Mongo ad config lookup failed, falling back: %s", exc)
    return get_public_ad_config_fallback()


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


@api_router.get("/explore", response_model=ExploreDirectoryResponse)
async def get_explore_directory(
    limit: int = 40,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    safe_limit = max(10, min(limit, 100))
    posts = await get_feed(skip=0, limit=safe_limit, following_only=False, authorization=authorization)
    plain_posts = [post.model_dump() if hasattr(post, "model_dump") else post.dict() for post in posts]
    topics = derive_explore_topics_from_posts(plain_posts)
    creators = derive_creator_suggestions_from_posts(plain_posts)
    return ExploreDirectoryResponse(
        topics=[ExploreTopicItem(**topic) for topic in topics],
        creators=[CreatorSuggestionItem(**creator) for creator in creators],
        posts=plain_posts[:12],
        user={
            "user_id": user["user_id"],
            "username": user["username"],
            "is_new_user": is_new_user_profile(user),
        },
    )


@api_router.get("/messages", response_model=MessagesDirectoryResponse)
async def get_messages_directory(
    limit: int = 10,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    safe_limit = max(1, min(limit, 20))
    if db is not None:
        messages = await db.messages.find(
            {"$or": [{"sender_user_id": user["user_id"]}, {"recipient_user_id": user["user_id"]}]},
            {"_id": 0},
        ).sort("created_at", -1).limit(100).to_list(length=100)
        unread_count = int(await db.messages.count_documents({"recipient_user_id": user["user_id"], "is_read": {"$ne": True}}))
    else:
        messages = sqlite_list_messages_for_user(user["user_id"], limit=100)
        unread_count = sqlite_count_unread_messages(user["user_id"])
    threads: List[Dict[str, Any]] = []
    seen_threads: set[str] = set()
    for idx, item in enumerate(messages):
        sender_user_id = str(item.get("sender_user_id") or "")
        recipient_user_id = str(item.get("recipient_user_id") or "")
        actor_user_id = sender_user_id if sender_user_id != user["user_id"] else recipient_user_id
        actor_username = str(item.get("sender_username") or "user")
        direction = "sent" if sender_user_id == user["user_id"] else "received"
        avatar_source = None
        if db is not None and actor_user_id:
            actor_user = await db.users.find_one({"user_id": actor_user_id}, {"_id": 0, "profile_picture": 1})
            avatar_source = str(actor_user.get("profile_picture") or "") if actor_user else None
        else:
            avatar_source = get_user_profile_picture_by_id(actor_user_id)
        thread_id = str(item.get("thread_id") or build_message_thread_id(user["user_id"], actor_user_id or f"fallback_{idx}"))
        if thread_id in seen_threads:
            continue
        seen_threads.add(thread_id)
        if db is not None:
            last_read_doc = await db.messages.find_one(
                {"thread_id": thread_id, "recipient_user_id": user["user_id"], "is_read": {"$eq": True}},
                {"_id": 0, "read_at": 1, "created_at": 1},
                sort=[("read_at", -1), ("created_at", -1)],
            )
            thread_last_read_at = str((last_read_doc or {}).get("read_at") or (last_read_doc or {}).get("created_at") or "") or None
        else:
            thread_last_read_at = sqlite_get_thread_last_read_at(user["user_id"], thread_id)
        last_message_read_at = str(item.get("read_at") or "") or None
        threads.append(
            {
                "id": thread_id,
                "title": f"@{actor_username}",
                "preview": build_message_preview(item),
                "time": str(item.get("created_at", "")),
                "unread_count": sqlite_count_thread_unread(user["user_id"], thread_id) if db is None else int(
                    await db.messages.count_documents({"thread_id": thread_id, "recipient_user_id": user["user_id"], "is_read": {"$ne": True}})
                ),
                "avatar_url": message_avatar_url(avatar_source),
                "participant_user_id": actor_user_id,
                "last_sender_user_id": sender_user_id,
                "last_sender_username": actor_username,
                "direction": direction,
                "last_read_at": thread_last_read_at or last_message_read_at or str(item.get("delivered_at") or "") or None,
                "last_message_delivered_at": str(item.get("delivered_at") or "") or None,
                "last_message_read_at": last_message_read_at,
                "last_message_state": build_last_message_state(item),
                "is_typing": bool(await get_thread_typing_usernames(thread_id, user["user_id"])),
                "is_online": bool((await get_user_presence_snapshot(actor_user_id, actor_username)).get("is_online")) if actor_user_id else False,
            }
        )
    return MessagesDirectoryResponse(
        threads=[MessageThreadItem(**thread) for thread in threads],
        unread_count=unread_count,
    )

@api_router.get("/admin/presence-telemetry")
async def get_admin_presence_telemetry(
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    ensure_super_admin(user)
    return await get_message_presence_telemetry()

@api_router.get("/users/me/presence")
async def get_current_user_presence(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return await get_user_presence_snapshot(user["user_id"], user["username"])

@api_router.get("/messages/{thread_id}", response_model=MessageThreadResponse)
async def get_message_thread(
    thread_id: str,
    before: Optional[str] = None,
    after: Optional[str] = None,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    await touch_user_presence(user["user_id"], user["username"])
    return await build_message_thread_response(user, thread_id, before=before, after=after, limit=200)

@api_router.post("/messages/{thread_id}/send", response_model=MessageThreadResponse)
async def send_message(
    thread_id: str,
    payload: MessageSendRequest,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    recipient_user_id = payload.recipient_user_id
    if not recipient_user_id:
        thread_parts = [part for part in thread_id.split("::") if part]
        recipient_user_id = next((part for part in thread_parts if part != user["user_id"]), None)
    message = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "thread_id": thread_id,
        "sender_user_id": user["user_id"],
        "sender_username": user["username"],
        "recipient_user_id": recipient_user_id,
        "text": text,
        "created_at": utc_iso_now(),
        "is_read": 0,
        "delivered_at": utc_iso_now(),
        "read_at": None,
    }
    if db is not None:
        await db.messages.insert_one({**message, "is_read": False})
    else:
        sqlite_save_message(message)
    await touch_user_presence(user["user_id"], user["username"])
    return await build_message_thread_response(user, thread_id, limit=200)

@api_router.post("/messages/{thread_id}/typing")
async def typing_message_thread(
    thread_id: str,
    payload: Dict[str, Any],
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    is_typing = bool(payload.get("is_typing", False))
    await touch_user_presence(user["user_id"], user["username"])
    await set_thread_typing(thread_id, user["user_id"], user["username"], is_typing)
    return {"thread_id": thread_id, "is_typing": is_typing}

@api_router.get("/messages/{thread_id}/stream")
async def stream_message_thread(
    thread_id: str,
    before: Optional[str] = None,
    after: Optional[str] = None,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)

    async def event_generator():
        last_payload = ""
        while True:
            payload = (await build_message_thread_response(user, thread_id, before=before, after=after, limit=200)).model_dump()
            serialized = json.dumps(payload, default=str, ensure_ascii=False)
            if serialized != last_payload:
                last_payload = serialized
                yield f"event: message\ndata: {serialized}\n\n"
            else:
                yield "event: ping\ndata: {}\n\n"
            await asyncio.sleep(6)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@api_router.get("/network", response_model=NetworkDirectoryResponse)
async def get_network_directory(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if db is not None:
        follower_count = await db.follows.count_documents({"following_id": user["user_id"]})
        following_count = await db.follows.count_documents({"follower_id": user["user_id"]})
        blocked_count = await db.blocks.count_documents({"user_id": user["user_id"]})
        muted_count = await db.mutes.count_documents({"user_id": user["user_id"]})
    else:
        with get_sqlite_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) AS c FROM follows WHERE following_id = ?", (user["user_id"],))
            follower_count = int(cursor.fetchone()["c"])
            cursor.execute("SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?", (user["user_id"],))
            following_count = int(cursor.fetchone()["c"])
            cursor.execute("SELECT COUNT(*) AS c FROM blocks WHERE user_id = ?", (user["user_id"],))
            blocked_count = int(cursor.fetchone()["c"])
            cursor.execute("SELECT COUNT(*) AS c FROM mutes WHERE user_id = ?", (user["user_id"],))
            muted_count = int(cursor.fetchone()["c"])
    unread_count = await get_unread_notifications_count_for_user(user["user_id"])
    return NetworkDirectoryResponse(
        metrics=[
            NetworkMetricItem(label="Aktiiviset yhteydet", value=str(follower_count + following_count)),
            NetworkMetricItem(label="Yhteistyöehdotukset", value=str(max(0, follower_count - muted_count))),
            NetworkMetricItem(label="Lukemattomat", value=str(unread_count)),
            NetworkMetricItem(label="Estot", value=str(blocked_count)),
        ],
        user={
            "user_id": user["user_id"],
            "username": user["username"],
            "role": get_user_role(user),
        },
    )


@api_router.get("/communities", response_model=CommunitiesDirectoryResponse)
async def get_communities_directory(
    limit: int = 30,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    safe_limit = max(10, min(limit, 100))
    posts = await get_feed(skip=0, limit=safe_limit, following_only=False, authorization=authorization)
    plain_posts = [post.model_dump() if hasattr(post, "model_dump") else post.dict() for post in posts]
    topics = derive_explore_topics_from_posts(plain_posts)
    memberships = await get_user_community_memberships(user["user_id"])
    communities = [
        {
            "name": normalize_community_name(topic["label"].lstrip("#").capitalize() or "Community"),
            "members": max(10, topic["count"] * 12) + await get_community_membership_count(normalize_community_name(topic["label"].lstrip("#").capitalize() or "Community")),
            "description": f"Aiheen ympärille muodostunut yhteisö ({topic['count']} osumaa).",
            "is_member": normalize_community_name(topic["label"].lstrip("#").capitalize() or "Community") in memberships,
        }
        for topic in topics[:5]
    ]
    return CommunitiesDirectoryResponse(
        communities=[CommunityItem(**community) for community in communities],
    )

@api_router.post("/communities/{community_name}/toggle", response_model=CommunityMembershipResponse)
async def toggle_community_membership(
    community_name: str,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    normalized_name = normalize_community_name(community_name)
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Community name is required")
    if db is not None:
        existing = await db.community_memberships.find_one(
            {"user_id": user["user_id"], "community_name": normalized_name},
            {"_id": 0},
        )
        if existing:
            await db.community_memberships.delete_one({"user_id": user["user_id"], "community_name": normalized_name})
            is_member = False
        else:
            await db.community_memberships.insert_one({
                "membership_id": f"cm_{uuid.uuid4().hex[:12]}",
                "user_id": user["user_id"],
                "community_name": normalized_name,
                "created_at": utc_iso_now(),
            })
            is_member = True
        members = sqlite_get_community_membership_count(normalized_name) if SQLITE_DB_PATH else int(await db.community_memberships.count_documents({"community_name": normalized_name}))
        return CommunityMembershipResponse(community_name=normalized_name, is_member=is_member, members=members)
    is_member = sqlite_toggle_community_membership(user["user_id"], normalized_name)
    members = sqlite_get_community_membership_count(normalized_name)
    return CommunityMembershipResponse(community_name=normalized_name, is_member=is_member, members=members)

@api_router.get("/communities/{community_name}", response_model=CommunityDetailResponse)
async def get_community_detail(
    community_name: str,
    limit: int = 20,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    normalized_name = normalize_community_name(community_name)
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Community name is required")
    safe_limit = max(5, min(limit, 50))
    if db is not None:
        posts = await db.posts.find(
            {
                "$or": [
                    {"hashtags": normalized_name.lower()},
                    {"hashtags": normalized_name},
                    {"text": {"$regex": normalized_name, "$options": "i"}},
                ]
            },
            {"_id": 0},
        ).sort("created_at", -1).limit(safe_limit).to_list(length=safe_limit)
    else:
        posts = get_sqlite_feed(skip=0, limit=100)
        posts = [
            post for post in posts
            if normalized_name.lower() in [str(tag).lower() for tag in (post.get("hashtags") or [])]
            or normalized_name.lower() in str(post.get("text") or "").lower()
        ]
        posts = posts[:safe_limit]
    memberships = await get_user_community_memberships(user["user_id"])
    members = await get_community_membership_count(normalized_name)
    description = f"Yhteisöaihe #{normalized_name.lower().replace(' ', '')}."
    detail_posts: List[CommunityPostItem] = []
    for post in posts:
        post = normalize_post_payload(post)
        detail_posts.append(CommunityPostItem(
            post_id=str(post.get("post_id")),
            user_id=str(post.get("user_id")),
            username=str(post.get("username")),
            text=str(post.get("text") or ""),
            image=post.get("image"),
            hashtags=list(post.get("hashtags") or []),
            mentions=list(post.get("mentions") or []),
            likes_count=int(post.get("likes_count", 0) or 0),
            comments_count=int(post.get("comments_count", 0) or 0),
            repost_count=int(post.get("repost_count", 0) or 0),
            created_at=post.get("created_at") if isinstance(post.get("created_at"), datetime) else datetime.fromisoformat(str(post.get("created_at")).replace("Z", "+00:00")),
            is_liked=bool(post.get("is_liked", False)),
        ))
    return CommunityDetailResponse(
        community_name=normalized_name,
        is_member=normalized_name in memberships,
        members=members,
        description=description,
        posts=detail_posts,
    )


@api_router.get("/projects", response_model=ProjectsDirectoryResponse)
async def get_projects_directory(
    limit: int = 12,
    authorization: Optional[str] = Header(None),
):
    await get_current_user(authorization)
    safe_limit = max(3, min(limit, 20))
    posts = await get_feed(skip=0, limit=safe_limit, following_only=False, authorization=authorization)
    plain_posts = [post.model_dump() if hasattr(post, "model_dump") else post.dict() for post in posts]
    projects = [
        {
            "name": (post.get("text", "")[:18] or f"Project {idx + 1}").strip(),
            "status": "Luonnos" if idx == 0 else "Käynnissä" if idx == 1 else "Suunnittelu",
            "description": f"{post.get('likes_count', 0)} tykkäystä · {post.get('comments_count', 0)} kommenttia",
        }
        for idx, post in enumerate(plain_posts[:5])
    ]
    if not projects:
        projects = [
            {"name": "Alpha launch", "status": "Luonnos", "description": "Julkaisun valmistelut ja testaus."},
            {"name": "Creator toolkit", "status": "Käynnissä", "description": "Sisältötyökalujen pilotointi."},
            {"name": "Community map", "status": "Suunnittelu", "description": "Yhteisöjen ja teemojen kartoitus."},
        ]
    return ProjectsDirectoryResponse(
        projects=[ProjectItem(**project) for project in projects],
    )


@api_router.get("/search", response_model=SearchResultResponse)
async def search_directory(
    q: str = "",
    limit: int = 10,
    authorization: Optional[str] = Header(None),
):
    await get_current_user(authorization)
    safe_limit = max(3, min(limit, 25))
    query = q.strip()

    if db is not None:
        tokens = [token for token in query.split() if token]
        if tokens:
            post_filter = {
                "$and": [
                    {
                        "$or": [
                            {"text": {"$regex": token, "$options": "i"}},
                            {"username": {"$regex": token, "$options": "i"}},
                        ]
                    }
                    for token in tokens
                ]
            }
            user_filter = {
                "$and": [
                    {
                        "$or": [
                            {"username": {"$regex": token, "$options": "i"}},
                            {"bio": {"$regex": token, "$options": "i"}},
                        ]
                    }
                    for token in tokens
                ]
            }
        else:
            post_filter = {}
            user_filter = {}
        posts = await db.posts.find(post_filter, {"_id": 0}).sort("created_at", -1).limit(safe_limit).to_list(length=safe_limit)
        users = await db.users.find(user_filter, {"_id": 0, "password_hash": 0}).sort("followers_count", -1).limit(safe_limit).to_list(length=safe_limit)
    else:
        posts = sqlite_search_posts(query, safe_limit)
        users = sqlite_search_users(query, safe_limit)

    plain_posts = [post.model_dump() if hasattr(post, "model_dump") else dict(post) for post in posts]
    tokens = search_query_tokenize(query)
    plain_posts = rank_search_posts(plain_posts, tokens) if tokens else plain_posts
    users = rank_search_users(users, tokens) if tokens else users
    hashtags = derive_explore_topics_from_posts(plain_posts, limit=8)
    communities = build_community_suggestions_from_topics(hashtags, limit=5)
    return SearchResultResponse(
        query=query,
        posts=[SearchPostItem(**post) for post in build_search_posts_from_posts(plain_posts, limit=safe_limit)],
        users=[SearchUserItem(**user) for user in users[:safe_limit]],
        hashtags=[ExploreTopicItem(**topic) for topic in hashtags],
        communities=[CommunityItem(**community) for community in communities],
    )


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
            await db.message_presence.create_index([("thread_id", 1), ("updated_at", -1)])
            await db.message_presence.create_index([("updated_at", -1)])
            await db.user_presence.create_index("user_id", unique=True)
            await db.user_presence.create_index([("last_active_at", -1)])

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
                        date_of_birth TEXT,
                        age_verified_at TEXT,
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
                        is_nsfw INTEGER DEFAULT 0,
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
                        text TEXT,
                        post_id TEXT,
                        reviewed_at TEXT,
                        reviewed_by TEXT
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
                    for column_name, column_type in (("post_id", "TEXT"), ("reviewed_at", "TEXT"), ("reviewed_by", "TEXT"), ("reviewed_reason", "TEXT"), ("reviewed_reason_tags", "TEXT"), ("reviewed_reason_custom", "TEXT")):
                        try:
                            cur.execute(f"ALTER TABLE moderation_queue ADD COLUMN {column_name} {column_type}")
                        except sqlite3.OperationalError:
                            pass
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
                    CREATE TABLE IF NOT EXISTS payment_settings (
                        setting_key TEXT PRIMARY KEY,
                        setting_value TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS homepage_settings (
                        setting_key TEXT PRIMARY KEY,
                        setting_value TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS payment_intents (
                        payment_id TEXT PRIMARY KEY,
                        user_id TEXT,
                        purpose TEXT,
                        reference_type TEXT,
                        reference_id TEXT,
                        payment_method TEXT,
                        amount REAL,
                        currency TEXT,
                        status TEXT,
                        provider TEXT,
                        provider_reference TEXT,
                        metadata TEXT,
                        created_at TEXT,
                        updated_at TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS wallet_accounts (
                        wallet_id TEXT PRIMARY KEY,
                        user_id TEXT UNIQUE,
                        currency TEXT DEFAULT 'EUR',
                        balance REAL DEFAULT 0,
                        updated_at TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS payment_ledger (
                        ledger_id TEXT PRIMARY KEY,
                        payment_id TEXT,
                        user_id TEXT,
                        currency TEXT,
                        amount REAL,
                        direction TEXT,
                        method TEXT,
                        status TEXT,
                        reference_type TEXT,
                        reference_id TEXT,
                        created_at TEXT,
                        notes TEXT
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
                        cur.execute("ALTER TABLE users ADD COLUMN date_of_birth TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE users ADD COLUMN age_verified_at TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE ad_campaigns ADD COLUMN currency TEXT DEFAULT 'EUR'")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE payment_intents ADD COLUMN purpose TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE payment_intents ADD COLUMN reference_type TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE payment_intents ADD COLUMN reference_id TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE payment_intents ADD COLUMN payment_method TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE payment_intents ADD COLUMN amount REAL")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE payment_intents ADD COLUMN currency TEXT DEFAULT 'EUR'")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE payment_intents ADD COLUMN status TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE payment_intents ADD COLUMN provider TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE payment_intents ADD COLUMN provider_reference TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE payment_intents ADD COLUMN metadata TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE payment_intents ADD COLUMN updated_at TEXT")
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
                        cur.execute("ALTER TABLE posts ADD COLUMN is_nsfw INTEGER DEFAULT 0")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE posts ADD COLUMN hashtags TEXT DEFAULT '[]'")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE posts ADD COLUMN mentions TEXT DEFAULT '[]'")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE posts ADD COLUMN video TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE posts ADD COLUMN repost_post_id TEXT")
                    except Exception:
                        pass
                    try:
                        cur.execute("ALTER TABLE posts ADD COLUMN repost_count INTEGER DEFAULT 0")
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
                    for key, value in {
                        "card_enabled": "1",
                        "wallet_enabled": "1",
                        "crypto_enabled": "1",
                        "card_provider": "visa-or-psp",
                        "wallet_provider": "internal-wallet",
                        "crypto_provider": "onchain",
                        "settlement_currency": "EUR",
                        "wallet_topup_enabled": "1",
                        "supported_currencies": json.dumps(["EUR", "USD", "BTC"]),
                    }.items():
                        cur.execute(
                            "INSERT OR IGNORE INTO payment_settings (setting_key, setting_value) VALUES (?, ?)",
                            (key, value),
                        )
                    for key, value in {
                        "title": "Tervetuloa YOSLA SOME LIFE",
                        "subtitle": "Suomalainen some, jossa voit julkaista, keskustella ja rakentaa verkoston yhdessä paikassa.",
                        "badge": "Suomalainen some",
                        "hero_image_url": "",
                        "hero_image_alt": "YOSLA SOME LIFE",
                    }.items():
                        cur.execute(
                            "INSERT OR IGNORE INTO homepage_settings (setting_key, setting_value) VALUES (?, ?)",
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
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS messages (
                        message_id TEXT PRIMARY KEY,
                        thread_id TEXT,
                        sender_user_id TEXT,
                        sender_username TEXT,
                        recipient_user_id TEXT,
                        text TEXT,
                        created_at TEXT,
                        is_read INTEGER DEFAULT 0
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS message_presence (
                        thread_id TEXT,
                        user_id TEXT,
                        username TEXT,
                        is_typing INTEGER DEFAULT 0,
                        updated_at TEXT,
                        PRIMARY KEY (thread_id, user_id)
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS user_presence (
                        user_id TEXT PRIMARY KEY,
                        username TEXT,
                        last_active_at TEXT
                    )
                    ''')
                    cur.execute('''
                    CREATE TABLE IF NOT EXISTS community_memberships (
                        membership_id TEXT PRIMARY KEY,
                        user_id TEXT,
                        community_name TEXT,
                        created_at TEXT,
                        UNIQUE(user_id, community_name)
                    )
                    ''')
                    cur.execute("CREATE INDEX IF NOT EXISTS idx_message_presence_thread_updated ON message_presence(thread_id, updated_at DESC)")
                    cur.execute("CREATE INDEX IF NOT EXISTS idx_messages_thread_id_created_at ON messages(thread_id, created_at DESC)")
                    cur.execute("CREATE INDEX IF NOT EXISTS idx_messages_recipient_is_read ON messages(recipient_user_id, is_read)")
                    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_presence_last_active ON user_presence(last_active_at DESC)")
                    cur.execute("CREATE INDEX IF NOT EXISTS idx_community_memberships_name ON community_memberships(community_name)")

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
