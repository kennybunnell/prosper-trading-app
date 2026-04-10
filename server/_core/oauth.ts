import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { addPartitionedAttribute, getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);

      // Debug logging to trace cookie/JWT issues
      const secretPrefix = ENV.cookieSecret ? ENV.cookieSecret.substring(0, 8) + '...' : 'EMPTY';
      console.log('[OAuth] JWT_SECRET prefix used for signing:', secretPrefix);
      console.log('[OAuth] Cookie options:', JSON.stringify(cookieOptions));
      console.log('[OAuth] req.protocol:', req.protocol, '| x-forwarded-proto:', req.headers['x-forwarded-proto']);

      // Immediately verify the token we just signed to catch any secret mismatch
      const verifyTest = await sdk.verifySession(sessionToken);
      console.log('[OAuth] Immediate verify test:', verifyTest ? 'PASS (openId=' + verifyTest.openId + ')' : 'FAIL - SECRET MISMATCH');

      // Clear any stale cookie first (handles sandbox URL changes where old JWT_SECRET is invalid)
      res.clearCookie(COOKIE_NAME, cookieOptions);

      // Set the fresh session cookie
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // Add Partitioned attribute for CHIPS support.
      // The Manus preview panel embeds the app in an iframe on manus.im.
      // Chrome blocks unpartitioned third-party cookies in cross-site iframes,
      // so without Partitioned the browser silently discards the cookie and
      // every subsequent request arrives without a session cookie.
      addPartitionedAttribute(res);

      // Also pass the token in the URL hash as a fallback for environments where
      // cookies are completely blocked (e.g. strict browser settings, some iframe
      // contexts). The frontend reads the hash, stores the token in localStorage,
      // and sends it as an Authorization header on all API requests.
      console.log('[OAuth] Redirecting to / with new session cookie (Partitioned) + URL token fallback');
      res.redirect(302, `/?_t=${encodeURIComponent(sessionToken)}`);

      // Fire background portfolio sync after login (non-blocking)
      // This populates the DB cache so AI advisors have fresh data immediately
      const userRecord = await db.getUserByOpenId(userInfo.openId);
      const userId = userRecord?.id;
      if (userId) {
        import('../portfolio-sync').then(({ syncPortfolio }) => {
          syncPortfolio(userId, false).catch((err) => {
            console.error('[OAuth] Background portfolio sync failed:', err.message);
          });
        }).catch(() => {/* ignore import errors */});
        console.log(`[OAuth] Background portfolio sync triggered for user ${userId}`);
      }
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
