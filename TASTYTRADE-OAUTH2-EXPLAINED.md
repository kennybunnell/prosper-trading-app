# Tastytrade OAuth2 Authentication - Complete Explanation

**Source:** Official Tastytrade API Documentation (https://developer.tastytrade.com/oauth)

## The Three Credentials (One-Time Setup)

### 1. Client ID
- **What it is:** A unique identifier for your OAuth application
- **When you get it:** When you create an OAuth application at my.tastytrade.com → My Profile → API → OAuth Applications
- **Expiration:** NEVER expires
- **Storage:** Can be stored anywhere (not secret)
- **Purpose:** Identifies which application is making the request

### 2. Client Secret
- **What it is:** A secret password for your OAuth application
- **When you get it:** Shown ONCE when you create the OAuth application (store it immediately!)
- **Expiration:** NEVER expires (unless you manually regenerate it)
- **Storage:** MUST be stored securely (never share, never commit to git)
- **Purpose:** Proves that the request is coming from your legitimate application
- **If lost:** You can regenerate it at my.tastytrade.com → Manage → Settings, but this will invalidate all existing grants

### 3. Refresh Token (Personal Grant)
- **What it is:** A long-lived token that allows you to get new access tokens
- **When you get it:** When you click "Create Grant" in your OAuth application settings
- **Expiration:** **NEVER EXPIRES** (according to official docs: "Refresh tokens are long-lived and do not expire")
- **Storage:** MUST be stored securely in database
- **Purpose:** Used to generate new 15-minute access tokens without re-entering your password
- **If lost/compromised:** Delete the grant and create a new one (this gives you a new refresh token)

## The Short-Lived Token (Generated Every 15 Minutes)

### 4. Access Token
- **What it is:** A temporary token that authorizes API requests
- **When you get it:** By sending a POST request to `/oauth/token` with your refresh token + client secret
- **Expiration:** **15 MINUTES** after generation
- **Storage:** Should be stored in memory AND database (for persistence across server restarts)
- **Purpose:** Sent in the `Authorization: Bearer <access_token>` header of every API request
- **If expired:** Request a new one using the refresh token (no user interaction needed)

## The Complete Flow

### Initial Setup (One Time Only)
1. Go to my.tastytrade.com → My Profile → API → OAuth Applications
2. Click "+ New OAuth client"
3. Fill in:
   - Client Name: (auto-populated with your username)
   - Redirect URI: https://www.my-redirect-uri.com (or any valid URI)
   - Scopes: **read, trade, openid** (check ALL three)
4. Click "Create"
5. **IMMEDIATELY SAVE:**
   - Client ID (shown on screen)
   - Client Secret (shown ONCE - if you lose it, you must regenerate)
6. Click "Manage" → "Create Grant"
7. **IMMEDIATELY SAVE:**
   - Refresh Token (shown once per grant)

### Daily Operation (Automatic)

#### When Server Starts:
1. Load refresh token from database
2. Load client secret from database
3. Load access token from database (if exists)
4. Check if access token is expired:
   - **If NOT expired:** Use it for API requests
   - **If expired or missing:** Request new access token (see below)

#### Requesting a New Access Token (Every ~15 Minutes):
```http
POST https://api.tastyworks.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=<YOUR_REFRESH_TOKEN>
&client_secret=<YOUR_CLIENT_SECRET>
```

**Response:**
```json
{
  "access_token": "eyJhbGc...",  // Use this for next 15 minutes
  "token_type": "Bearer",
  "expires_in": 900              // 900 seconds = 15 minutes
}
```

#### Using the Access Token:
```http
GET https://api.tastyworks.com/accounts
Authorization: Bearer <access_token>
```

## What Happens After Server Restart

### ✅ CORRECT Behavior (What Should Happen):
1. Server restarts
2. Code loads refresh token from database
3. Code loads client secret from database
4. Code loads access token from database
5. Code checks if access token is expired
6. **If expired:** Code sends POST /oauth/token with refresh_token + client_secret
7. Tastytrade returns NEW access token (valid for 15 minutes)
8. Code saves new access token to database
9. Code uses new access token for API requests

### ❌ CURRENT Problem:
- Steps 1-6 work correctly
- Step 7 FAILS with 403 "Token has insufficient scopes for this request"
- This means either:
  a) The refresh token in database is invalid/corrupted
  b) The client secret in database is invalid/corrupted
  c) The refresh token was revoked (by deleting the grant)
  d) The scopes were not set correctly when creating the grant

## Troubleshooting

### Error: "Token has insufficient scopes for this request"

This error can mean TWO different things depending on which endpoint returns it:

1. **When calling `/oauth/token` (refresh endpoint):**
   - The refresh token OR client secret is invalid
   - The refresh token was revoked (grant was deleted)
   - The grant was created without all required scopes (read, trade, openid)

2. **When calling other API endpoints (e.g., `/accounts`):**
   - The access token is expired (need to refresh)
   - The access token doesn't have the required scope for that specific endpoint

### Solution:
1. Go to my.tastytrade.com → My Profile → API → OAuth Applications
2. Click "Manage" on your application
3. Check if any grants exist:
   - **If NO grants exist:** The refresh token was deleted → Create new grant
   - **If grant exists:** Check the scopes → Should show "read, trade, openid"
4. If scopes are missing:
   - Delete the grant
   - Create new grant with ALL scopes checked
   - Save the new refresh token to database

## Summary

**You NEVER need to regenerate:**
- Client ID (never changes, never expires)
- Client Secret (never expires unless you manually regenerate)
- Refresh Token (never expires unless you delete the grant)

**You ALWAYS need to regenerate (every 15 minutes):**
- Access Token (expires after 15 minutes, auto-refreshed using refresh token)

**The "Refresh Token" button should:**
1. Load refresh_token from database
2. Load client_secret from database
3. POST to /oauth/token with both
4. Get new access_token (valid for 15 minutes)
5. Save new access_token to database
6. Return success

**It should NOT:**
- Ask user for new credentials
- Require user to go to Tastytrade website
- Regenerate the refresh token
