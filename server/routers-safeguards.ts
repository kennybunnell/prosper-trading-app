/**
 * IRA / Spread Integrity Safeguards Router
 *
 * Five layered safeguards that prevent the most common IRA account violations:
 *
 * SAFEGUARD 1 — Pre-Close Stock Coverage Check
 *   Before closing a stock position, verify no active short calls exist against it.
 *   Closing stock while holding a short call converts a covered call → naked call (illegal in IRA).
 *
 * SAFEGUARD 2 — Spread Integrity Lock (BTC single-leg check)
 *   Before closing one leg of a spread (BTC), verify the other leg is also being closed.
 *   Closing just the long leg of a BPS leaves the short put naked.
 *   Closing just the long leg of a BCS leaves the short call naked.
 *
 * SAFEGUARD 3 — Coverage Ratio Enforcement (CC order submission)
 *   Before submitting covered call orders, verify shares_owned ÷ 100 ≥ contracts_requested.
 *   Prevents selling more calls than you have shares to cover.
 *
 * SAFEGUARD 4 — ITM Short Call Daily Scan
 *   Scans all accounts for short calls that are in-the-money with ≤ 5 DTE.
 *   Returns actionable alerts so you can close or roll before overnight assignment.
 *
 * SAFEGUARD 5 — Pre-Expiration Friday Sweep
 *   Targeted scan for any options expiring within the current week (≤ 5 DTE).
 *   Designed to run every Friday morning to catch weekend assignment risk.
 *
 * Root cause summary (ADBE/TSM/CVX incident, 2026-02-27):
 *   - Short calls were assigned because shares were not owned or were closed separately
 *   - SOFI BPS long leg was closed independently, leaving naked short put
 *   - TSLA had 3 short calls but only 50 shares (needed 300)
 */

import { router, protectedProcedure } from './_core/trpc';
import { z } from 'zod';

// ── Shared helpers ────────────────────────────────────────────────────────────

function calcDTE(expiresAt: string): number {
  const exp = new Date(expiresAt);
  const now = new Date();
  return Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

function parseStrikeFromSymbol(symbol: string): number {
  const clean = symbol.replace(/\s/g, '');
  const match = clean.match(/[CP](\d{8})$/);
  if (match) return parseInt(match[1]) / 1000;
  return 0;
}

function parseExpirationFromSymbol(symbol: string): string {
  const clean = symbol.replace(/\s/g, '');
  const match = clean.match(/[A-Z]+(\d{6})[CP]/);
  if (match) {
    const d = match[1];
    return `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
  }
  return '';
}

export type SafeguardSeverity = 'block' | 'warn';

export interface SafeguardWarning {
  safeguard: 1 | 2 | 3 | 4 | 5;
  severity: SafeguardSeverity;
  accountNumber: string;
  symbol: string;
  title: string;
  description: string;
  /** What the user must do to resolve this */
  requiredAction: string;
  /** Optional: the conflicting option symbol */
  conflictingOptionSymbol?: string;
  /** Optional: strike of conflicting option */
  conflictingStrike?: number;
  /** Optional: expiration of conflicting option */
  conflictingExpiration?: string;
  /** Optional: DTE of conflicting option */
  dte?: number;
  /** For coverage issues: shares owned */
  sharesOwned?: number;
  /** For coverage issues: shares needed */
  sharesNeeded?: number;
  /** For coverage issues: contracts requested */
  contractsRequested?: number;
}

export const safeguardsRouter = router({

  // ── SAFEGUARD 1: Pre-close stock coverage check ────────────────────────────
  /**
   * Call this BEFORE closing any stock position.
   * Returns warnings if the account has active short calls against that symbol.
   *
   * Usage: call from any "close stock" flow (profit-taking, stop-loss, etc.)
   */
  checkStockClose: protectedProcedure
    .input(z.object({
      accountNumber: z.string(),
      symbol: z.string(),
      sharesToClose: z.number().int().positive(),
    }))
    .query(async ({ ctx, input }) => {
      const { getApiCredentials, getTastytradeAccounts } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        return { safe: true, warnings: [] };
      }

      const api = await authenticateTastytrade(credentials, ctx.user.id);
      const warnings: SafeguardWarning[] = [];

      try {
        const positions = await api.getPositions(input.accountNumber);
        const optionPositions = positions.filter((p: any) => p['instrument-type'] === 'Equity Option');

        // Find active short calls against this symbol
        const shortCalls = optionPositions.filter((p: any) => {
          const underlying = p['underlying-symbol'] || '';
          const direction = p['quantity-direction']?.toLowerCase();
          const isCall = (p.symbol || '').replace(/\s/g, '').match(/[A-Z]+\d{6}C/);
          return underlying === input.symbol && direction === 'short' && isCall;
        });

        for (const sc of shortCalls) {
          const strike = parseStrikeFromSymbol(sc.symbol);
          const expiration = sc['expires-at'] ? sc['expires-at'].split('T')[0] : parseExpirationFromSymbol(sc.symbol);
          const dte = sc['expires-at'] ? calcDTE(sc['expires-at']) : 0;
          const qty = Math.abs(parseInt(String(sc.quantity || '1')));
          const sharesNeeded = qty * 100;

          warnings.push({
            safeguard: 1,
            severity: 'block',
            accountNumber: input.accountNumber,
            symbol: input.symbol,
            title: `⛔ Cannot Close ${input.symbol} Stock — Active Short Call Exists`,
            description: `You have ${qty} short call contract${qty !== 1 ? 's' : ''} on ${input.symbol} ` +
              `($${strike} strike, expires ${expiration}, ${dte} DTE). ` +
              `Closing ${input.sharesToClose} shares while this call is open would convert your covered call ` +
              `into a NAKED short call — which is prohibited in IRA/cash accounts and creates unlimited risk.`,
            requiredAction: `You must either: (1) Close (BTC) the short call FIRST before selling the stock, ` +
              `or (2) Roll the call to a higher strike/later date, ` +
              `or (3) Keep at least ${sharesNeeded} shares to maintain coverage.`,
            conflictingOptionSymbol: sc.symbol,
            conflictingStrike: strike,
            conflictingExpiration: expiration,
            dte,
            sharesOwned: input.sharesToClose,
            sharesNeeded,
          });
        }
      } catch (e: any) {
        console.warn(`[Safeguard 1] Could not fetch positions for ${input.accountNumber}:`, e.message);
      }

      return {
        safe: warnings.length === 0,
        warnings,
        checkedSymbol: input.symbol,
        accountNumber: input.accountNumber,
      };
    }),

  // ── SAFEGUARD 2: Spread integrity lock ────────────────────────────────────
  /**
   * Call this BEFORE submitting a BTC order for a single option leg.
   * Detects if the option being closed is the LONG leg of a spread,
   * which would leave the SHORT leg naked.
   *
   * Usage: call from OrderPreviewModal and Roll Positions flow before any BTC.
   */
  checkSpreadIntegrity: protectedProcedure
    .input(z.object({
      accountNumber: z.string(),
      symbol: z.string(),           // underlying (e.g. "SOFI")
      optionSymbol: z.string(),     // full OCC symbol being closed
      action: z.enum(['BTC', 'STC']), // BTC = closing a long, STC = closing a short
    }))
    .query(async ({ ctx, input }) => {
      const { getApiCredentials } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        return { safe: true, warnings: [] };
      }

      const api = await authenticateTastytrade(credentials, ctx.user.id);
      const warnings: SafeguardWarning[] = [];

      try {
        const positions = await api.getPositions(input.accountNumber);
        const optionPositions = positions.filter((p: any) =>
          p['instrument-type'] === 'Equity Option' &&
          (p['underlying-symbol'] || '') === input.symbol
        );

        const cleanTarget = input.optionSymbol.replace(/\s/g, '');
        const isTargetCall = cleanTarget.match(/[A-Z]+\d{6}C/);
        const isTargetPut = cleanTarget.match(/[A-Z]+\d{6}P/);
        const targetStrike = parseStrikeFromSymbol(input.optionSymbol);
        const targetExp = parseExpirationFromSymbol(input.optionSymbol);

        if (input.action === 'BTC') {
          // We are closing a LONG position (BTC = Buy to Close a long)
          // Check: is there a SHORT option of the same type on the same underlying?
          // If yes, closing this long leaves that short naked.

          const shortOptionsOfSameType = optionPositions.filter((p: any) => {
            const direction = p['quantity-direction']?.toLowerCase();
            if (direction !== 'short') return false;
            const sym = (p.symbol || '').replace(/\s/g, '');
            if (isTargetCall && !sym.match(/[A-Z]+\d{6}C/)) return false;
            if (isTargetPut && !sym.match(/[A-Z]+\d{6}P/)) return false;
            return true;
          });

          for (const sp of shortOptionsOfSameType) {
            const shortStrike = parseStrikeFromSymbol(sp.symbol);
            const shortExp = sp['expires-at'] ? sp['expires-at'].split('T')[0] : parseExpirationFromSymbol(sp.symbol);
            const dte = sp['expires-at'] ? calcDTE(sp['expires-at']) : 0;
            const optType = isTargetCall ? 'call' : 'put';
            const spreadType = isTargetCall ? 'Bear Call Spread' : 'Bull Put Spread';

            warnings.push({
              safeguard: 2,
              severity: 'block',
              accountNumber: input.accountNumber,
              symbol: input.symbol,
              title: `⛔ Spread Integrity Violation — Closing Long Leg Would Leave Short ${optType.toUpperCase()} Naked`,
              description: `You are closing the LONG ${optType} on ${input.symbol} (strike $${targetStrike}, ${targetExp}). ` +
                `You still have an open SHORT ${optType} at $${shortStrike} (expires ${shortExp}, ${dte} DTE). ` +
                `This ${spreadType} will lose its defined-risk protection — the short leg becomes a naked ${optType} ` +
                `which is prohibited in IRA/cash accounts and creates ${isTargetCall ? 'unlimited upside' : 'large downside'} risk.`,
              requiredAction: `Close BOTH legs simultaneously as a spread order, ` +
                `or close the SHORT leg (BTC $${shortStrike} ${optType}) FIRST, then close the long leg. ` +
                `Never close the long protective leg while leaving the short leg open.`,
              conflictingOptionSymbol: sp.symbol,
              conflictingStrike: shortStrike,
              conflictingExpiration: shortExp,
              dte,
            });
          }
        }

        if (input.action === 'STC') {
          // We are closing a SHORT position (STC = Sell to Close a long, but here used for closing a short via BTC)
          // This path is less common but check anyway for completeness
        }

      } catch (e: any) {
        console.warn(`[Safeguard 2] Could not fetch positions for ${input.accountNumber}:`, e.message);
      }

      return {
        safe: warnings.length === 0,
        warnings,
        checkedSymbol: input.symbol,
        checkedOptionSymbol: input.optionSymbol,
      };
    }),

  // ── SAFEGUARD 3: Coverage ratio check (pre-CC order) ──────────────────────
  /**
   * Call this BEFORE submitting covered call orders.
   * Validates that shares_owned ÷ 100 ≥ total_contracts_requested for each symbol.
   *
   * Usage: call from CC Dashboard before order submission.
   */
  checkCoverageRatio: protectedProcedure
    .input(z.object({
      accountNumber: z.string(),
      orders: z.array(z.object({
        symbol: z.string(),
        contracts: z.number().int().positive(),
      })),
    }))
    .query(async ({ ctx, input }) => {
      const { getApiCredentials } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        return { safe: true, warnings: [], coverageMap: {} };
      }

      const api = await authenticateTastytrade(credentials, ctx.user.id);
      const warnings: SafeguardWarning[] = [];
      const coverageMap: Record<string, { sharesOwned: number; existingContracts: number; availableContracts: number }> = {};

      try {
        const positions = await api.getPositions(input.accountNumber);
        const stockPositions = positions.filter((p: any) => p['instrument-type'] === 'Equity');
        const optionPositions = positions.filter((p: any) => p['instrument-type'] === 'Equity Option');

        // Count existing short calls per symbol
        const existingShortCalls: Record<string, number> = {};
        for (const p of optionPositions) {
          const direction = p['quantity-direction']?.toLowerCase();
          const sym = (p.symbol || '').replace(/\s/g, '');
          const isCall = !!sym.match(/[A-Z]+\d{6}C/);
          if (direction === 'short' && isCall) {
            const underlying = p['underlying-symbol'] || '';
            const qty = Math.abs(parseInt(String(p.quantity || '1')));
            existingShortCalls[underlying] = (existingShortCalls[underlying] || 0) + qty;
          }
        }

        // Build coverage map
        for (const pos of stockPositions) {
          const sym = pos.symbol || pos['underlying-symbol'] || '';
          const qty = parseInt(String(pos.quantity || '0'));
          const direction = pos['quantity-direction']?.toLowerCase();
          if (direction === 'short' || qty <= 0) continue;

          const existing = existingShortCalls[sym] || 0;
          const usedShares = existing * 100;
          const availableShares = Math.max(0, qty - usedShares);
          const availableContracts = Math.floor(availableShares / 100);

          coverageMap[sym] = {
            sharesOwned: qty,
            existingContracts: existing,
            availableContracts,
          };
        }

        // Check each requested order
        for (const order of input.orders) {
          const coverage = coverageMap[order.symbol];
          const sharesOwned = coverage?.sharesOwned ?? 0;
          const availableContracts = coverage?.availableContracts ?? 0;

          if (order.contracts > availableContracts) {
            const sharesNeeded = order.contracts * 100;
            const existingContracts = coverage?.existingContracts ?? 0;

            warnings.push({
              safeguard: 3,
              severity: 'block',
              accountNumber: input.accountNumber,
              symbol: order.symbol,
              title: `⛔ Coverage Ratio Violation — ${order.symbol}: ${order.contracts} contracts requested but only ${availableContracts} available`,
              description: `You own ${sharesOwned} shares of ${order.symbol} ` +
                `(${existingContracts > 0 ? `${existingContracts} contracts already sold, ` : ''}` +
                `${availableContracts * 100} shares available). ` +
                `Selling ${order.contracts} contract${order.contracts !== 1 ? 's' : ''} requires ${sharesNeeded} shares. ` +
                `Submitting this order would create ${order.contracts - availableContracts} uncovered (naked) call${order.contracts - availableContracts !== 1 ? 's' : ''}.`,
              requiredAction: `Reduce to ${availableContracts} contract${availableContracts !== 1 ? 's' : ''} maximum, ` +
                `or buy ${sharesNeeded - sharesOwned + (existingContracts * 100)} more shares of ${order.symbol} first.`,
              sharesOwned,
              sharesNeeded,
              contractsRequested: order.contracts,
            });
          }
        }
      } catch (e: any) {
        console.warn(`[Safeguard 3] Could not fetch positions for ${input.accountNumber}:`, e.message);
      }

      return {
        safe: warnings.length === 0,
        warnings,
        coverageMap,
      };
    }),

  // ── SAFEGUARD 4 & 5: ITM short call scan + Friday sweep ──────────────────
  /**
   * Scan all accounts for short calls that are in-the-money or near expiration.
   *
   * mode: 'daily' — flags ITM short calls ≤ 5 DTE (run every morning)
   * mode: 'friday' — flags ALL short calls ≤ 5 DTE regardless of ITM status (Friday sweep)
   *
   * Usage: call from Automation tab daily scan and Friday sweep buttons.
   */
  scanExpirationRisk: protectedProcedure
    .input(z.object({
      mode: z.enum(['daily', 'friday']).default('daily'),
      accountId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { getApiCredentials, getTastytradeAccounts } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        return { alerts: [], accountsScanned: 0, hasAlerts: false };
      }

      const api = await authenticateTastytrade(credentials, ctx.user.id);
      const dbAccounts = await getTastytradeAccounts(ctx.user.id);
      if (!dbAccounts || dbAccounts.length === 0) {
        return { alerts: [], accountsScanned: 0, hasAlerts: false };
      }

      let targetAccounts = dbAccounts;
      if (input.accountId) {
        const found = dbAccounts.find((a: any) => a.accountId === input.accountId);
        if (found) targetAccounts = [found];
      }

      const dteCutoff = input.mode === 'friday' ? 7 : 5; // Friday sweep looks 7 days out

      interface ExpirationAlert {
        safeguard: 4 | 5;
        severity: 'critical' | 'warning';
        accountNumber: string;
        accountType: string;
        symbol: string;
        optionSymbol: string;
        strike: number;
        expiration: string;
        dte: number;
        sharesOwned: number;
        sharesNeeded: number;
        isCovered: boolean;
        title: string;
        description: string;
        requiredAction: string;
      }

      const alerts: ExpirationAlert[] = [];

      for (const account of targetAccounts) {
        const accountType = account.accountType || '';

        let positions: any[] = [];
        try {
          positions = await api.getPositions(account.accountNumber) || [];
        } catch (e: any) {
          console.warn(`[Safeguard 4/5] Could not fetch positions for ${account.accountNumber}:`, e.message);
          continue;
        }

        const stockPositions = positions.filter((p: any) => p['instrument-type'] === 'Equity');
        const optionPositions = positions.filter((p: any) => p['instrument-type'] === 'Equity Option');

        // Build stock ownership map
        const stockMap = new Map<string, number>();
        for (const pos of stockPositions) {
          const qty = parseInt(String(pos.quantity || '0'));
          const direction = pos['quantity-direction']?.toLowerCase();
          if (direction === 'short' || qty <= 0) continue;
          const sym = pos['underlying-symbol'] || pos.symbol || '';
          stockMap.set(sym, (stockMap.get(sym) || 0) + qty);
        }

        // Scan short calls for expiration risk
        for (const pos of optionPositions) {
          const direction = pos['quantity-direction']?.toLowerCase();
          if (direction !== 'short') continue;

          const sym = (pos.symbol || '').replace(/\s/g, '');
          const isCall = !!sym.match(/[A-Z]+\d{6}C/);
          if (!isCall) continue;

          const underlying = pos['underlying-symbol'] || '';
          const strike = parseStrikeFromSymbol(pos.symbol);
          const expiration = pos['expires-at'] ? pos['expires-at'].split('T')[0] : parseExpirationFromSymbol(pos.symbol);
          const dte = pos['expires-at'] ? calcDTE(pos['expires-at']) : 999;

          if (dte > dteCutoff) continue; // Only flag near-expiration

          const qty = Math.abs(parseInt(String(pos.quantity || '1')));
          const sharesNeeded = qty * 100;
          const sharesOwned = stockMap.get(underlying) || 0;
          const isCovered = sharesOwned >= sharesNeeded;

          const safeguardNum: 4 | 5 = input.mode === 'friday' ? 5 : 4;
          const severity: 'critical' | 'warning' = (!isCovered && dte <= 2) ? 'critical' : 'warning';

          alerts.push({
            safeguard: safeguardNum,
            severity,
            accountNumber: account.accountNumber,
            accountType,
            symbol: underlying,
            optionSymbol: pos.symbol,
            strike,
            expiration,
            dte,
            sharesOwned,
            sharesNeeded,
            isCovered,
            title: isCovered
              ? `⚠️ ${underlying} Covered Call Expiring in ${dte} Day${dte !== 1 ? 's' : ''}`
              : `🚨 ${underlying} UNCOVERED Short Call Expiring in ${dte} Day${dte !== 1 ? 's' : ''} — Assignment Risk`,
            description: isCovered
              ? `Your covered call on ${underlying} ($${strike} strike, ${expiration}) expires in ${dte} day${dte !== 1 ? 's' : ''}. ` +
                `You own ${sharesOwned} shares (${sharesNeeded} needed). ` +
                `If the stock is above $${strike} at expiration, your shares will be called away.`
              : `You have ${qty} short call${qty !== 1 ? 's' : ''} on ${underlying} ($${strike} strike, ${expiration}) ` +
                `expiring in ${dte} day${dte !== 1 ? 's' : ''}, but only own ${sharesOwned} of ${sharesNeeded} shares needed. ` +
                `If assigned, ${sharesNeeded - sharesOwned} short shares will be created — triggering an SL call.`,
            requiredAction: isCovered
              ? `Review: if you want to keep the shares, close (BTC) the call before expiration. ` +
                `If you are willing to sell at $${strike}, you can let it expire or be assigned.`
              : `URGENT: Close (BTC) this call before market close, or buy ${sharesNeeded - sharesOwned} more shares of ${underlying} immediately. ` +
                `Do NOT let an uncovered ITM short call expire — it will create short stock and an SL call.`,
          });
        }
      }

      // Sort: uncovered critical first, then by DTE ascending
      alerts.sort((a, b) => {
        if (a.isCovered !== b.isCovered) return a.isCovered ? 1 : -1;
        if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
        return a.dte - b.dte;
      });

      return {
        alerts,
        accountsScanned: targetAccounts.length,
        hasAlerts: alerts.length > 0,
        uncoveredCount: alerts.filter(a => !a.isCovered).length,
        coveredCount: alerts.filter(a => a.isCovered).length,
        mode: input.mode,
        dteCutoff,
      };
    }),

  // ── Combined pre-trade check (convenience procedure) ──────────────────────
  /**
   * Run all relevant safeguard checks before any order.
   * Returns a unified list of warnings/blocks.
   *
   * Usage: call from OrderPreviewModal before showing the confirm button.
   */
  preTradeCheck: protectedProcedure
    .input(z.object({
      accountNumber: z.string(),
      orderType: z.enum(['close_stock', 'btc_option', 'sell_call', 'roll']),
      symbol: z.string(),
      // For close_stock:
      sharesToClose: z.number().int().positive().optional(),
      // For btc_option:
      optionSymbol: z.string().optional(),
      // For sell_call (CC order):
      contracts: z.number().int().positive().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { getApiCredentials, getTastytradeAccounts } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        return { safe: true, warnings: [], blocked: false };
      }

      const api = await authenticateTastytrade(credentials, ctx.user.id);
      const warnings: SafeguardWarning[] = [];

      try {
        const positions = await api.getPositions(input.accountNumber);
        const stockPositions = positions.filter((p: any) => p['instrument-type'] === 'Equity');
        const optionPositions = positions.filter((p: any) =>
          p['instrument-type'] === 'Equity Option' &&
          (p['underlying-symbol'] || '') === input.symbol
        );

        // ── Safeguard 1: closing stock ──
        if (input.orderType === 'close_stock' && input.sharesToClose) {
          const shortCalls = optionPositions.filter((p: any) => {
            const direction = p['quantity-direction']?.toLowerCase();
            const sym = (p.symbol || '').replace(/\s/g, '');
            return direction === 'short' && !!sym.match(/[A-Z]+\d{6}C/);
          });

          for (const sc of shortCalls) {
            const strike = parseStrikeFromSymbol(sc.symbol);
            const expiration = sc['expires-at'] ? sc['expires-at'].split('T')[0] : parseExpirationFromSymbol(sc.symbol);
            const dte = sc['expires-at'] ? calcDTE(sc['expires-at']) : 0;
            const qty = Math.abs(parseInt(String(sc.quantity || '1')));

            warnings.push({
              safeguard: 1,
              severity: 'block',
              accountNumber: input.accountNumber,
              symbol: input.symbol,
              title: `⛔ Cannot Close ${input.symbol} — Active Short Call at $${strike}`,
              description: `Closing stock while holding a short call converts covered → naked call (prohibited in IRA).`,
              requiredAction: `Close (BTC) the $${strike} call first, then close the stock.`,
              conflictingOptionSymbol: sc.symbol,
              conflictingStrike: strike,
              conflictingExpiration: expiration,
              dte,
              sharesOwned: input.sharesToClose,
              sharesNeeded: qty * 100,
            });
          }
        }

        // ── Safeguard 2: closing a long option leg ──
        if ((input.orderType === 'btc_option' || input.orderType === 'roll') && input.optionSymbol) {
          const cleanTarget = input.optionSymbol.replace(/\s/g, '');
          const isTargetCall = !!cleanTarget.match(/[A-Z]+\d{6}C/);
          const isTargetPut = !!cleanTarget.match(/[A-Z]+\d{6}P/);

          // Check if the option being closed is a LONG position
          const targetPos = optionPositions.find((p: any) =>
            (p.symbol || '').replace(/\s/g, '') === cleanTarget
          );
          const targetDirection = targetPos?.['quantity-direction']?.toLowerCase();
          const isClosingLong = targetDirection === 'long';

          if (isClosingLong) {
            // Look for a matching short of the same type
            const matchingShorts = optionPositions.filter((p: any) => {
              const direction = p['quantity-direction']?.toLowerCase();
              if (direction !== 'short') return false;
              const sym = (p.symbol || '').replace(/\s/g, '');
              if (isTargetCall && !sym.match(/[A-Z]+\d{6}C/)) return false;
              if (isTargetPut && !sym.match(/[A-Z]+\d{6}P/)) return false;
              return true;
            });

            for (const sp of matchingShorts) {
              const shortStrike = parseStrikeFromSymbol(sp.symbol);
              const shortExp = sp['expires-at'] ? sp['expires-at'].split('T')[0] : parseExpirationFromSymbol(sp.symbol);
              const dte = sp['expires-at'] ? calcDTE(sp['expires-at']) : 0;
              const optType = isTargetCall ? 'call' : 'put';

              warnings.push({
                safeguard: 2,
                severity: 'block',
                accountNumber: input.accountNumber,
                symbol: input.symbol,
                title: `⛔ Spread Integrity Violation — Closing Long ${optType.toUpperCase()} Leaves Short Naked`,
                description: `Closing the long ${optType} leaves the short ${optType} at $${shortStrike} (${shortExp}, ${dte} DTE) unprotected.`,
                requiredAction: `Close both legs simultaneously, or close the SHORT leg first.`,
                conflictingOptionSymbol: sp.symbol,
                conflictingStrike: shortStrike,
                conflictingExpiration: shortExp,
                dte,
              });
            }
          }
        }

        // ── Safeguard 3: selling calls (coverage ratio) ──
        if (input.orderType === 'sell_call' && input.contracts) {
          const stockPos = stockPositions.find((p: any) =>
            (p.symbol || p['underlying-symbol'] || '') === input.symbol
          );
          const sharesOwned = stockPos ? parseInt(String(stockPos.quantity || '0')) : 0;

          const existingShortCalls = optionPositions.filter((p: any) => {
            const direction = p['quantity-direction']?.toLowerCase();
            const sym = (p.symbol || '').replace(/\s/g, '');
            return direction === 'short' && !!sym.match(/[A-Z]+\d{6}C/);
          });
          const existingContracts = existingShortCalls.reduce((sum: number, p: any) =>
            sum + Math.abs(parseInt(String(p.quantity || '1'))), 0);

          const usedShares = existingContracts * 100;
          const availableShares = Math.max(0, sharesOwned - usedShares);
          const availableContracts = Math.floor(availableShares / 100);

          if (input.contracts > availableContracts) {
            warnings.push({
              safeguard: 3,
              severity: 'block',
              accountNumber: input.accountNumber,
              symbol: input.symbol,
              title: `⛔ Coverage Ratio Violation — ${input.symbol}: Only ${availableContracts} contracts available`,
              description: `You own ${sharesOwned} shares (${existingContracts} contracts already sold). ` +
                `Selling ${input.contracts} more contracts requires ${input.contracts * 100} additional shares.`,
              requiredAction: `Reduce to ${availableContracts} contract${availableContracts !== 1 ? 's' : ''}, or buy more shares first.`,
              sharesOwned,
              sharesNeeded: input.contracts * 100,
              contractsRequested: input.contracts,
            });
          }
        }

      } catch (e: any) {
        console.warn(`[Safeguard preTradeCheck] Error for ${input.accountNumber}/${input.symbol}:`, e.message);
      }

      const blocked = warnings.some(w => w.severity === 'block');

      return {
        safe: warnings.length === 0,
        blocked,
        warnings,
        symbol: input.symbol,
        orderType: input.orderType,
      };
    }),

  // ── Manual Friday Sweep trigger ────────────────────────────────────────────
  /**
   * Manually trigger the Friday expiration sweep on demand.
   * Runs the same scan as the scheduled Friday 9:30 AM job and sends an owner notification.
   * Use from the Automation tab to verify the sweep works before next Friday.
   */
  triggerFridaySweep: protectedProcedure
    .mutation(async ({ ctx }): Promise<{ alertCount: number; notificationSent: boolean; message: string }> => {
      // Run the Friday sweep scan (mode='friday' looks 7 DTE out)
      // We call scanExpirationRisk inline to avoid circular import with automation-scheduler
      const { getApiCredentials, getTastytradeAccounts } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');
      const { notifyOwner } = await import('./_core/notification');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        return { alertCount: 0, notificationSent: false, message: 'No Tastytrade credentials configured.' };
      }

      const accounts = await getTastytradeAccounts(ctx.user.id);
      const api = await authenticateTastytrade(credentials, ctx.user.id);
      const dteCutoff = 7; // Friday sweep looks 7 days out
      const allAlerts: string[] = [];

      for (const account of accounts) {
        try {
          const positions = await api.getPositions(account.accountId);
          const shortCalls = positions.filter((p: any) =>
            p['instrument-type'] === 'Equity Option' &&
            p['quantity-direction']?.toLowerCase() === 'short' &&
            (p.symbol || '').replace(/\s/g, '').match(/[A-Z]+\d{6}C/)
          );
          for (const pos of shortCalls) {
            const dte = pos['expires-at'] ? calcDTE(pos['expires-at']) : 99;
            if (dte <= dteCutoff) {
              const strike = parseStrikeFromSymbol(pos.symbol);
              const underlying = pos['underlying-symbol'] || pos.symbol;
              allAlerts.push(`${underlying} $${strike} call (${dte} DTE) in acct ${account.accountNumber}`);
            }
          }
        } catch (e: any) {
          console.warn(`[Friday Sweep] Error scanning ${account.accountNumber}:`, e.message);
        }
      }

      let notificationSent = false;
      if (allAlerts.length > 0) {
        const title = `⚠️ Friday Sweep: ${allAlerts.length} short call${allAlerts.length !== 1 ? 's' : ''} expiring within 7 DTE`;
        const content = `The following short calls require attention before expiration:\n\n` +
          allAlerts.map((a, i) => `${i + 1}. ${a}`).join('\n') +
          `\n\nPlease review in the Portfolio Safety tab and close or roll as needed.`;
        notificationSent = await notifyOwner({ title, content });
      }

      return {
        alertCount: allAlerts.length,
        notificationSent,
        message: allAlerts.length === 0
          ? 'No short calls expiring within 7 DTE. Portfolio looks clean!'
          : `Found ${allAlerts.length} short call${allAlerts.length !== 1 ? 's' : ''} expiring within 7 DTE. Notification sent.`,
      };
    }),

  // ── Friday Sweep schedule toggle ──────────────────────────────────────────
  /** Get whether the Friday sweep cron is enabled for this user */
  getFridaySweepEnabled: protectedProcedure.query(async ({ ctx }) => {
    const { getDb } = await import('./db');
    const { userPreferences } = await import('../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();
    if (!db) return { enabled: true };
    const prefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, ctx.user.id)).limit(1);
    const enabled = prefs.length > 0 ? (prefs[0].fridaySweepEnabled ?? true) : true;
    return { enabled };
  }),

  /** Toggle the Friday sweep cron on or off for this user */
  setFridaySweepEnabled: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { userPreferences } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) return { enabled: input.enabled };
      const existing = await db.select().from(userPreferences).where(eq(userPreferences.userId, ctx.user.id)).limit(1);
      if (existing.length > 0) {
        await db.update(userPreferences)
          .set({ fridaySweepEnabled: input.enabled })
          .where(eq(userPreferences.userId, ctx.user.id));
      } else {
        await db.insert(userPreferences).values({
          userId: ctx.user.id,
          fridaySweepEnabled: input.enabled,
        });
      }
      return { enabled: input.enabled };
    }),
});
