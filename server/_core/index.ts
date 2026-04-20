import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "../webhooks/stripe.js";
import { initializeAutomationScheduler } from "../automation-scheduler";
import { initializePortfolioSyncScheduler } from "../portfolio-sync-scheduler";
import { registerTelegramWebhook, answerCallbackQuery, editTelegramMessage, sendTelegramMessage } from "../telegram";
import { handleTelegramCallback } from "../telegram-callbacks";
import { handleTelegramCommand } from "../telegram-commands";
import { initializeTelegramBriefingScheduler } from "../telegram-briefing";
import { sdk } from "./sdk";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  
  // Trust the reverse proxy (Manus sandbox proxy) so req.protocol and
  // x-forwarded-proto headers are respected. Required for sameSite:'none'
  // cookies to work — browsers require secure:true when sameSite:'none'.
  app.set('trust proxy', 1);
  
  // Stripe webhook endpoint (MUST be before body parser middleware)
  // Stripe requires raw body for signature verification
  app.post("/api/webhooks/stripe", express.raw({ type: 'application/json' }), handleStripeWebhook);

  // Telegram webhook endpoint (receives button taps and messages from Telegram)
  app.post("/api/telegram/webhook", express.json(), async (req, res) => {
    res.sendStatus(200); // Always respond 200 immediately to Telegram
    const update = req.body;
    if (update?.callback_query) {
      await handleTelegramCallback(update.callback_query);
    }
    // Handle inbound text commands (/help, /briefing, /positions, etc.)
    if (update?.message?.text) {
      await handleTelegramCommand(update).catch(err =>
        console.error('[Telegram] Command handler error:', err.message)
      );
    }
  });
  
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  
  // Cookie debug endpoint - helps diagnose auth issues in preview panel
  app.get("/api/debug/cookies", (req, res) => {
    const cookieHeader = req.headers.cookie || '';
    const cookies = cookieHeader.split(';').map(c => c.trim()).filter(Boolean);
    res.json({
      cookieHeader: cookieHeader ? cookieHeader.substring(0, 200) : '(none)',
      cookieCount: cookies.length,
      cookieNames: cookies.map(c => c.split('=')[0]),
      protocol: req.protocol,
      forwardedProto: req.headers['x-forwarded-proto'],
      secure: req.secure,
      host: req.hostname,
    });
  });

  // Heartbeat endpoint to keep server awake
  // Temporary debug endpoint — checks what user + data the Telegram bot resolves in production
  app.get("/api/telegram/debug", async (req, res) => {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return res.json({ error: 'No DB connection' });
      const { users, cachedTransactions, cachedPositions } = await import('../../drizzle/schema');
      const { eq, and, gte, count } = await import('drizzle-orm');
      const allUsers = await db.select({ id: users.id, name: users.name, openId: users.openId }).from(users);
      const firstUserId = allUsers[0]?.id ?? null;
      let txnCount = 0, posCount = 0, aprilStoCount = 0;
      if (firstUserId) {
        const txnResult = await db.select({ c: count() }).from(cachedTransactions).where(eq(cachedTransactions.userId, firstUserId));
        txnCount = Number(txnResult[0]?.c ?? 0);
        const posResult = await db.select({ c: count() }).from(cachedPositions).where(eq(cachedPositions.userId, firstUserId));
        posCount = Number(posResult[0]?.c ?? 0);
        const aprilStart = new Date('2026-04-01');
        const aprilSto = await db.select({ c: count() }).from(cachedTransactions).where(and(eq(cachedTransactions.userId, firstUserId), gte(cachedTransactions.executedAt, aprilStart), eq(cachedTransactions.action, 'Sell to Open')));
        aprilStoCount = Number(aprilSto[0]?.c ?? 0);
      }
      // Check credentials for user 1
      let hasCredentials = false, hasRefreshToken = false;
      let ttAccounts: any[] = [];
      if (firstUserId) {
        const { apiCredentials, tastytradeAccounts } = await import('../../drizzle/schema');
        const creds = await db.select({
          clientSecret: apiCredentials.tastytradeClientSecret,
          refreshToken: apiCredentials.tastytradeRefreshToken
        }).from(apiCredentials).where(eq(apiCredentials.userId, firstUserId)).limit(1);
        hasCredentials = creds.length > 0;
        hasRefreshToken = !!(creds[0]?.refreshToken);
        ttAccounts = await db.select({ accountNumber: tastytradeAccounts.accountNumber, accountType: tastytradeAccounts.accountType }).from(tastytradeAccounts).where(eq(tastytradeAccounts.userId, firstUserId));
      }
      // Sample a few cached positions to check field names
      let samplePos: any[] = [];
      if (firstUserId && posCount > 0) {
        samplePos = await db.select().from(cachedPositions).where(eq(cachedPositions.userId, firstUserId)).limit(2);
      }
      // Test getLivePositions directly
      let livePositionsResult: any = { error: 'not tested' };
      if (firstUserId) {
        try {
          const { getLivePositions } = await import('../portfolio-sync');
          const livePos = await getLivePositions(firstUserId);
          const shortOpts = livePos.filter((p: any) =>
            (p['instrument-type'] === 'Equity Option' || p['instrument-type'] === 'Index Option') &&
            (p['quantity-direction'] || '').toLowerCase() === 'short'
          );
          livePositionsResult = {
            total: livePos.length,
            shortOptions: shortOpts.length,
            sampleFields: livePos[0] ? Object.keys(livePos[0]) : [],
            sampleFirst: livePos[0] || null
          };
        } catch (liveErr: any) {
          livePositionsResult = { error: liveErr.message };
        }
      }
      res.json({ users: allUsers, firstUserId, txnCount, posCount, aprilStoCount, hasCredentials, hasRefreshToken, ttAccounts, samplePos, livePositionsResult });
    } catch (err: any) {
      res.json({ error: err.message });
    }
  });

  app.get("/api/heartbeat", (req, res) => {
    res.json({ 
      status: "alive", 
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });
  
  // Database export endpoint — owner-only, returns a time-limited S3 download URL
  app.get("/api/export/database", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      const ownerOpenId = process.env.OWNER_OPEN_ID;
      if (ownerOpenId && user.openId !== ownerOpenId) {
        return res.status(403).json({ error: 'Owner access required' });
      }
      const { exportDatabase } = await import('../db-export');
      const result = await exportDatabase(user.id);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Export failed' });
    }
  });

  // Telegram briefing trigger (available in all environments — used by Settings page)
  app.post("/api/dev/trigger-telegram-briefing", async (req, res) => {
    try {
      const { triggerDailyBriefingNow } = await import('../telegram-briefing');
      await triggerDailyBriefingNow();
      res.json({ success: true, message: 'Telegram briefing triggered' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // Dev utilities endpoint (development only)
  if (process.env.NODE_ENV === "development") {
    // Dev endpoint to trigger daily scan immediately (no auth required in dev)
    app.post("/api/dev/trigger-daily-scan", async (req, res) => {
      try {
        const { runDailyScanForAllUsersExport } = await import('../automation-scheduler');
        await runDailyScanForAllUsersExport();
        res.json({ success: true, message: 'Daily scan triggered for all users' });
      } catch (e: any) {
        res.status(500).json({ success: false, error: e?.message });
      }
    });

    app.post("/api/dev/restart", (req, res) => {
      console.log("[Dev] Restart requested via API");
      res.json({ success: true, message: "Server restarting..." });
      
      // Delay restart to allow response to be sent
      setTimeout(() => {
        console.log("[Dev] Restarting server...");
        process.exit(0); // Process manager will restart the server
      }, 500);
    });
    
    // Server-side self-ping to prevent hibernation (randomized intervals)
    let heartbeatTimeout: NodeJS.Timeout;
    const scheduleNextHeartbeat = () => {
      // Random interval between 3-7 minutes (180-420 seconds)
      const minInterval = 3 * 60 * 1000; // 3 minutes
      const maxInterval = 7 * 60 * 1000; // 7 minutes
      const randomInterval = Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;
      
      heartbeatTimeout = setTimeout(async () => {
        try {
          const port = parseInt(process.env.PORT || "3000");
          const response = await fetch(`http://localhost:${port}/api/heartbeat`);
          const data = await response.json();
          const nextPingIn = Math.floor(randomInterval / 60000);
          console.log(`[Heartbeat] Server self-ping successful - uptime: ${Math.floor(data.uptime)}s, next ping in ~${nextPingIn} minutes`);
        } catch (error) {
          console.error('[Heartbeat] Server self-ping failed:', error);
        }
        
        // Schedule next heartbeat with new random interval
        scheduleNextHeartbeat();
      }, randomInterval);
    };
    
    // Start heartbeat after server is running
    setTimeout(() => {
      console.log('[Heartbeat] Server-side heartbeat started (randomized 3-7 minute intervals)');
      scheduleNextHeartbeat();
    }, 10000); // Wait 10 seconds after server starts
  }
  
  // Earnings calendar pre-flight check endpoint
  const { earningsCheckRouter } = await import('../earningsCheckRoute');
  app.use(earningsCheckRouter);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    
    // Initialize automation scheduler
    initializeAutomationScheduler();
    // Initialize portfolio sync scheduler (15-min incremental sync during market hours)
    initializePortfolioSyncScheduler();
    // Register Telegram webhook (idempotent — safe to call every startup)
    const appBaseUrl = process.env.APP_BASE_URL || 'https://prospertrading.biz';
    registerTelegramWebhook(appBaseUrl).catch(console.error);
    // Initialize Telegram daily briefing scheduler (8:30 AM MT weekdays)
    initializeTelegramBriefingScheduler();
  });
}

startServer().catch(console.error);
