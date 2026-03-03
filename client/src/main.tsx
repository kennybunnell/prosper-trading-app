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

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error, event.query.queryKey);
    
    // Suppress "Account not found" errors when query is disabled (expected behavior)
    const isAccountNotFoundError = error && typeof error === 'object' && 'message' in error && error.message === 'Account not found';
    const isQueryDisabled = event.query.state.fetchStatus === 'idle';
    
    // Suppress Tastytrade authentication errors (handled gracefully by backend)
    const isTastytradeAuthError = error && typeof error === 'object' && 'message' in error && 
      (error.message.includes('Tastytrade login failed') || error.message.includes('Tastytrade authentication failed'));
    
    // Suppress expected 401s from queries that fire before auth.me resolves —
    // these are not real errors; the queries will retry once the user is authenticated.
    const isExpectedUnauthError = error instanceof TRPCClientError && error.message === UNAUTHED_ERR_MSG;
    
    if ((!isAccountNotFoundError || !isQueryDisabled) && !isTastytradeAuthError && !isExpectedUnauthError) {
      console.error("[API Query Error]", error);
    }
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    // Don't log mutation errors here - they're handled by component-level onError handlers
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
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
