# Persistent Refresh Tokens - Design Document

## Problem Statement

**Current Behavior:**
- OAuth2 refresh tokens are stored in server memory/session
- When dev server hibernates → tokens are lost
- User must re-authenticate via OAuth2 flow after every hibernation
- Causes 5+ minutes of downtime for testing and development

**Goal:**
- Store refresh tokens in database (encrypted)
- Restore tokens on server startup
- Eliminate re-authentication after server hibernation

---

## Solution Architecture

### 1. Database Schema

Add new table `oauth_tokens`:

```sql
CREATE TABLE oauth_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  provider VARCHAR(50) NOT NULL, -- 'tastytrade', 'tradier', etc.
  refresh_token TEXT NOT NULL,   -- Encrypted refresh token
  access_token TEXT,              -- Encrypted access token (optional)
  expires_at TIMESTAMP,           -- Access token expiration
  scopes TEXT,                    -- OAuth scopes granted
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_provider (user_id, provider),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
```

### 2. Encryption Strategy

**Algorithm:** AES-256-GCM (Galois/Counter Mode)
**Key Source:** Environment variable `OAUTH_TOKEN_ENCRYPTION_KEY` (32 bytes)
**IV (Initialization Vector):** Randomly generated per token (12 bytes)
**Storage Format:** `{iv}:{encrypted_data}:{auth_tag}` (Base64 encoded)

**Encryption Flow:**
1. Generate random IV (12 bytes)
2. Encrypt refresh token using AES-256-GCM
3. Concatenate IV + encrypted data + auth tag
4. Base64 encode entire string
5. Store in database

**Decryption Flow:**
1. Base64 decode stored string
2. Extract IV, encrypted data, auth tag
3. Decrypt using AES-256-GCM
4. Verify auth tag (ensures integrity)
5. Return plaintext refresh token

### 3. Implementation Files

**New Files:**
- `server/token-encryption.ts` - Encryption/decryption utilities
- `server/token-persistence.ts` - Database CRUD operations
- `drizzle/schema.ts` - Add `oauthTokens` table

**Modified Files:**
- `server/_core/oauth.ts` - Store tokens after OAuth2 callback
- `server/_core/index.ts` - Restore tokens on server startup
- `server/routers.ts` - Update token refresh endpoint

---

## Implementation Steps

### Phase 1: Database & Encryption (Week 1)

1. **Add `oauth_tokens` table to schema**
   ```typescript
   export const oauthTokens = sqliteTable('oauth_tokens', {
     id: integer('id').primaryKey({ autoIncrement: true }),
     userId: integer('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
     provider: text('provider').notNull(), // 'tastytrade'
     refreshToken: text('refresh_token').notNull(), // Encrypted
     accessToken: text('access_token'), // Encrypted (optional)
     expiresAt: integer('expires_at', { mode: 'timestamp' }),
     scopes: text('scopes'),
     createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
     updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
   }, (table) => ({
     uniqueUserProvider: unique().on(table.userId, table.provider),
   }));
   ```

2. **Create encryption utilities**
   ```typescript
   // server/token-encryption.ts
   import crypto from 'crypto';
   
   const ALGORITHM = 'aes-256-gcm';
   const KEY = Buffer.from(process.env.OAUTH_TOKEN_ENCRYPTION_KEY || '', 'hex');
   
   export function encryptToken(plaintext: string): string {
     const iv = crypto.randomBytes(12);
     const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
     
     let encrypted = cipher.update(plaintext, 'utf8', 'base64');
     encrypted += cipher.final('base64');
     
     const authTag = cipher.getAuthTag().toString('base64');
     
     return `${iv.toString('base64')}:${encrypted}:${authTag}`;
   }
   
   export function decryptToken(encrypted: string): string {
     const [ivB64, dataB64, authTagB64] = encrypted.split(':');
     
     const iv = Buffer.from(ivB64, 'base64');
     const authTag = Buffer.from(authTagB64, 'base64');
     const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
     decipher.setAuthTag(authTag);
     
     let decrypted = decipher.update(dataB64, 'base64', 'utf8');
     decrypted += decipher.final('utf8');
     
     return decrypted;
   }
   ```

3. **Create database persistence layer**
   ```typescript
   // server/token-persistence.ts
   import { db } from './db';
   import { oauthTokens } from '../drizzle/schema';
   import { encryptToken, decryptToken } from './token-encryption';
   import { eq, and } from 'drizzle-orm';
   
   export async function saveTokens(
     userId: number,
     provider: string,
     refreshToken: string,
     accessToken?: string,
     expiresAt?: Date,
     scopes?: string[]
   ) {
     const encryptedRefresh = encryptToken(refreshToken);
     const encryptedAccess = accessToken ? encryptToken(accessToken) : null;
     
     await db.insert(oauthTokens).values({
       userId,
       provider,
       refreshToken: encryptedRefresh,
       accessToken: encryptedAccess,
       expiresAt,
       scopes: scopes?.join(','),
     }).onConflictDoUpdate({
       target: [oauthTokens.userId, oauthTokens.provider],
       set: {
         refreshToken: encryptedRefresh,
         accessToken: encryptedAccess,
         expiresAt,
         scopes: scopes?.join(','),
         updatedAt: new Date(),
       },
     });
   }
   
   export async function getTokens(userId: number, provider: string) {
     const result = await db.select().from(oauthTokens)
       .where(and(
         eq(oauthTokens.userId, userId),
         eq(oauthTokens.provider, provider)
       ))
       .limit(1);
     
     if (!result[0]) return null;
     
     return {
       refreshToken: decryptToken(result[0].refreshToken),
       accessToken: result[0].accessToken ? decryptToken(result[0].accessToken) : null,
       expiresAt: result[0].expiresAt,
       scopes: result[0].scopes?.split(',') || [],
     };
   }
   
   export async function deleteTokens(userId: number, provider: string) {
     await db.delete(oauthTokens)
       .where(and(
         eq(oauthTokens.userId, userId),
         eq(oauthTokens.provider, provider)
       ));
   }
   ```

### Phase 2: OAuth2 Integration (Week 2)

4. **Modify OAuth2 callback to save tokens**
   ```typescript
   // server/_core/oauth.ts
   import { saveTokens } from './token-persistence';
   
   // After successful OAuth2 callback
   await saveTokens(
     user.id,
     'tastytrade',
     refreshToken,
     accessToken,
     new Date(Date.now() + expiresIn * 1000),
     scopes
   );
   ```

5. **Restore tokens on server startup**
   ```typescript
   // server/_core/index.ts
   import { getTokens } from './token-persistence';
   
   async function restoreOAuthTokens() {
     // Get all users with saved tokens
     const users = await db.select().from(user);
     
     for (const u of users) {
       const tokens = await getTokens(u.id, 'tastytrade');
       if (tokens) {
         // Store in memory/session for immediate use
         // (Implementation depends on session management strategy)
         console.log(`[OAuth] Restored tokens for user ${u.id}`);
       }
     }
   }
   
   // Call on server startup
   async function startServer() {
     // ... existing code ...
     
     await restoreOAuthTokens();
     
     server.listen(port, () => {
       console.log(`Server running on http://localhost:${port}/`);
     });
   }
   ```

### Phase 3: Token Refresh & Rotation (Week 3)

6. **Update token refresh endpoint**
   ```typescript
   // server/routers.ts (settings router)
   forceTokenRefresh: protectedProcedure.mutation(async ({ ctx }) => {
     // Try to refresh using stored token
     const storedTokens = await getTokens(ctx.user.id, 'tastytrade');
     
     if (!storedTokens) {
       throw new Error('No stored refresh token found');
     }
     
     // Refresh access token
     const newTokens = await refreshAccessToken(storedTokens.refreshToken);
     
     // Save updated tokens
     await saveTokens(
       ctx.user.id,
       'tastytrade',
       newTokens.refreshToken, // May be rotated
       newTokens.accessToken,
       new Date(Date.now() + newTokens.expiresIn * 1000),
       newTokens.scopes
     );
     
     return { expiresAt: newTokens.expiresAt };
   }),
   ```

7. **Implement token rotation policy**
   - Refresh tokens may be rotated on each use (depends on Tastytrade API)
   - Always save new refresh token after successful refresh
   - Delete old tokens after rotation

### Phase 4: Security Hardening (Week 4)

8. **Environment variable validation**
   ```typescript
   // server/_core/env.ts
   if (!process.env.OAUTH_TOKEN_ENCRYPTION_KEY) {
     throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY must be set');
   }
   
   if (Buffer.from(process.env.OAUTH_TOKEN_ENCRYPTION_KEY, 'hex').length !== 32) {
     throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
   }
   ```

9. **Generate encryption key**
   ```bash
   # Generate 32-byte (256-bit) key
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

10. **Add to .env**
    ```
    OAUTH_TOKEN_ENCRYPTION_KEY=<generated_key>
    ```

---

## Security Considerations

### Encryption Key Management
- ✅ Store key in environment variable (never commit to git)
- ✅ Use different keys for dev/staging/production
- ✅ Rotate keys periodically (requires re-encryption of all tokens)
- ✅ Use key derivation function (KDF) if storing key in secrets manager

### Database Security
- ✅ Restrict database access to application server only
- ✅ Enable database encryption at rest (if available)
- ✅ Use SSL/TLS for database connections
- ✅ Audit database access logs

### Token Expiration
- ✅ Implement automatic cleanup of expired tokens (cron job)
- ✅ Refresh access tokens before expiration
- ✅ Handle refresh token expiration gracefully (force re-login)

### Audit Logging
- ✅ Log all token encryption/decryption operations
- ✅ Log token refresh attempts (success/failure)
- ✅ Alert on suspicious activity (multiple failed refreshes)

---

## Testing Strategy

### Unit Tests
- Encryption/decryption roundtrip
- Token storage/retrieval
- Token rotation
- Expiration handling

### Integration Tests
- OAuth2 callback → token storage
- Server restart → token restoration
- Token refresh → token update
- Token expiration → re-authentication

### Security Tests
- Encrypted tokens cannot be decrypted without key
- Database dump does not expose plaintext tokens
- Key rotation works correctly
- Token deletion is complete

---

## Rollout Plan

### Development Environment
1. Implement encryption utilities
2. Add database table
3. Test token storage/retrieval
4. Test server restart with token restoration

### Staging Environment
1. Deploy with encryption key
2. Test OAuth2 flow end-to-end
3. Monitor for errors
4. Verify token persistence across restarts

### Production Environment
1. Generate production encryption key
2. Deploy code changes
3. Migrate existing users (force re-login to populate tokens)
4. Monitor token refresh success rate
5. Enable automatic cleanup of expired tokens

---

## Rollback Plan

If persistent tokens cause issues:

1. **Disable token restoration** on server startup
2. **Keep token storage** (for future re-enable)
3. **Fall back to current behavior** (re-login after hibernation)
4. **Investigate and fix** root cause
5. **Re-enable** after validation

---

## Estimated Effort

- **Phase 1:** 2-3 days (database, encryption)
- **Phase 2:** 2-3 days (OAuth2 integration)
- **Phase 3:** 2-3 days (token refresh, rotation)
- **Phase 4:** 1-2 days (security hardening)
- **Testing:** 2-3 days (unit, integration, security)

**Total:** 2-3 weeks

---

## Success Metrics

- ✅ Zero re-logins required after server hibernation
- ✅ Token refresh success rate > 99%
- ✅ No plaintext tokens in database dumps
- ✅ Server startup time < 5 seconds (including token restoration)
- ✅ Zero security incidents related to token storage

---

**Status:** Design Complete - Awaiting Implementation
**Priority:** Medium (Quality of Life Improvement)
**Dependencies:** None
**Risks:** Encryption key management, token rotation complexity
