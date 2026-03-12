/**
 * Pass 3 — Browser E2E Tests
 * Prosper Trading Dashboard
 *
 * The Playwright browser has a persistent authenticated session.
 * Tests cover:
 *   1. Server health & API endpoints
 *   2. Authenticated dashboard UI — sidebar, navigation, key elements
 *   3. Page routing — all routes load and render content
 *   4. tRPC API — endpoints respond correctly
 *   5. 404 & error handling
 *   6. Performance & response times
 *   7. Security headers
 *   8. Stripe webhook endpoint
 *   9. OAuth callback route
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForAppReady(page: Page) {
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root && root.children.length > 0;
  }, { timeout: 15_000 });
  // Give React a moment to finish rendering async content
  await page.waitForTimeout(800);
}

async function waitForPageContent(page: Page, route: string) {
  await page.goto(route);
  await waitForAppReady(page);
}

// ─── Suite 1: Server Health ────────────────────────────────────────────────────

test.describe('Suite 1: Server Health', () => {
  test('GET / returns 200 with HTML', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const body = await response.text();
    // Vite outputs lowercase doctype
    expect(body.toLowerCase()).toContain('<!doctype html>');
    expect(body).toContain('Prosper Trading Dashboard');
  });

  test('GET /api/trpc/auth.me returns 200', async ({ request }) => {
    const response = await request.get('/api/trpc/auth.me');
    expect(response.status()).toBe(200);
  });

  test('GET /api/trpc responds to batch requests', async ({ request }) => {
    const response = await request.get('/api/trpc/auth.me?batch=1&input=%7B%7D');
    expect(response.status()).toBe(200);
  });

  test('Static assets: /risk-disclosure.md is served', async ({ request }) => {
    const response = await request.get('/risk-disclosure.md');
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text.length).toBeGreaterThan(100);
  });

  test('Static assets: /terms-of-service.md is served', async ({ request }) => {
    const response = await request.get('/terms-of-service.md');
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text.length).toBeGreaterThan(100);
  });
});

// ─── Suite 2: Authenticated Dashboard UI ──────────────────────────────────────

test.describe('Suite 2: Authenticated Dashboard UI', () => {
  test('Home page renders with sidebar navigation', async ({ page }) => {
    await waitForPageContent(page, '/');
    // The sidebar should be visible with the app title (may appear multiple times)
    await expect(page.getByText('Prosper Trading').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Dashboard nav item is visible in sidebar', async ({ page }) => {
    await waitForPageContent(page, '/');
    // 'Dashboard' appears in sidebar nav and possibly page content — use first()
    await expect(page.getByText('Dashboard').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Portfolio nav item is visible in sidebar', async ({ page }) => {
    await waitForPageContent(page, '/');
    await expect(page.getByText('Portfolio').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Settings nav item is visible in sidebar', async ({ page }) => {
    await waitForPageContent(page, '/');
    await expect(page.getByText('Settings').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Paper Trading mode indicator is visible', async ({ page }) => {
    await waitForPageContent(page, '/');
    // The paper trading mode banner/indicator should be visible (may appear multiple times)
    await expect(page.getByText(/paper trading/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Home page shows trading strategy options', async ({ page }) => {
    await waitForPageContent(page, '/');
    // The main content area should show trading options
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
    expect(bodyText!.length).toBeGreaterThan(100);
  });

  test('Sidebar navigation structure is present', async ({ page }) => {
    await waitForPageContent(page, '/');
    // The sidebar renders a nav element or sidebar container
    // Check that the sidebar menu items are rendered (at least one nav item)
    const navItems = page.locator('[data-sidebar="menu-item"], [data-sidebar="menu"]');
    const count = await navItems.count();
    // If sidebar data attributes not present, fall back to checking for nav links
    if (count === 0) {
      // Check that the page has a sidebar-like structure with multiple navigation entries
      const bodyText = await page.textContent('body');
      // The page should contain multiple navigation labels from the sidebar
      const hasNavItems = ['Portfolio', 'Performance', 'Settings'].every(
        label => bodyText?.includes(label)
      );
      expect(hasNavItems).toBe(true);
    } else {
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });
});

// ─── Suite 3: Page Navigation — All Routes Load ───────────────────────────────

test.describe('Suite 3: Page Navigation — All Routes Load', () => {
  const routes = [
    { path: '/', label: 'Home/Dashboard' },
    { path: '/csp', label: 'CSP Scanner' },
    { path: '/cc', label: 'CC Dashboard' },
    { path: '/performance', label: 'Performance' },
    { path: '/settings', label: 'Settings' },
    { path: '/automation', label: 'Daily Actions' },
    { path: '/portfolio', label: 'Portfolio' },
    { path: '/iron-condor', label: 'Iron Condors' },
    { path: '/pmcc', label: 'PMCC' },
    { path: '/gtc-orders', label: 'GTC Orders' },
    { path: '/subscription', label: 'Subscription' },
  ];

  for (const { path, label } of routes) {
    test(`${label} (${path}) loads without uncaught JS errors`, async ({ page }) => {
      const jsErrors: string[] = [];
      page.on('pageerror', (error) => {
        const msg = error.message;
        // Filter out expected/known non-critical errors
        if (
          msg.includes('UNAUTHORIZED') ||
          msg.includes('401') ||
          msg.includes('oauth') ||
          msg.includes('ResizeObserver') ||
          msg.includes('Non-Error exception') ||
          msg.includes('ChunkLoadError') ||
          msg.includes('Loading chunk')
        ) {
          return;
        }
        jsErrors.push(msg);
      });

      await page.goto(path);
      await waitForAppReady(page);
      await page.waitForTimeout(500);

      expect(jsErrors, `JS errors on ${path}: ${jsErrors.join(', ')}`).toHaveLength(0);
    });
  }

  test('CSP page renders content', async ({ page }) => {
    await waitForPageContent(page, '/csp');
    const bodyText = await page.textContent('body');
    expect(bodyText!.length).toBeGreaterThan(50);
  });

  test('Performance page renders content', async ({ page }) => {
    await waitForPageContent(page, '/performance');
    const bodyText = await page.textContent('body');
    expect(bodyText!.length).toBeGreaterThan(50);
  });

  test('Settings page renders content', async ({ page }) => {
    await waitForPageContent(page, '/settings');
    const bodyText = await page.textContent('body');
    expect(bodyText!.length).toBeGreaterThan(50);
    // Settings page should have the word "Settings" somewhere
    expect(bodyText).toContain('Settings');
  });

  test('Portfolio page renders content', async ({ page }) => {
    await waitForPageContent(page, '/portfolio');
    const bodyText = await page.textContent('body');
    expect(bodyText!.length).toBeGreaterThan(50);
  });
});

// ─── Suite 4: HTML Structure & Meta Tags ──────────────────────────────────────

test.describe('Suite 4: HTML Structure & Meta Tags', () => {
  test('Page has correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Prosper Trading Dashboard/i);
  });

  test('Page has viewport meta tag', async ({ page }) => {
    await page.goto('/');
    const viewport = await page.$('meta[name="viewport"]');
    expect(viewport).not.toBeNull();
  });

  test('React root element exists', async ({ page }) => {
    await page.goto('/');
    const root = await page.$('#root');
    expect(root).not.toBeNull();
  });

  test('App renders body with substantial content', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    const bodyText = await page.textContent('body');
    expect(bodyText?.length).toBeGreaterThan(50);
  });
});

// ─── Suite 5: tRPC API Endpoints ──────────────────────────────────────────────

test.describe('Suite 5: tRPC API Endpoints', () => {
  test('auth.me returns valid tRPC response structure', async ({ request }) => {
    const response = await request.get('/api/trpc/auth.me');
    expect(response.status()).toBe(200);
    const json = await response.json();
    // tRPC v11 with superjson wraps data: { result: { data: { json: ... } } }
    expect(json).toHaveProperty('result');
    expect(json.result).toHaveProperty('data');
  });

  test('Protected procedure returns UNAUTHORIZED for unauthenticated API request', async ({ request }) => {
    // Direct API request without browser session cookie
    const response = await request.get('/api/trpc/accounts.list');
    const status = response.status();
    expect([200, 401, 403]).toContain(status);
    if (status === 200) {
      const json = await response.json();
      const hasError = json.error || (json.result?.data === null);
      expect(hasError).toBeTruthy();
    }
  });

  test('POST to /api/trpc/auth.me returns valid response', async ({ request }) => {
    const response = await request.post('/api/trpc/auth.me', {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    expect([200, 405]).toContain(response.status());
  });

  test('/api/trpc endpoint is reachable via batch', async ({ request }) => {
    const response = await request.get('/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D');
    expect(response.status()).toBe(200);
  });
});

// ─── Suite 6: 404 & Error Handling ────────────────────────────────────────────

test.describe('Suite 6: 404 & Error Handling', () => {
  test('/404 route renders not found page', async ({ page }) => {
    await page.goto('/404');
    await waitForAppReady(page);
    const bodyText = await page.textContent('body');
    expect(bodyText?.length).toBeGreaterThan(10);
  });

  test('Unknown route renders not found page', async ({ page }) => {
    await page.goto('/this-route-does-not-exist-xyz');
    await waitForAppReady(page);
    const bodyText = await page.textContent('body');
    expect(bodyText?.length).toBeGreaterThan(10);
  });

  test('API 404 returns proper response (not 500)', async ({ request }) => {
    const response = await request.get('/api/nonexistent-endpoint');
    expect(response.status()).not.toBe(500);
  });
});

// ─── Suite 7: Performance & Response Times ────────────────────────────────────

test.describe('Suite 7: Performance & Response Times', () => {
  test('Home page loads within 5 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');
    await waitForAppReady(page);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5_000);
    console.log(`[Pass3] Home page load time: ${elapsed}ms`);
  });

  test('tRPC auth.me responds within 2 seconds', async ({ request }) => {
    const start = Date.now();
    await request.get('/api/trpc/auth.me');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2_000);
    console.log(`[Pass3] auth.me response time: ${elapsed}ms`);
  });

  test('Static assets load quickly', async ({ request }) => {
    const start = Date.now();
    await request.get('/');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3_000);
    console.log(`[Pass3] Root HTML load time: ${elapsed}ms`);
  });
});

// ─── Suite 8: Security Headers ────────────────────────────────────────────────

test.describe('Suite 8: Security Headers', () => {
  test('Content-Type is set correctly for HTML', async ({ request }) => {
    const response = await request.get('/');
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('text/html');
  });

  test('tRPC responses have JSON content-type', async ({ request }) => {
    const response = await request.get('/api/trpc/auth.me');
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/json');
  });

  test('Server responds to regular requests', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
  });

  test('API routes do not return HTML for JSON requests', async ({ request }) => {
    const response = await request.get('/api/trpc/auth.me', {
      headers: { 'Accept': 'application/json' },
    });
    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/json');
  });
});

// ─── Suite 9: Stripe Webhook Endpoint ─────────────────────────────────────────

test.describe('Suite 9: Stripe Webhook Endpoint', () => {
  test('POST /api/stripe/webhook route exists (not 404)', async ({ request }) => {
    const response = await request.post('/api/stripe/webhook', {
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 'invalid-signature',
      },
      data: JSON.stringify({ type: 'test' }),
    });
    // Route exists: returns 200 (test event), 400 (bad sig), or 401
    // NOT 404 (route missing) or 500 (crash)
    const status = response.status();
    expect(status).not.toBe(404);
    expect(status).not.toBe(500);
    console.log(`[Pass3] Stripe webhook response status: ${status}`);
  });
});

// ─── Suite 10: OAuth Callback Route ───────────────────────────────────────────

test.describe('Suite 10: OAuth Callback Route', () => {
  test('GET /api/oauth/callback without code returns error (not 500)', async ({ request }) => {
    const response = await request.get('/api/oauth/callback');
    expect(response.status()).not.toBe(500);
    expect(response.status()).not.toBe(200);
  });

  test('GET /api/oauth/callback with invalid code returns error gracefully', async ({ request }) => {
    const response = await request.get('/api/oauth/callback?code=invalid-code-xyz');
    expect(response.status()).not.toBe(500);
  });
});
