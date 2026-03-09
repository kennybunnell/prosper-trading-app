import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";
import { TradingModeProvider } from "./contexts/TradingModeContext";
import { Toaster } from "sonner";

// ─── Token-in-URL fallback for cookie-blocked environments ───────────────────
// When the app is embedded in the Manus preview panel (an iframe on manus.im),
// Chrome's third-party cookie restrictions prevent the session cookie from being
// stored. As a fallback, the OAuth callback passes the JWT in the URL query
// param `_t`. We read it here, store it in localStorage, and strip it from the
// URL so it doesn't appear in the address bar or browser history.
const LS_TOKEN_KEY = 'prosper_session_token';

(function captureTokenFromUrl() {
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('_t');
    if (token) {
      localStorage.setItem(LS_TOKEN_KEY, token);
      console.log('[Auth] Captured session token from URL, stored in localStorage');
      // Remove the token from the URL without triggering a page reload
      url.searchParams.delete('_t');
      window.history.replaceState({}, '', url.toString());
    }
  } catch (e) {
    // Ignore – not critical
  }
})();

/** Returns the stored localStorage token, or undefined if not present. */
function getStoredToken(): string | undefined {
  try {
    return localStorage.getItem(LS_TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Clears the stored localStorage token (used on logout). */
export function clearStoredToken(): void {
  try {
    localStorage.removeItem(LS_TOKEN_KEY);
  } catch {
    // Ignore
  }
}
// ─────────────────────────────────────────────────────────────────────────────

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown, queryKey?: readonly unknown[]) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;
  if (!isUnauthorized) return;

  // Only redirect to login when auth.me itself fails — not when other queries
  // get a 401 before the session cookie has been established on page load.
  // Other queries will automatically retry once auth.me succeeds.
  const isAuthMeQuery = Array.isArray(queryKey) &&
    queryKey.some(k => Array.isArray(k) && k[0] === 'auth' && k[1] === 'me');
  if (!isAuthMeQuery) return;

  // Clear any stale stored token before redirecting to login
  clearStoredToken();
  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    // Only redirect after all retries are exhausted (failureCount >= 2 means retry: 1 has been used)
    const failureCount = event.query.state.fetchFailureCount ?? 0;
    if (failureCount >= 2) {
      redirectToLoginIfUnauthorized(error, event.query.queryKey);
    }
    
    // Suppress "Account not found" errors when query is disabled (expected behavior)
    const isAccountNotFoundError = error && typeof error === 'object' && 'message' in error && error.message === 'Account not found';
    const isQueryDisabled = event.query.state.fetchStatus === 'idle';
    
    // Suppress Tastytrade authentication errors (handled gracefully by backend)
    const isTastytradeAuthError = error && typeof error === 'object' && 'message' in error && 
      (error.message.includes('Tastytrade login failed') || error.message.includes('Tastytrade authentication failed'));
    
    // Suppress expected 401s from queries that fire before auth.me resolves —
    // these are not real errors; the queries will retry once the user is authenticated.
    const isExpectedUnauthError = error instanceof TRPCClientError && error.message === UNAUTHED_ERR_MSG;

    // Suppress "Automation log not found" — happens when a stale runId is cached but the log was
    // deleted/cleared. The query uses retry:false so this fires at most once per stale cache entry.
    const isStaleAutomationLog = error && typeof error === 'object' && 'message' in error && error.message === 'Automation log not found';
    
    if ((!isAccountNotFoundError || !isQueryDisabled) && !isTastytradeAuthError && !isExpectedUnauthError && !isStaleAutomationLog) {
      console.error("[API Query Error]", error);
    }
  }
});

// NOTE: We intentionally do NOT redirect to login on mutation errors.
// Mutations that fail with 401 are handled by component-level onError handlers.
// A global redirect here would interrupt the user mid-action and cause auth loops.
queryClient.getMutationCache().subscribe(_event => {
  // Mutation errors are handled at the component level.
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        const storedToken = getStoredToken();
        const headers: Record<string, string> = {};
        if (storedToken) {
          // Send the localStorage token as Authorization header.
          // The server accepts this as a fallback when cookies are blocked.
          headers['Authorization'] = `Bearer ${storedToken}`;
        }
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
          headers: {
            ...(init?.headers ?? {}),
            ...headers,
          },
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <TradingModeProvider>
        <App />
        <Toaster richColors position="top-right" />
      </TradingModeProvider>
    </QueryClientProvider>
  </trpc.Provider>
);
