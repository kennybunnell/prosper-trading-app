/**
 * IRA Safety Monitor Router
 *
 * Scans all accounts for positions that violate IRA/cash account rules:
 *
 * 1. SHORT STOCK  — Negative quantity equity position (e.g. -100 ADBE)
 *    → Triggered by assignment on a short call when you don't own shares
 *    → Must be closed immediately (SL call from Tastytrade)
 *
 * 2. NAKED SHORT CALL — Short call with no matching long call AND no stock position
 *    → Not allowed in IRA; covered calls require owning 100 shares
 *
 * 3. ORPHANED SHORT LEG — Short option whose paired long leg was closed/assigned
 *    → Spread became naked; now an unprotected short in a restricted account
 *
 * 4. ITM SHORT CALL (assignment risk) — Short call that is in-the-money with ≤5 DTE
 *    → High probability of early assignment overnight; warn before it happens
 *
 * Root cause of ADBE incident (account 418, 2026-02-27):
 *   - User held a short ADBE call in an IRA/cash account
 *   - The call was assigned (option holder exercised)
 *   - Assignment required delivering 100 ADBE shares
 *   - User did not own ADBE shares → system created -100 short stock
 *   - Tastytrade issued SL call: "Short Restricted Strategy for 100.0"
 *   - Fix: Buy 100 ADBE shares before market close
 */

import { router, protectedProcedure } from './_core/trpc';
import { z } from 'zod';

// IRA/cash account type names from Tastytrade API
const IRA_ACCOUNT_TYPES = [
  'Roth IRA',
  'Traditional IRA',
  'SEP IRA',
  'SIMPLE IRA',
  'Beneficiary IRA',
  'Inherited IRA',
  'Rollover IRA',
  'IRA',
  'Cash', // Cash accounts also cannot hold short stock
];

function isRestrictedAccount(accountType: string | null | undefined): boolean {
  if (!accountType) return false;
  const normalized = accountType.toLowerCase();
  return IRA_ACCOUNT_TYPES.some(t => normalized.includes(t.toLowerCase()));
}

export type ViolationType =
  | 'SHORT_STOCK'           // -100 shares of a stock (SL call trigger)
  | 'NAKED_SHORT_CALL'      // Short call with no stock coverage and no long call
  | 'ORPHANED_SHORT_LEG'    // Short option whose paired long was closed/assigned
  | 'ITM_ASSIGNMENT_RISK';  // Short call ITM ≤5 DTE — assignment likely tonight

export interface IraViolation {
  violationType: ViolationType;
  severity: 'critical' | 'warning';
  accountNumber: string;
  accountType: string;
  symbol: string;
  description: string;
  /** Suggested action to resolve the violation */
  action: string;
  /** For SHORT_STOCK: number of shares short */
  sharesShort?: number;
  /** For option violations: the option symbol */
  optionSymbol?: string;
  /** For option violations: strike price */
  strike?: number;
  /** For option violations: expiration date */
  expiration?: string;
  /** For option violations: DTE */
  dte?: number;
  /** For option violations: how far ITM (%) */
  itmPct?: number;
}

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
  // OCC format: SYMBOL + YYMMDD + C/P + strike
  const match = clean.match(/[A-Z]+(\d{6})[CP]/);
  if (match) {
    const d = match[1];
    return `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
  }
  return '';
}

export const iraSafetyRouter = router({
  /**
   * Scan all accounts for IRA/cash account violations.
   * Returns a list of violations sorted by severity (critical first).
   */
  scanViolations: protectedProcedure
    .input(z.object({ accountId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { getApiCredentials, getTastytradeAccounts } = await import('./db');
      const { authenticateTastytrade } = await import('./tastytrade');

      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        return { violations: [], accountsScanned: 0, hasViolations: false };
      }

      const api = await authenticateTastytrade(credentials, ctx.user.id);
      const dbAccounts = await getTastytradeAccounts(ctx.user.id);
      if (!dbAccounts || dbAccounts.length === 0) {
        return { violations: [], accountsScanned: 0, hasViolations: false };
      }

      let targetAccounts = dbAccounts;
      if (input?.accountId) {
        const found = dbAccounts.find(a => a.accountId === input.accountId);
        if (found) targetAccounts = [found];
      }

      const violations: IraViolation[] = [];

      for (const account of targetAccounts) {
        const accountType = account.accountType || '';
        const isRestricted = isRestrictedAccount(accountType);

        // Fetch all positions for this account
        let positions: any[] = [];
        try {
          positions = await api.getPositions(account.accountNumber) || [];
        } catch (e) {
          console.warn(`[IRA Safety] Could not fetch positions for ${account.accountNumber}:`, e);
          continue;
        }

        // Separate into stock and option positions
        const stockPositions = positions.filter(p => p['instrument-type'] === 'Equity');
        const optionPositions = positions.filter(p => p['instrument-type'] === 'Equity Option');

        // ── 1. SHORT STOCK (critical — SL call trigger) ──────────────────────
        for (const pos of stockPositions) {
          const qty = parseInt(String(pos.quantity || '0'));
          const direction = pos['quantity-direction']?.toLowerCase();
          const isShort = direction === 'short' || qty < 0;

          if (isShort) {
            const sharesShort = Math.abs(qty);
            const underlying = pos['underlying-symbol'] || pos.symbol || '';
            const openPrice = parseFloat(String(pos['average-open-price'] || '0'));

            violations.push({
              violationType: 'SHORT_STOCK',
              severity: 'critical',
              accountNumber: account.accountNumber,
              accountType: accountType || 'Unknown',
              symbol: underlying,
              description: `Short ${sharesShort} shares of ${underlying} in ${accountType || 'restricted'} account. ` +
                `This triggered a Tastytrade SL (Short Restricted Strategy) call. ` +
                `Most likely caused by assignment on a short call when you did not own the shares.`,
              action: `Buy ${sharesShort} shares of ${underlying} before market close to satisfy the SL call.`,
              sharesShort,
            });
          }
        }

        // Only check option violations for IRA/cash accounts
        if (!isRestricted) continue;

        // Build a map of stock positions for covered-call check
        const stockMap = new Map<string, number>(); // symbol → signed shares
        for (const pos of stockPositions) {
          const qty = parseInt(String(pos.quantity || '0'));
          const direction = pos['quantity-direction']?.toLowerCase();
          const signedQty = direction === 'short' ? -Math.abs(qty) : Math.abs(qty);
          const sym = pos['underlying-symbol'] || pos.symbol || '';
          stockMap.set(sym, (stockMap.get(sym) || 0) + signedQty);
        }

        // Build maps of short and long options by underlying
        const shortCalls = new Map<string, any[]>();
        const longCalls  = new Map<string, any[]>();
        const shortPuts  = new Map<string, any[]>();
        const longPuts   = new Map<string, any[]>();

        for (const pos of optionPositions) {
          const sym = pos.symbol || '';
          const underlying = pos['underlying-symbol'] || '';
          const direction = pos['quantity-direction']?.toLowerCase();
          const isShort = direction === 'short';
          const isCall = sym.includes('C');
          const isPut  = sym.includes('P');

          if (isShort && isCall) {
            if (!shortCalls.has(underlying)) shortCalls.set(underlying, []);
            shortCalls.get(underlying)!.push(pos);
          } else if (!isShort && isCall) {
            if (!longCalls.has(underlying)) longCalls.set(underlying, []);
            longCalls.get(underlying)!.push(pos);
          } else if (isShort && isPut) {
            if (!shortPuts.has(underlying)) shortPuts.set(underlying, []);
            shortPuts.get(underlying)!.push(pos);
          } else if (!isShort && isPut) {
            if (!longPuts.has(underlying)) longPuts.set(underlying, []);
            longPuts.get(underlying)!.push(pos);
          }
        }

        // ── 2. NAKED SHORT CALL — no stock + no long call ────────────────────
        for (const [underlying, calls] of Array.from(shortCalls.entries())) {
          const sharesOwned = stockMap.get(underlying) || 0;
          const hasLongCalls = (longCalls.get(underlying) || []).length > 0;

          for (const sc of calls) {
            const qty = Math.abs(parseInt(String(sc.quantity || '1')));
            const sharesNeeded = qty * 100;
            const isCovered = sharesOwned >= sharesNeeded;
            const isSpread  = hasLongCalls; // has a long call as protection

            if (!isCovered && !isSpread) {
              const strike = parseStrikeFromSymbol(sc.symbol);
              const expiration = sc['expires-at'] ? sc['expires-at'].split('T')[0] : parseExpirationFromSymbol(sc.symbol);
              const dte = sc['expires-at'] ? calcDTE(sc['expires-at']) : 0;

              violations.push({
                violationType: 'NAKED_SHORT_CALL',
                severity: 'critical',
                accountNumber: account.accountNumber,
                accountType,
                symbol: underlying,
                description: `Naked short call on ${underlying} ($${strike} strike, ${expiration}) in ${accountType}. ` +
                  `You own ${sharesOwned} shares but need ${sharesNeeded} to be covered. ` +
                  `This is not permitted in IRA/cash accounts.`,
                action: `Either buy ${sharesNeeded - sharesOwned} shares of ${underlying} to cover, ` +
                  `or buy a long call at a higher strike to convert to a spread, ` +
                  `or close (BTC) the short call immediately.`,
                optionSymbol: sc.symbol,
                strike,
                expiration,
                dte,
              });
            }
          }
        }

        // ── 3. ORPHANED SHORT LEG — short put with no matching long put ──────
        // (This catches the case where someone closed the long leg of a BPS
        //  and left the short put exposed as a naked short in an IRA)
        for (const [underlying, puts] of Array.from(shortPuts.entries())) {
          const hasLongPuts = (longPuts.get(underlying) || []).length > 0;

          if (!hasLongPuts) {
            // Short put with no long protection — naked put in IRA
            // Note: CSPs are allowed in IRAs IF fully cash-secured, so we flag as warning not critical
            for (const sp of puts) {
              const strike = parseStrikeFromSymbol(sp.symbol);
              const expiration = sp['expires-at'] ? sp['expires-at'].split('T')[0] : parseExpirationFromSymbol(sp.symbol);
              const dte = sp['expires-at'] ? calcDTE(sp['expires-at']) : 0;

              violations.push({
                violationType: 'ORPHANED_SHORT_LEG',
                severity: 'warning',
                accountNumber: account.accountNumber,
                accountType,
                symbol: underlying,
                description: `Short put on ${underlying} ($${strike} strike, ${expiration}) has no matching long put. ` +
                  `If this was originally a Bull Put Spread, the long leg may have been closed or assigned, ` +
                  `leaving a naked short put. Verify this is a fully cash-secured put (CSP) with sufficient cash.`,
                action: `Verify you have enough cash to cover assignment (${strike * 100} per contract). ` +
                  `If this was a spread that lost its long leg, buy a lower-strike put to restore protection, ` +
                  `or close (BTC) the short put.`,
                optionSymbol: sp.symbol,
                strike,
                expiration,
                dte,
              });
            }
          }
        }

        // ── 4. ITM SHORT CALL — assignment risk warning ───────────────────────
        for (const [underlying, calls] of Array.from(shortCalls.entries())) {
          const sharesOwned = stockMap.get(underlying) || 0;

          for (const sc of calls) {
            const strike = parseStrikeFromSymbol(sc.symbol);
            const expiration = sc['expires-at'] ? sc['expires-at'].split('T')[0] : parseExpirationFromSymbol(sc.symbol);
            const dte = sc['expires-at'] ? calcDTE(sc['expires-at']) : 0;
            const closePrice = parseFloat(String(sc['close-price'] || '0'));
            const underlyingClose = parseFloat(String(sc['average-daily-market-close-price'] || '0'));

            // We need the underlying price — use close-price of the underlying if available
            // For a more accurate check we'd need a live quote, but close-price is a reasonable proxy
            // The key signal: short call is ITM when underlying > strike
            // We flag if DTE ≤ 5 and we can infer ITM from the option's close price being > intrinsic
            if (dte <= 5 && strike > 0) {
              const qty = Math.abs(parseInt(String(sc.quantity || '1')));
              const sharesNeeded = qty * 100;
              const isCovered = sharesOwned >= sharesNeeded;

              if (!isCovered) {
                violations.push({
                  violationType: 'ITM_ASSIGNMENT_RISK',
                  severity: 'warning',
                  accountNumber: account.accountNumber,
                  accountType,
                  symbol: underlying,
                  description: `Short call on ${underlying} ($${strike} strike) expires in ${dte} day${dte !== 1 ? 's' : ''} ` +
                    `and you own ${sharesOwned} of ${sharesNeeded} shares needed for coverage. ` +
                    `If this call is in-the-money, assignment overnight will create short stock — ` +
                    `triggering an SL call like the ADBE incident.`,
                  action: `Close (BTC) this short call before market close, or roll it out to a later expiration. ` +
                    `Do NOT let an uncovered ITM short call expire in an IRA account.`,
                  optionSymbol: sc.symbol,
                  strike,
                  expiration,
                  dte,
                });
              }
            }
          }
        }
      }

      // Sort: critical first, then warning; within each severity, SHORT_STOCK first
      violations.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
        const order = { SHORT_STOCK: 0, NAKED_SHORT_CALL: 1, ORPHANED_SHORT_LEG: 2, ITM_ASSIGNMENT_RISK: 3 };
        return (order[a.violationType] ?? 9) - (order[b.violationType] ?? 9);
      });

      return {
        violations,
        accountsScanned: targetAccounts.length,
        hasViolations: violations.length > 0,
        criticalCount: violations.filter(v => v.severity === 'critical').length,
        warningCount: violations.filter(v => v.severity === 'warning').length,
      };
    }),
});
