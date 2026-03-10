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
  app.get("/api/heartbeat", (req, res) => {
    res.json({ 
      status: "alive", 
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
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
  });
}

startServer().catch(console.error);
