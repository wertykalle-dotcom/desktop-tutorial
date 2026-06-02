#!/usr/bin/env python3
"""
Comprehensive Backend API Test Suite for Social Media Platform
Tests all authentication, user, post, like, comment, and follow endpoints
"""

import requests
import json
import sys
import os
from typing import Dict, Optional

# Backend URL from environment with a sane local fallback.
BACKEND_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:8000/api")

# Test users
TEST_USER_1 = {
    "email": "test1@example.com",
    "password": "password123",
    "username": "testuser1"
}

TEST_USER_2 = {
    "email": "test2@example.com",
    "password": "password123",
    "username": "testuser2"
}

# Store tokens and user data
user1_token = None
user1_data = None
user2_token = None
user2_data = None
test_post_id = None
test_comment_id = None

# Test results tracking
tests_passed = 0
tests_failed = 0
failed_tests = []


def tests_ready() -> bool:
    """Return True when the auth/bootstrap steps have produced usable users."""
    return bool(user1_token and user1_data and user2_token and user2_data)

def print_section(title: str):
    """Print a section header"""
    print(f"\n{'='*80}")
    print(f"  {title}")
    print(f"{'='*80}\n")

def print_test(test_name: str, passed: bool, details: str = ""):
    """Print test result"""
    global tests_passed, tests_failed, failed_tests
    
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status} - {test_name}")
    
    if details:
        print(f"     {details}")
    
    if passed:
        tests_passed += 1
    else:
        tests_failed += 1
        failed_tests.append(f"{test_name}: {details}")

def make_request(method: str, endpoint: str, token: Optional[str] = None, 
                 json_data: Optional[Dict] = None, params: Optional[Dict] = None) -> requests.Response:
    """Make HTTP request with optional authentication"""
    url = f"{BACKEND_URL}{endpoint}"
    headers = {}
    
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    try:
        if method == "GET":
            response = requests.get(url, headers=headers, params=params, timeout=10)
        elif method == "POST":
            response = requests.post(url, headers=headers, json=json_data, timeout=10)
        elif method == "PUT":
            response = requests.put(url, headers=headers, json=json_data, timeout=10)
        elif method == "DELETE":
            response = requests.delete(url, headers=headers, timeout=10)
        else:
            raise ValueError(f"Unsupported method: {method}")
        
        return response
    except requests.exceptions.RequestException as e:
        print(f"     ⚠️  Request error: {str(e)}")
        return None

# =======================
# AUTHENTICATION TESTS
# =======================

def test_register_user1():
    """Test user registration for user 1"""
    global user1_token, user1_data
    
    response = make_request("POST", "/auth/register", json_data=TEST_USER_1)
    
    if response and response.status_code == 200:
        data = response.json()
        if "token" in data and "user" in data:
            user1_token = data["token"]
            user1_data = data["user"]
            print_test("Register User 1", True, f"User ID: {user1_data.get('user_id')}")
            return True
        else:
            print_test("Register User 1", False, "Missing token or user in response")
            return False
    elif response and response.status_code == 400:
        # User might already exist, try to login
        print(f"     ℹ️  User already exists, will try login")
        return test_login_user1()
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("Register User 1", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_register_user2():
    """Test user registration for user 2"""
    global user2_token, user2_data
    
    response = make_request("POST", "/auth/register", json_data=TEST_USER_2)
    
    if response and response.status_code == 200:
        data = response.json()
        if "token" in data and "user" in data:
            user2_token = data["token"]
            user2_data = data["user"]
            print_test("Register User 2", True, f"User ID: {user2_data.get('user_id')}")
            return True
        else:
            print_test("Register User 2", False, "Missing token or user in response")
            return False
    elif response and response.status_code == 400:
        # User might already exist, try to login
        print(f"     ℹ️  User already exists, will try login")
        return test_login_user2()
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("Register User 2", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_login_user1():
    """Test user login for user 1"""
    global user1_token, user1_data
    
    response = make_request("POST", "/auth/login", json_data={
        "email": TEST_USER_1["email"],
        "password": TEST_USER_1["password"]
    })
    
    if response and response.status_code == 200:
        data = response.json()
        if "token" in data and "user" in data:
            user1_token = data["token"]
            user1_data = data["user"]
            print_test("Login User 1", True, f"Token received")
            return True
        else:
            print_test("Login User 1", False, "Missing token or user in response")
            return False
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("Login User 1", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_login_user2():
    """Test user login for user 2"""
    global user2_token, user2_data
    
    response = make_request("POST", "/auth/login", json_data={
        "email": TEST_USER_2["email"],
        "password": TEST_USER_2["password"]
    })
    
    if response and response.status_code == 200:
        data = response.json()
        if "token" in data and "user" in data:
            user2_token = data["token"]
            user2_data = data["user"]
            print_test("Login User 2", True, f"Token received")
            return True
        else:
            print_test("Login User 2", False, "Missing token or user in response")
            return False
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("Login User 2", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_get_me():
    """Test GET /auth/me endpoint"""
    response = make_request("GET", "/auth/me", token=user1_token)
    
    if response and response.status_code == 200:
        data = response.json()
        if data.get("user_id") == user1_data.get("user_id"):
            print_test("GET /auth/me", True, f"User: {data.get('username')}")
            return True
        else:
            print_test("GET /auth/me", False, "User ID mismatch")
            return False
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("GET /auth/me", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_logout():
    """Test POST /auth/logout endpoint"""
    response = make_request("POST", "/auth/logout", token=user1_token)
    
    if response and response.status_code == 200:
        print_test("POST /auth/logout", True, "Logged out successfully")
        return True
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("POST /auth/logout", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_unauthorized_access():
    """Test that endpoints reject unauthorized requests"""
    response = make_request("GET", "/users/me")
    
    if response and response.status_code == 401:
        print_test("Unauthorized Access Protection", True, "Correctly rejected")
        return True
    else:
        print_test("Unauthorized Access Protection", False, f"Expected 401, got {response.status_code if response else 'N/A'}")
        return False

# =======================
# USER PROFILE TESTS
# =======================

def test_get_my_profile():
    """Test GET /users/me endpoint"""
    response = make_request("GET", "/users/me", token=user1_token)
    
    if response and response.status_code == 200:
        data = response.json()
        if "user_id" in data and "username" in data:
            print_test("GET /users/me", True, f"Username: {data.get('username')}")
            return True
        else:
            print_test("GET /users/me", False, "Missing required fields")
            return False
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("GET /users/me", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_update_profile():
    """Test PUT /users/me endpoint"""
    update_data = {
        "bio": "This is my test bio for user 1",
        "username": "testuser1_updated"
    }
    
    response = make_request("PUT", "/users/me", token=user1_token, json_data=update_data)
    
    if response and response.status_code == 200:
        data = response.json()
        if data.get("bio") == update_data["bio"] and data.get("username") == update_data["username"]:
            print_test("PUT /users/me", True, f"Bio and username updated")
            # Update local user data
            user1_data["username"] = update_data["username"]
            user1_data["bio"] = update_data["bio"]
            return True
        else:
            print_test("PUT /users/me", False, "Update not reflected in response")
            return False
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("PUT /users/me", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_get_user_profile():
    """Test GET /users/{user_id} endpoint"""
    if not tests_ready():
        print_test("GET /users/{user_id}", False, "Bootstrap data unavailable")
        return False
    response = make_request("GET", f"/users/{user2_data.get('user_id')}", token=user1_token)
    
    if response and response.status_code == 200:
        data = response.json()
        if data.get("user_id") == user2_data.get("user_id"):
            print_test("GET /users/{user_id}", True, f"Retrieved user: {data.get('username')}")
            return True
        else:
            print_test("GET /users/{user_id}", False, "User ID mismatch")
            return False
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("GET /users/{user_id}", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

# =======================
# POST TESTS
# =======================

def test_create_post():
    """Test POST /posts endpoint"""
    global test_post_id
    
    post_data = {
        "text": "This is a test post from user 1! 🚀",
        "image": None
    }
    
    response = make_request("POST", "/posts", token=user1_token, json_data=post_data)
    
    if response and response.status_code == 200:
        data = response.json()
        if "post_id" in data and data.get("text") == post_data["text"]:
            test_post_id = data["post_id"]
            print_test("POST /posts", True, f"Post ID: {test_post_id}")
            return True
        else:
            print_test("POST /posts", False, "Missing post_id or text mismatch")
            return False
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("POST /posts", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_get_feed():
    """Test GET /posts endpoint (feed)"""
    response = make_request("GET", "/posts", token=user1_token)
    
    if response and response.status_code == 200:
        data = response.json()
        if isinstance(data, list):
            print_test("GET /posts (feed)", True, f"Retrieved {len(data)} posts")
            return True
        else:
            print_test("GET /posts (feed)", False, "Response is not a list")
            return False
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("GET /posts (feed)", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_get_single_post():
    """Test GET /posts/{post_id} endpoint"""
    if not test_post_id:
        print_test("GET /posts/{post_id}", False, "No test post ID available")
        return False
    
    response = make_request("GET", f"/posts/{test_post_id}", token=user1_token)
    
    if response and response.status_code == 200:
        data = response.json()
        if data.get("post_id") == test_post_id:
            print_test("GET /posts/{post_id}", True, f"Retrieved post")
            return True
        else:
            print_test("GET /posts/{post_id}", False, "Post ID mismatch")
            return False
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("GET /posts/{post_id}", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

# =======================
# LIKE TESTS
# =======================

def test_like_post():
    """Test POST /posts/{post_id}/like endpoint"""
    if not test_post_id:
        print_test("POST /posts/{post_id}/like", False, "No test post ID available")
        return False
    
    response = make_request("POST", f"/posts/{test_post_id}/like", token=user2_token)
    
    if response and response.status_code == 200:
        print_test("POST /posts/{post_id}/like", True, "Post liked by user 2")
        return True
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("POST /posts/{post_id}/like", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_verify_like_count():
    """Verify that like count increased"""
    if not test_post_id:
        print_test("Verify Like Count", False, "No test post ID available")
        return False
    
    response = make_request("GET", f"/posts/{test_post_id}", token=user1_token)
    
    if response and response.status_code == 200:
        data = response.json()
        if data.get("likes_count", 0) >= 1:
            print_test("Verify Like Count", True, f"Likes: {data.get('likes_count')}")
            return True
        else:
            print_test("Verify Like Count", False, f"Expected >= 1, got {data.get('likes_count')}")
            return False
    else:
        print_test("Verify Like Count", False, "Failed to retrieve post")
        return False

def test_unlike_post():
    """Test DELETE /posts/{post_id}/like endpoint"""
    if not test_post_id:
        print_test("DELETE /posts/{post_id}/like", False, "No test post ID available")
        return False
    
    response = make_request("DELETE", f"/posts/{test_post_id}/like", token=user2_token)
    
    if response and response.status_code == 200:
        print_test("DELETE /posts/{post_id}/like", True, "Post unliked by user 2")
        return True
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("DELETE /posts/{post_id}/like", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

# =======================
# COMMENT TESTS
# =======================

def test_create_comment():
    """Test POST /posts/{post_id}/comments endpoint"""
    global test_comment_id
    
    if not test_post_id:
        print_test("POST /posts/{post_id}/comments", False, "No test post ID available")
        return False
    
    comment_data = {
        "text": "Great post! This is a test comment from user 2."
    }
    
    response = make_request("POST", f"/posts/{test_post_id}/comments", token=user2_token, json_data=comment_data)
    
    if response and response.status_code == 200:
        data = response.json()
        if "comment_id" in data and data.get("text") == comment_data["text"]:
            test_comment_id = data["comment_id"]
            print_test("POST /posts/{post_id}/comments", True, f"Comment ID: {test_comment_id}")
            return True
        else:
            print_test("POST /posts/{post_id}/comments", False, "Missing comment_id or text mismatch")
            return False
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("POST /posts/{post_id}/comments", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_get_comments():
    """Test GET /posts/{post_id}/comments endpoint"""
    if not test_post_id:
        print_test("GET /posts/{post_id}/comments", False, "No test post ID available")
        return False
    
    response = make_request("GET", f"/posts/{test_post_id}/comments", token=user1_token)
    
    if response and response.status_code == 200:
        data = response.json()
        if isinstance(data, list) and len(data) >= 1:
            print_test("GET /posts/{post_id}/comments", True, f"Retrieved {len(data)} comments")
            return True
        else:
            print_test("GET /posts/{post_id}/comments", False, f"Expected list with >= 1 comment, got {len(data) if isinstance(data, list) else 'not a list'}")
            return False
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("GET /posts/{post_id}/comments", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_verify_comment_count():
    """Verify that comment count increased"""
    if not test_post_id:
        print_test("Verify Comment Count", False, "No test post ID available")
        return False
    
    response = make_request("GET", f"/posts/{test_post_id}", token=user1_token)
    
    if response and response.status_code == 200:
        data = response.json()
        if data.get("comments_count", 0) >= 1:
            print_test("Verify Comment Count", True, f"Comments: {data.get('comments_count')}")
            return True
        else:
            print_test("Verify Comment Count", False, f"Expected >= 1, got {data.get('comments_count')}")
            return False
    else:
        print_test("Verify Comment Count", False, "Failed to retrieve post")
        return False

# =======================
# FOLLOW TESTS
# =======================

def test_follow_user():
    """Test POST /users/{user_id}/follow endpoint"""
    if not tests_ready():
        print_test("POST /users/{user_id}/follow", False, "Bootstrap data unavailable")
        return False
    response = make_request("POST", f"/users/{user1_data.get('user_id')}/follow", token=user2_token)
    
    if response and response.status_code == 200:
        print_test("POST /users/{user_id}/follow", True, "User 2 followed User 1")
        return True
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("POST /users/{user_id}/follow", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_check_following():
    """Test GET /users/{user_id}/is-following endpoint"""
    if not tests_ready():
        print_test("GET /users/{user_id}/is-following", False, "Bootstrap data unavailable")
        return False
    response = make_request("GET", f"/users/{user1_data.get('user_id')}/is-following", token=user2_token)
    
    if response and response.status_code == 200:
        data = response.json()
        if data.get("is_following") == True:
            print_test("GET /users/{user_id}/is-following", True, "Following status confirmed")
            return True
        else:
            print_test("GET /users/{user_id}/is-following", False, f"Expected is_following=True, got {data.get('is_following')}")
            return False
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("GET /users/{user_id}/is-following", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_verify_follower_counts():
    """Verify follower and following counts"""
    if not tests_ready():
        print_test("Verify Follower/Following Counts", False, "Bootstrap data unavailable")
        return False
    # Check user 1's followers count
    response1 = make_request("GET", f"/users/{user1_data.get('user_id')}", token=user1_token)
    
    if response1 and response1.status_code == 200:
        data1 = response1.json()
        followers = data1.get("followers_count", 0)
        
        # Check user 2's following count
        response2 = make_request("GET", f"/users/{user2_data.get('user_id')}", token=user2_token)
        
        if response2 and response2.status_code == 200:
            data2 = response2.json()
            following = data2.get("following_count", 0)
            
            if followers >= 1 and following >= 1:
                print_test("Verify Follower/Following Counts", True, f"User1 followers: {followers}, User2 following: {following}")
                return True
            else:
                print_test("Verify Follower/Following Counts", False, f"Expected >= 1 for both, got followers={followers}, following={following}")
                return False
        else:
            print_test("Verify Follower/Following Counts", False, "Failed to get user 2 profile")
            return False
    else:
        print_test("Verify Follower/Following Counts", False, "Failed to get user 1 profile")
        return False

def test_unfollow_user():
    """Test DELETE /users/{user_id}/follow endpoint"""
    if not tests_ready():
        print_test("DELETE /users/{user_id}/follow", False, "Bootstrap data unavailable")
        return False
    response = make_request("DELETE", f"/users/{user1_data.get('user_id')}/follow", token=user2_token)
    
    if response and response.status_code == 200:
        print_test("DELETE /users/{user_id}/follow", True, "User 2 unfollowed User 1")
        return True
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("DELETE /users/{user_id}/follow", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_verify_unfollow():
    """Verify that unfollow worked"""
    if not tests_ready():
        print_test("Verify Unfollow", False, "Bootstrap data unavailable")
        return False
    response = make_request("GET", f"/users/{user1_data.get('user_id')}/is-following", token=user2_token)
    
    if response and response.status_code == 200:
        data = response.json()
        if data.get("is_following") == False:
            print_test("Verify Unfollow", True, "Not following anymore")
            return True
        else:
            print_test("Verify Unfollow", False, f"Expected is_following=False, got {data.get('is_following')}")
            return False
    else:
        error = response.json().get("detail") if response else "No response"
        print_test("Verify Unfollow", False, f"Status: {response.status_code if response else 'N/A'}, Error: {error}")
        return False

def test_cannot_follow_self():
    """Test that users cannot follow themselves"""
    if not tests_ready():
        print_test("Cannot Follow Self", False, "Bootstrap data unavailable")
        return False
    response = make_request("POST", f"/users/{user1_data.get('user_id')}/follow", token=user1_token)
    
    if response and response.status_code == 400:
        print_test("Cannot Follow Self", True, "Correctly rejected")
        return True
    else:
        print_test("Cannot Follow Self", False, f"Expected 400, got {response.status_code if response else 'N/A'}")
        return False

# =======================
# MAIN TEST RUNNER
# =======================

def run_all_tests():
    """Run all backend API tests"""
    print("\n" + "="*80)
    print("  SOCIAL MEDIA BACKEND API - COMPREHENSIVE TEST SUITE")
    print("="*80)
    print(f"\nBackend URL: {BACKEND_URL}")
    print(f"Test User 1: {TEST_USER_1['email']}")
    print(f"Test User 2: {TEST_USER_2['email']}")
    
    # Authentication Tests
    print_section("1. AUTHENTICATION TESTS")
    test_register_user1()
    test_register_user2()
    test_get_me()
    test_unauthorized_access()

    if not tests_ready():
        print("\nBootstrap failed; skipping dependent API tests to avoid cascading errors.")
        print_section("TEST SUMMARY")
        total_tests = tests_passed + tests_failed
        pass_rate = (tests_passed / total_tests * 100) if total_tests > 0 else 0
        print(f"Total Tests: {total_tests}")
        print(f"Passed: {tests_passed} ✅")
        print(f"Failed: {tests_failed} ❌")
        print(f"Pass Rate: {pass_rate:.1f}%")
        return 1
    
    # User Profile Tests
    print_section("2. USER PROFILE TESTS")
    test_get_my_profile()
    test_update_profile()
    test_get_user_profile()
    
    # Post Tests
    print_section("3. POST TESTS")
    test_create_post()
    test_get_feed()
    test_get_single_post()
    
    # Like Tests
    print_section("4. LIKE TESTS")
    test_like_post()
    test_verify_like_count()
    test_unlike_post()
    
    # Comment Tests
    print_section("5. COMMENT TESTS")
    test_create_comment()
    test_get_comments()
    test_verify_comment_count()
    
    # Follow Tests
    print_section("6. FOLLOW SYSTEM TESTS")
    test_follow_user()
    test_check_following()
    test_verify_follower_counts()
    test_unfollow_user()
    test_verify_unfollow()
    test_cannot_follow_self()
    
    # Logout Test (at the end)
    print_section("7. LOGOUT TEST")
    test_logout()
    
    # Print Summary
    print_section("TEST SUMMARY")
    total_tests = tests_passed + tests_failed
    pass_rate = (tests_passed / total_tests * 100) if total_tests > 0 else 0
    
    print(f"Total Tests: {total_tests}")
    print(f"Passed: {tests_passed} ✅")
    print(f"Failed: {tests_failed} ❌")
    print(f"Pass Rate: {pass_rate:.1f}%")
    
    if failed_tests:
        print("\n" + "="*80)
        print("  FAILED TESTS DETAILS")
        print("="*80 + "\n")
        for i, failure in enumerate(failed_tests, 1):
            print(f"{i}. {failure}")
    
    print("\n" + "="*80 + "\n")
    
    # Return exit code
    return 0 if tests_failed == 0 else 1

if __name__ == "__main__":
    exit_code = run_all_tests()
    sys.exit(exit_code)
