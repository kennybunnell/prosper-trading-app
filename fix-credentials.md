# Tastytrade OAuth2 Credentials - Troubleshooting Guide

## Overview

This document explains how Tastytrade OAuth2 authentication works in the development environment and how to troubleshoot common issues.

---

## OAuth2 vs. Username/Password Authentication

### Old System (Username/Password)
- **Storage:** Credentials stored in environment variables
- **Persistence:** Always available when server restarts
- **Re-login:** Not required after server hibernation
- **Security:** Less secure (credentials in plaintext)

### New System (OAuth2)
- **Storage:** Access tokens (short-lived) + Refresh tokens (session-based)
- **Persistence:** Tokens stored in memory/session, cleared on server hibernation
- **Re-login:** Required after server hibernation
- **Security:** More secure (OAuth2 standard, scoped permissions)

---

## Why OAuth2 Tokens Are Lost

**Root Cause:** OAuth2 refresh tokens are stored in server memory/session state.

**What Happens:**
1. Dev server runs → OAuth2 login → Access token + Refresh token stored in memory
2. Dev server hibernates (after inactivity) → Memory cleared → Tokens lost
3. Dev server wakes up → No tokens available → Authentication fails
4. User must re-authenticate via OAuth2 flow

**Why This Doesn't Happen in Production:**
- Production servers run continuously (no hibernation)
- Tokens remain in memory throughout server uptime
- Refresh tokens automatically renew access tokens before expiration

---

## Common Error Messages

### 1. "Token has insufficient scopes for this request"
**Meaning:** Access token expired or has wrong permissions

**Solution:**
1. Click "Force Token Refresh" button in Settings
2. If that fails, server will auto-restart and redirect to login
3. Complete OAuth2 login flow

### 2. "Token refresh failed"
**Meaning:** Refresh token is invalid or expired (usually after server hibernation)

**Solution:**
1. Click "Force Token Refresh" button → Server restarts automatically
2. Wait 10-15 seconds for server to restart
3. You'll be redirected to OAuth2 login page
4. Complete login flow

### 3. "Unauthorized" or "401 Error"
**Meaning:** No valid access token available

**Solution:**
1. Restart dev server manually (if Force Token Refresh doesn't work)
2. Navigate to `/api/oauth/login` to start OAuth2 flow
3. Complete authentication

---

## Development Workflow

### Normal Workflow (Server Running)
1. Open app → Already logged in → Works normally
2. Access tokens auto-refresh using refresh token
3. No manual intervention needed

### After Server Hibernation
1. Open app → Authentication error appears
2. Click "Force Token Refresh" button in Settings
3. Server restarts automatically (takes ~10-15 seconds)
4. Redirected to OAuth2 login page
5. Complete login → Back to working state

### Manual Restart (If Force Token Refresh Fails)
1. Stop dev server (if running)
2. Start dev server: `pnpm dev`
3. Wait for server to fully start (~10-15 seconds)
4. Navigate to app → Click login → Complete OAuth2 flow

---

## Force Token Refresh Button Behavior

**Location:** Settings page → Tastytrade Credentials section

**What It Does:**
1. Attempts to refresh access token using refresh token
2. **If successful:** Shows success message with new token expiration time
3. **If failed:** Automatically restarts dev server and redirects to OAuth2 login

**When to Use:**
- After dev server wakes from hibernation
- When seeing "Token has insufficient scopes" errors
- When API calls fail with 401/403 errors
- After extended periods of inactivity

---

## Best Practices

### For Development
1. **Keep dev server running** during active development to avoid token loss
2. **Use Force Token Refresh** as first troubleshooting step
3. **Don't panic** - OAuth2 re-login is expected after hibernation
4. **Bookmark OAuth2 login URL:** `/api/oauth/login` for quick access

### For Testing
1. **Restart server before testing** to ensure fresh authentication state
2. **Complete OAuth2 login** before running any API-dependent tests
3. **Check token expiration** in Settings if tests fail unexpectedly

### For Production
- OAuth2 tokens persist throughout server uptime (no hibernation)
- Refresh tokens automatically renew access tokens
- No manual intervention required

---

## Persistent Refresh Tokens (Future Enhancement)

**Goal:** Store refresh tokens in database (encrypted) to survive server hibernation

**Benefits:**
- No re-login required after server hibernation
- Seamless development experience
- Automatic token restoration on server startup

**Implementation Status:** Planned for future release

**Security Considerations:**
- Tokens must be encrypted at rest (AES-256)
- Database access must be restricted
- Token rotation policy must be implemented

---

## Troubleshooting Checklist

When authentication fails, try these steps in order:

- [ ] 1. Click "Force Token Refresh" button in Settings
- [ ] 2. Wait for server restart (if triggered)
- [ ] 3. Complete OAuth2 login if redirected
- [ ] 4. If still failing, manually restart dev server
- [ ] 5. Navigate to `/api/oauth/login` and complete login
- [ ] 6. Check browser console for specific error messages
- [ ] 7. Verify Tastytrade credentials are correct in Settings
- [ ] 8. Check that Client Secret and Refresh Token are saved

---

## FAQ

**Q: Why do I have to log in every time the dev server restarts?**
A: OAuth2 refresh tokens are stored in memory and lost when the server hibernates. This is expected behavior in development.

**Q: Will this happen in production?**
A: No. Production servers run continuously, so tokens remain in memory.

**Q: Can I avoid re-logging in after hibernation?**
A: Not currently. Persistent refresh tokens (stored in database) are planned for a future release.

**Q: How long does the Force Token Refresh take?**
A: If it triggers a server restart, expect 10-15 seconds for the server to restart and redirect to login.

**Q: What if Force Token Refresh doesn't work?**
A: Manually restart the dev server using `pnpm dev`, then navigate to `/api/oauth/login`.

---

## Related Files

- **OAuth2 Implementation:** `server/_core/oauth.ts`
- **Token Refresh Endpoint:** `server/routers.ts` (settings router)
- **Force Token Refresh UI:** `client/src/pages/Settings.tsx`
- **Dev Server Restart:** `server/_core/index.ts` (`/api/dev/restart` endpoint)

---

**Last Updated:** February 13, 2026
**Version:** 1.0
