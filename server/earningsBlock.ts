/**
 * Earnings Calendar Block
 *
 * Pre-flight check that prevents new option entries when an underlying
 * has earnings within the configured window (default: 7 days).
 *
 * Usage:
 *   const result = await checkEarningsBlock(symbols, tradierAPI);
 *   if (result.blocked.length > 0) throw / warn accordingly
 */
import { TradierAPI } from './tradier';

export interface EarningsBlockResult {
  /** Symbols that are BLOCKED — earnings within the hard-block window */
  blocked: EarningsHit[];
  /** Symbols that have a WARNING — earnings within the warn window but outside hard-block */
  warned: EarningsHit[];
  /** Symbols with no upcoming earnings concern */
  clear: string[];
}

export interface EarningsHit {
  symbol: string;
  earningsDate: string;
  daysUntil: number;
}

/**
 * Check a list of symbols for upcoming earnings.
 *
 * @param symbols   Underlying ticker symbols to check
 * @param tradierAPI  Initialized TradierAPI instance
 * @param blockDays Hard-block threshold in days (default 7 — no new entries within 7 days of earnings)
 * @param warnDays  Soft-warn threshold in days (default 14 — show warning but allow entry)
 */
export async function checkEarningsBlock(
  symbols: string[],
  tradierAPI: TradierAPI,
  blockDays = 7,
  warnDays = 14,
): Promise<EarningsBlockResult> {
  const result: EarningsBlockResult = { blocked: [], warned: [], clear: [] };

  if (!symbols || symbols.length === 0) return result;

  try {
    const earningsMap = await tradierAPI.getEarningsCalendar(symbols);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const symbol of symbols) {
      const dateStr = earningsMap.get(symbol);
      if (!dateStr) {
        result.clear.push(symbol);
        continue;
      }

      const earningsDate = new Date(dateStr);
      earningsDate.setHours(0, 0, 0, 0);
      const daysUntil = Math.round(
        (earningsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysUntil < 0) {
        // Earnings already passed — no concern
        result.clear.push(symbol);
      } else if (daysUntil <= blockDays) {
        result.blocked.push({ symbol, earningsDate: dateStr, daysUntil });
      } else if (daysUntil <= warnDays) {
        result.warned.push({ symbol, earningsDate: dateStr, daysUntil });
      } else {
        result.clear.push(symbol);
      }
    }
  } catch (err: any) {
    console.error('[EarningsBlock] Failed to fetch earnings calendar:', err.message);
    // On API failure, do NOT block — fail open so a Tradier outage doesn't
    // prevent legitimate order submissions. Log the error for visibility.
  }

  return result;
}

/**
 * Build a human-readable summary of earnings blocks for display in the UI.
 */
export function formatEarningsBlockMessage(result: EarningsBlockResult): string {
  const lines: string[] = [];

  if (result.blocked.length > 0) {
    lines.push(
      `⛔ EARNINGS BLOCK: ${result.blocked
        .map(h => `${h.symbol} (${h.daysUntil}d)`)
        .join(', ')} — earnings within 7 days. Orders blocked.`,
    );
  }

  if (result.warned.length > 0) {
    lines.push(
      `⚠ Earnings Warning: ${result.warned
        .map(h => `${h.symbol} (${h.daysUntil}d)`)
        .join(', ')} — earnings within 14 days. Proceed with caution.`,
    );
  }

  return lines.join('\n');
}
