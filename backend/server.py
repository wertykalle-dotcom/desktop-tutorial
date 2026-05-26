from fastapi import FastAPI, APIRouter, HTTPException, Header, Request
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

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'social_media_db')]

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT Configuration
SECRET_KEY = os.environ.get('SECRET_KEY', secrets.token_urlsafe(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

# Create the main app
app = FastAPI(title="Social Media API")

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

# =======================
# HELPER FUNCTIONS
# =======================

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

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
    existing_user = await db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Check if username already exists
    existing_username = await db.users.find_one({"username": user_data.username})
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
        "created_at": datetime.now(timezone.utc)
    }
    
    await db.users.insert_one(user)
    
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
    user = await db.users.find_one({"email": credentials.email})
    
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
    return UserProfile(**user)

@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    """Logout user and invalidate session"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = authorization.replace("Bearer ", "")
    
    # Delete session if it exists
    await db.user_sessions.delete_one({"session_token": token})
    
    return {"message": "Logged out successfully"}

# =======================
# USER ENDPOINTS
# =======================

@api_router.get("/users/me", response_model=UserProfile)
async def get_my_profile(authorization: Optional[str] = Header(None)):
    """Get current user's full profile"""
    user = await get_current_user(authorization)
    return UserProfile(**user)

@api_router.put("/users/me", response_model=UserProfile)
async def update_my_profile(
    update_data: UserUpdate,
    authorization: Optional[str] = Header(None)
):
    """Update current user's profile"""
    user = await get_current_user(authorization)
    
    update_dict = update_data.dict(exclude_unset=True)
    
    # Check if username is being changed and if it's already taken
    if "username" in update_dict:
        existing = await db.users.find_one({
            "username": update_dict["username"],
            "user_id": {"$ne": user["user_id"]}
        })
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")
    
    if update_dict:
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": update_dict}
        )
    
    updated_user = await db.users.find_one(
        {"user_id": user["user_id"]},
        {"_id": 0, "password_hash": 0}
    )
    
    return UserProfile(**updated_user)

@api_router.get("/users/{user_id}", response_model=UserProfile)
async def get_user_profile(user_id: str, authorization: Optional[str] = Header(None)):
    """Get any user's public profile"""
    await get_current_user(authorization)  # Verify authentication
    
    user = await db.users.find_one(
        {"user_id": user_id},
        {"_id": 0, "password_hash": 0}
    )
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return UserProfile(**user)

# =======================
# POST ENDPOINTS
# =======================

@api_router.post("/posts", response_model=Post)
async def create_post(
    post_data: PostCreate,
    authorization: Optional[str] = Header(None)
):
    """Create a new post"""
    user = await get_current_user(authorization)
    
    post_id = f"post_{uuid.uuid4().hex[:12]}"
    
    post = {
        "post_id": post_id,
        "user_id": user["user_id"],
        "username": user["username"],
        "profile_picture": user.get("profile_picture"),
        "text": post_data.text,
        "image": post_data.image,
        "likes_count": 0,
        "comments_count": 0,
        "created_at": datetime.now(timezone.utc)
    }
    
    await db.posts.insert_one(post)
    
    # Increment user's post count
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$inc": {"posts_count": 1}}
    )
    
    post.pop("_id", None)
    return Post(**post, is_liked=False)

@api_router.get("/posts", response_model=List[Post])
async def get_feed(
    skip: int = 0,
    limit: int = 20,
    authorization: Optional[str] = Header(None)
):
    """Get feed of all posts (newest first)"""
    current_user = await get_current_user(authorization)
    
    # Get posts sorted by newest first
    posts_cursor = db.posts.find(
        {},
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
    """Like a post"""
    user = await get_current_user(authorization)
    
    # Check if post exists
    post = await db.posts.find_one({"post_id": post_id})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Check if already liked
    existing_like = await db.likes.find_one({
        "post_id": post_id,
        "user_id": user["user_id"]
    })
    
    if existing_like:
        return {"message": "Already liked"}
    
    # Create like
    like = {
        "like_id": f"like_{uuid.uuid4().hex[:12]}",
        "post_id": post_id,
        "user_id": user["user_id"],
        "created_at": datetime.now(timezone.utc)
    }
    
    await db.likes.insert_one(like)
    
    # Increment post likes count
    await db.posts.update_one(
        {"post_id": post_id},
        {"$inc": {"likes_count": 1}}
    )
    
    return {"message": "Post liked"}

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
        "text": comment_data.text,
        "created_at": datetime.now(timezone.utc)
    }
    
    await db.comments.insert_one(comment)
    
    # Increment post comments count
    await db.posts.update_one(
        {"post_id": post_id},
        {"$inc": {"comments_count": 1}}
    )
    
    comment.pop("_id", None)
    return Comment(**comment)

@api_router.get("/posts/{post_id}/comments", response_model=List[Comment])
async def get_comments(
    post_id: str,
    authorization: Optional[str] = Header(None)
):
    """Get all comments for a post"""
    await get_current_user(authorization)
    
    comments = await db.comments.find(
        {"post_id": post_id},
        {"_id": 0}
    ).sort("created_at", 1).to_list(length=None)
    
    return [Comment(**comment) for comment in comments]

# =======================
# FOLLOW ENDPOINTS
# =======================

@api_router.post("/users/{target_user_id}/follow")
async def follow_user(
    target_user_id: str,
    authorization: Optional[str] = Header(None)
):
    """Follow a user"""
    user = await get_current_user(authorization)
    
    if user["user_id"] == target_user_id:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    
    # Check if target user exists
    target_user = await db.users.find_one({"user_id": target_user_id})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if already following
    existing_follow = await db.follows.find_one({
        "follower_id": user["user_id"],
        "following_id": target_user_id
    })
    
    if existing_follow:
        return {"message": "Already following"}
    
    # Create follow
    follow = {
        "follow_id": f"follow_{uuid.uuid4().hex[:12]}",
        "follower_id": user["user_id"],
        "following_id": target_user_id,
        "created_at": datetime.now(timezone.utc)
    }
    
    await db.follows.insert_one(follow)
    
    # Increment counts
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$inc": {"following_count": 1}}
    )
    
    await db.users.update_one(
        {"user_id": target_user_id},
        {"$inc": {"followers_count": 1}}
    )
    
    return {"message": "User followed"}

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
    
    follow = await db.follows.find_one({
        "follower_id": current_user["user_id"],
        "following_id": user_id
    })
    
    return {"is_following": follow is not None}

# =======================
# DATABASE INDEXES
# =======================

@app.on_event("startup")
async def create_indexes():
    """Create database indexes"""
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
        
        logger.info("Database indexes created successfully")
    except Exception as e:
        logger.error(f"Error creating indexes: {str(e)}")

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
    client.close()
