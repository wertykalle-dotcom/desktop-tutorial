from fastapi import FastAPI, APIRouter, HTTPException, Header, Request, UploadFile, File, Form
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
import httpx
from jose import jwt
import secrets
from fastapi.staticfiles import StaticFiles
import sqlite3
import asyncio

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
    SQLITE_DB_PATH = str((ROOT_DIR / DATABASE_PATH).resolve()) if not os.path.isabs(DATABASE_PATH) else DATABASE_PATH
else:
    SQLITE_DB_PATH = None

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT Configuration
SECRET_KEY = os.environ.get('SECRET_KEY', secrets.token_urlsafe(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

# Create the main app
app = FastAPI(title="Social Media API")

# Ensure uploads directory exists and serve it
uploads_dir = ROOT_DIR / 'uploads'
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

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

class UserUpdate(BaseModel):
    username: Optional[str] = None
    profile_picture: Optional[str] = None
    bio: Optional[str] = None

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
        cursor.execute(
            """
            INSERT INTO posts (
                post_id, user_id, username, profile_picture, text, image, likes_count, comments_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            SELECT post_id, user_id, username, profile_picture, text, image, likes_count, comments_count, created_at
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
        return user
    user = get_sqlite_user_by_id(user_id)
    if not user:
        return None
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
            
            return user
        else:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = payload.get("sub")
            if user_id is None:
                raise HTTPException(status_code=401, detail="Invalid token")

            user = get_sqlite_user_by_id(user_id)
            if user is None:
                raise HTTPException(status_code=401, detail="User not found")

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
async def register(user_data: UserRegister):
    """Register a new user with email/password"""
    # Check if email already exists
    if db is not None:
        existing_user = await db.users.find_one({"email": user_data.email})
    else:
        existing_user = get_sqlite_user_by_email(user_data.email)

    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Check if username already exists
    if db is not None:
        existing_username = await db.users.find_one({"username": user_data.username})
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
        "created_at": utc_now()
    }

    if db is not None:
        await db.users.insert_one(user)
    else:
        with get_sqlite_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO users (user_id, email, password_hash, username, profile_picture, bio, followers_count, following_count, posts_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                )
            )
            conn.commit()
    
    # Create access token
    access_token = create_access_token(data={"sub": user_id})
    
    # Remove sensitive data
    user.pop("password_hash", None)
    
    return AuthResponse(
        token=access_token,
        user=UserProfile(**user)
    )

@api_router.post("/auth/login", response_model=AuthResponse)
async def login(credentials: UserLogin):
    """Login with email/password"""
    if db is not None:
        user = await db.users.find_one({"email": credentials.email})
    else:
        user = get_sqlite_user_by_email(credentials.email)
    
    if not user or not verify_password(credentials.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Create access token
    access_token = create_access_token(data={"sub": user["user_id"]})
    
    # Remove sensitive data
    user.pop("_id", None)
    user.pop("password_hash", None)
    
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
    authorization: Optional[str] = Header(None)
):
    """Create a new post. Accepts multipart/form-data with optional image file."""
    user = await get_current_user(authorization)

    if (not text or not text.strip()) and image is None:
        raise HTTPException(status_code=400, detail="Post must contain text or an image")

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
        "created_at": datetime.now(timezone.utc)
    }

    if db is not None:
        await db.posts.insert_one(post)
        # Increment user's post count
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$inc": {"posts_count": 1}}
        )
    else:
        create_sqlite_post(post)

    post.pop("_id", None)
    return Post(**post, is_liked=False)

@api_router.get("/posts", response_model=List[Post])
async def get_feed(
    skip: int = 0,
    limit: int = 20,
    following_only: bool = False,
    authorization: Optional[str] = Header(None)
):
    """Get feed of all posts (newest first)"""
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
    
    return [Post(**post) for post in posts]

@api_router.get("/posts/{post_id}", response_model=Post)
async def get_post(
    post_id: str,
    authorization: Optional[str] = Header(None)
):
    """Get a specific post"""
    current_user = await get_current_user(authorization)
    
    post = await db.posts.find_one({"post_id": post_id}, {"_id": 0})
    
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
    authorization: Optional[str] = Header(None)
):
    """Add a comment to a post"""
    user = await get_current_user(authorization)
    text = comment_data.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment text cannot be empty")

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

@app.on_event("startup")
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
                        created_at TEXT
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
                        created_at TEXT
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
                    cur.execute("SELECT user_id FROM users WHERE email = ?", ('test@test.com',))
                    row = cur.fetchone()
                    if not row:
                        user_id = f"user_{uuid.uuid4().hex[:12]}"
                        pwd = 'password123'
                        hashed = hash_password(pwd)
                        created_at = datetime.now(timezone.utc).isoformat()
                        cur.execute(
                            "INSERT INTO users (user_id, email, password_hash, username, created_at) VALUES (?, ?, ?, ?, ?)",
                            (user_id, 'test@test.com', hashed, 'testuser', created_at)
                        )
                        conn.commit()
                        logger.info('Inserted default SQLite test user: test@test.com / password123')
                    conn.close()

                await asyncio.to_thread(_ensure)
            except Exception as e:
                logger.error(f"Error ensuring sqlite test user: {e}")

        # Schedule ensuring test user (don't block index creation)
        asyncio.create_task(ensure_sqlite_test_user())

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

@app.on_event("shutdown")
async def shutdown_db_client():
    if client is not None:
        client.close()
