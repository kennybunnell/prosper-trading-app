/**
 * Portfolio Advisor Router
 * Provides comprehensive portfolio risk analysis and recommendations
 *
 * Fixes applied:
 * 1. Underwater detection: parse OCC symbols for put/call, fetch live quotes from Tradier
 * 2. Buying power: fetch balances from Tastytrade for each account
 * 3. Spread-aware capital-at-risk: detect spread pairs, use spread width not full strike
 * 4. Recalibrated risk score: lower concentration thresholds, capital utilization factor
 */

import { router, protectedProcedure } from './_core/trpc';

// ─── OCC Symbol Parser (same proven pattern as automation + rolls scanners) ───
function parseOCC(symbol: string): {
  underlying: string;
  expiration: string;       // YYYY-MM-DD
  optionType: 'PUT' | 'CALL';
  strike: number;
} | null {
  try {
    const clean = symbol.replace(/\s/g, '');
    const m = clean.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
    if (!m) return null;
    const underlying = m[1];
    const ds = m[2];
    const optionType = m[3] === 'P' ? 'PUT' : 'CALL';
    const strike = parseInt(m[4]) / 1000;
    const year = 2000 + parseInt(ds.substring(0, 2));
    const month = parseInt(ds.substring(2, 4));
    const day = parseInt(ds.substring(4, 6));
    const expiration = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { underlying, expiration, optionType, strike };
  } catch {
    return null;
  }
}

// ─── Sector Mapping (static lookup for common tickers) ───────────────────────
const SECTOR_MAP: Record<string, string> = {
  // Technology
  AAPL: 'Technology', MSFT: 'Technology', NVDA: 'Technology', AMD: 'Technology',
  GOOGL: 'Technology', GOOG: 'Technology', META: 'Technology', AMZN: 'Technology',
  CRM: 'Technology', ORCL: 'Technology', ADBE: 'Technology', INTC: 'Technology',
  CSCO: 'Technology', AVGO: 'Technology', TXN: 'Technology', QCOM: 'Technology',
  MU: 'Technology', ANET: 'Technology', NOW: 'Technology', PANW: 'Technology',
  CRWD: 'Technology', NET: 'Technology', DDOG: 'Technology', SNOW: 'Technology',
  PLTR: 'Technology', MRVL: 'Technology', ARM: 'Technology', SMCI: 'Technology',
  TSM: 'Technology', DELL: 'Technology', HPE: 'Technology', IBM: 'Technology',
  UBER: 'Technology', SHOP: 'Technology', SQ: 'Technology', PYPL: 'Technology',
  COIN: 'Technology', HOOD: 'Technology', SOFI: 'Technology', AFRM: 'Technology',
  RBLX: 'Technology', U: 'Technology', TTWO: 'Technology', EA: 'Technology',
  NFLX: 'Technology', ROKU: 'Technology', SPOT: 'Technology', PINS: 'Technology',
  SNAP: 'Technology', TWLO: 'Technology', ZS: 'Technology', OKTA: 'Technology',
  MDB: 'Technology', TEAM: 'Technology', WDAY: 'Technology', HUBS: 'Technology',
  VEEV: 'Technology', DOCU: 'Technology', ZM: 'Technology', ABNB: 'Technology',
  DASH: 'Technology', LYFT: 'Technology', PATH: 'Technology', AI: 'Technology',
  IONQ: 'Technology', RGTI: 'Technology', QBTS: 'Technology', SOUN: 'Technology',
  APLD: 'Technology', APP: 'Technology', RDDT: 'Technology',
  // Healthcare
  JNJ: 'Healthcare', UNH: 'Healthcare', PFE: 'Healthcare', ABBV: 'Healthcare',
  MRK: 'Healthcare', LLY: 'Healthcare', TMO: 'Healthcare', ABT: 'Healthcare',
  BMY: 'Healthcare', AMGN: 'Healthcare', GILD: 'Healthcare', ISRG: 'Healthcare',
  MDT: 'Healthcare', CVS: 'Healthcare', CI: 'Healthcare', HUM: 'Healthcare',
  MRNA: 'Healthcare', BNTX: 'Healthcare', HIMS: 'Healthcare', TDOC: 'Healthcare',
  DXCM: 'Healthcare', GEHC: 'Healthcare', ELV: 'Healthcare',
  // Financials
  JPM: 'Financials', BAC: 'Financials', WFC: 'Financials', GS: 'Financials',
  MS: 'Financials', C: 'Financials', BLK: 'Financials', SCHW: 'Financials',
  AXP: 'Financials', V: 'Financials', MA: 'Financials', COF: 'Financials',
  DFS: 'Financials', BRK: 'Financials', MET: 'Financials', PRU: 'Financials',
  AIG: 'Financials', TFC: 'Financials', USB: 'Financials', PNC: 'Financials',
  // Consumer Discretionary
  TSLA: 'Consumer Discretionary', NKE: 'Consumer Discretionary', SBUX: 'Consumer Discretionary',
  MCD: 'Consumer Discretionary', HD: 'Consumer Discretionary', LOW: 'Consumer Discretionary',
  TGT: 'Consumer Discretionary', COST: 'Consumer Discretionary', WMT: 'Consumer Discretionary',
  DIS: 'Consumer Discretionary', CMCSA: 'Consumer Discretionary', BABA: 'Consumer Discretionary',
  JD: 'Consumer Discretionary', PDD: 'Consumer Discretionary', LULU: 'Consumer Discretionary',
  RVLV: 'Consumer Discretionary', ETSY: 'Consumer Discretionary', W: 'Consumer Discretionary',
  // Energy
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', SLB: 'Energy',
  EOG: 'Energy', OXY: 'Energy', MPC: 'Energy', PSX: 'Energy',
  VLO: 'Energy', HAL: 'Energy', DVN: 'Energy', FANG: 'Energy',
  // Industrials
  CAT: 'Industrials', BA: 'Industrials', GE: 'Industrials', HON: 'Industrials',
  UPS: 'Industrials', FDX: 'Industrials', RTX: 'Industrials', LMT: 'Industrials',
  DE: 'Industrials', MMM: 'Industrials', UNP: 'Industrials', WM: 'Industrials',
  // Materials
  LIN: 'Materials', APD: 'Materials', SHW: 'Materials', ECL: 'Materials',
  NEM: 'Materials', FCX: 'Materials', DOW: 'Materials', NUE: 'Materials',
  // Real Estate / REITs
  AMT: 'Real Estate', PLD: 'Real Estate', CCI: 'Real Estate', EQIX: 'Real Estate',
  SPG: 'Real Estate', O: 'Real Estate', DLR: 'Real Estate', PSA: 'Real Estate',
  // Utilities
  NEE: 'Utilities', DUK: 'Utilities', SO: 'Utilities', D: 'Utilities',
  AEP: 'Utilities', EXC: 'Utilities', SRE: 'Utilities', XEL: 'Utilities',
  // Communication Services
  T: 'Communication', VZ: 'Communication', TMUS: 'Communication',
  // ETFs (treated as their own "sector" for diversification purposes)
  SPY: 'ETF/Index', QQQ: 'ETF/Index', IWM: 'ETF/Index', DIA: 'ETF/Index',
  XLF: 'ETF/Index', XLE: 'ETF/Index', XLK: 'ETF/Index', XLV: 'ETF/Index',
  GLD: 'ETF/Index', SLV: 'ETF/Index', TLT: 'ETF/Index', HYG: 'ETF/Index',
  EEM: 'ETF/Index', VXX: 'ETF/Index', ARKK: 'ETF/Index', SOXL: 'ETF/Index',
  TQQQ: 'ETF/Index', SQQQ: 'ETF/Index', UVXY: 'ETF/Index', MSTR: 'ETF/Index',
};

function getSector(ticker: string): string {
  return SECTOR_MAP[ticker] || 'Other';
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParsedPosition {
  accountNumber: string;
  symbol: string;             // full OCC symbol or equity symbol
  underlyingSymbol: string;
  instrumentType: string;     // 'Equity Option' | 'Equity'
  quantity: number;           // always positive
  direction: 'short' | 'long';
  optionType?: 'PUT' | 'CALL';
  strike?: number;
  expiration?: string;        // YYYY-MM-DD
  closePrice: number;         // position close price (mark)
  averageOpenPrice: number;
  multiplier: number;
  delta: number;
}

interface SpreadPair {
  shortLeg: ParsedPosition;
  longLeg: ParsedPosition;
  spreadWidth: number;        // |shortStrike - longStrike|
  capitalAtRisk: number;      // spreadWidth * 100 * quantity
}

interface AccountBalance {
  accountNumber: string;
  nickname: string;
  accountType: string;
  derivativeBuyingPower: number;
  stockBuyingPower: number;
  netLiquidatingValue: number;
  cashAvailable: number;
  maintenanceRequirement: number;
}

// ─── Helper: parse all positions into a normalized structure ──────────────────

function parsePositions(rawPositions: any[], accountNumber: string): ParsedPosition[] {
  const results: ParsedPosition[] = [];
  for (const pos of rawPositions) {
    const instrumentType = pos['instrument-type'] || '';
    const symbol = pos.symbol || '';
    const underlyingSymbol = pos['underlying-symbol'] || symbol;
    const qty = parseInt(String(pos.quantity || '0'));
    const direction = (pos['quantity-direction']?.toLowerCase() === 'short' || qty < 0) ? 'short' as const : 'long' as const;
    const quantity = Math.abs(qty);
    const multiplier = parseInt(String(pos.multiplier || '100'));
    const closePrice = parseFloat(String(pos['close-price'] || '0'));
    const averageOpenPrice = parseFloat(String(pos['average-open-price'] || '0'));
    const delta = parseFloat(String(pos.delta || '0'));

    if (instrumentType === 'Equity Option') {
      const parsed = parseOCC(symbol);
      results.push({
        accountNumber,
        symbol,
        underlyingSymbol: parsed?.underlying || underlyingSymbol,
        instrumentType,
        quantity,
        direction,
        optionType: parsed?.optionType,
        strike: parsed?.strike,
        expiration: parsed?.expiration,
        closePrice,
        averageOpenPrice,
        multiplier,
        delta,
      });
    } else if (instrumentType === 'Equity') {
      results.push({
        accountNumber,
        symbol,
        underlyingSymbol,
        instrumentType,
        quantity,
        direction,
        closePrice,
        averageOpenPrice,
        multiplier: 1,
        delta: 1.0, // stock delta = 1 per share
      });
    }
  }
  return results;
}

// ─── Helper: detect spread pairs and compute capital at risk ─────────────────

function detectSpreads(positions: ParsedPosition[]): {
  spreads: SpreadPair[];
  standaloneShorts: ParsedPosition[];
  standaloneLongs: ParsedPosition[];
  equities: ParsedPosition[];
} {
  const options = positions.filter(p => p.instrumentType === 'Equity Option');
  const equities = positions.filter(p => p.instrumentType === 'Equity');

  // Group by underlying + expiration + optionType
  const groups = new Map<string, { shorts: ParsedPosition[]; longs: ParsedPosition[] }>();
  for (const opt of options) {
    const key = `${opt.underlyingSymbol}|${opt.expiration}|${opt.optionType}`;
    if (!groups.has(key)) groups.set(key, { shorts: [], longs: [] });
    const g = groups.get(key)!;
    if (opt.direction === 'short') g.shorts.push(opt);
    else g.longs.push(opt);
  }

  const spreads: SpreadPair[] = [];
  const standaloneShorts: ParsedPosition[] = [];
  const standaloneLongs: ParsedPosition[] = [];

  for (const [, group] of Array.from(groups)) {
    // Sort shorts by strike descending, longs by strike ascending for matching
    const shorts = [...group.shorts].sort((a, b) => (b.strike || 0) - (a.strike || 0));
    const longs = [...group.longs].sort((a, b) => (a.strike || 0) - (b.strike || 0));

    const usedLongs = new Set<number>();

    for (const shortLeg of shorts) {
      // Find a matching long leg (same quantity, different strike)
      let matched = false;
      for (let i = 0; i < longs.length; i++) {
        if (usedLongs.has(i)) continue;
        const longLeg = longs[i];
        if (longLeg.quantity === shortLeg.quantity && longLeg.strike !== shortLeg.strike) {
          const spreadWidth = Math.abs((shortLeg.strike || 0) - (longLeg.strike || 0));
          spreads.push({
            shortLeg,
            longLeg,
            spreadWidth,
            capitalAtRisk: spreadWidth * 100 * shortLeg.quantity,
          });
          usedLongs.add(i);
          matched = true;
          break;
        }
      }
      if (!matched) {
        standaloneShorts.push(shortLeg);
      }
    }

    // Remaining unmatched longs
    for (let i = 0; i < longs.length; i++) {
      if (!usedLongs.has(i)) standaloneLongs.push(longs[i]);
    }
  }

  return { spreads, standaloneShorts, standaloneLongs, equities };
}

// ─── Helper: compute capital at risk per ticker ──────────────────────────────

function computeCapitalAtRisk(
  spreads: SpreadPair[],
  standaloneShorts: ParsedPosition[],
  equities: ParsedPosition[],
  quoteMap: Map<string, number>,
): { tickerExposure: Map<string, number>; totalCapitalAtRisk: number } {
  const tickerExposure = new Map<string, number>();
  let totalCapitalAtRisk = 0;

  // Spreads: capital at risk = spread width * 100 * qty
  for (const sp of spreads) {
    const ticker = sp.shortLeg.underlyingSymbol;
    totalCapitalAtRisk += sp.capitalAtRisk;
    tickerExposure.set(ticker, (tickerExposure.get(ticker) || 0) + sp.capitalAtRisk);
  }

  // Standalone short puts: collateral = strike * 100 * qty
  // Standalone short calls: use underlying price * 100 * qty (or strike if no quote)
  for (const pos of standaloneShorts) {
    const ticker = pos.underlyingSymbol;
    let capitalAtRisk: number;
    if (pos.optionType === 'PUT') {
      capitalAtRisk = (pos.strike || 0) * 100 * pos.quantity;
    } else {
      // Short call: capital at risk based on underlying price
      const underlyingPrice = quoteMap.get(ticker) || pos.closePrice || (pos.strike || 0);
      capitalAtRisk = underlyingPrice * 100 * pos.quantity;
    }
    totalCapitalAtRisk += capitalAtRisk;
    tickerExposure.set(ticker, (tickerExposure.get(ticker) || 0) + capitalAtRisk);
  }

  // Equities: market value
  for (const pos of equities) {
    const ticker = pos.underlyingSymbol;
    const price = quoteMap.get(ticker) || pos.closePrice;
    const marketValue = price * pos.quantity;
    totalCapitalAtRisk += marketValue;
    tickerExposure.set(ticker, (tickerExposure.get(ticker) || 0) + marketValue);
  }

  return { tickerExposure, totalCapitalAtRisk };
}

// ─── Helper: detect underwater positions ─────────────────────────────────────

function detectUnderwaterPositions(
  spreads: SpreadPair[],
  standaloneShorts: ParsedPosition[],
  quoteMap: Map<string, number>,
): Array<{
  ticker: string;
  strike: number;
  currentPrice: number;
  percentBelow: number;
  isSpread: boolean;
  spreadWidth?: number;
  maxLoss?: number;
}> {
  const underwater: Array<{
    ticker: string;
    strike: number;
    currentPrice: number;
    percentBelow: number;
    isSpread: boolean;
    spreadWidth?: number;
    maxLoss?: number;
  }> = [];

  // Check standalone short puts
  for (const pos of standaloneShorts) {
    if (pos.optionType !== 'PUT') continue;
    const ticker = pos.underlyingSymbol;
    const currentPrice = quoteMap.get(ticker);
    if (!currentPrice) continue; // skip if no quote available
    const strike = pos.strike || 0;
    if (currentPrice < strike) {
      underwater.push({
        ticker,
        strike,
        currentPrice,
        percentBelow: ((strike - currentPrice) / strike) * 100,
        isSpread: false,
      });
    }
  }

  // Check spread short legs (put spreads where underlying < short strike)
  for (const sp of spreads) {
    if (sp.shortLeg.optionType !== 'PUT') continue;
    const ticker = sp.shortLeg.underlyingSymbol;
    const currentPrice = quoteMap.get(ticker);
    if (!currentPrice) continue;
    const shortStrike = sp.shortLeg.strike || 0;
    if (currentPrice < shortStrike) {
      underwater.push({
        ticker,
        strike: shortStrike,
        currentPrice,
        percentBelow: ((shortStrike - currentPrice) / shortStrike) * 100,
        isSpread: true,
        spreadWidth: sp.spreadWidth,
        maxLoss: sp.capitalAtRisk,
      });
    }
  }

  // Check short calls (underwater = underlying above strike)
  for (const pos of standaloneShorts) {
    if (pos.optionType !== 'CALL') continue;
    const ticker = pos.underlyingSymbol;
    const currentPrice = quoteMap.get(ticker);
    if (!currentPrice) continue;
    const strike = pos.strike || 0;
    if (currentPrice > strike) {
      underwater.push({
        ticker,
        strike,
        currentPrice,
        percentBelow: ((currentPrice - strike) / strike) * 100, // % above strike for calls
        isSpread: false,
      });
    }
  }

  // Check bear call spread short legs
  for (const sp of spreads) {
    if (sp.shortLeg.optionType !== 'CALL') continue;
    const ticker = sp.shortLeg.underlyingSymbol;
    const currentPrice = quoteMap.get(ticker);
    if (!currentPrice) continue;
    const shortStrike = sp.shortLeg.strike || 0;
    if (currentPrice > shortStrike) {
      underwater.push({
        ticker,
        strike: shortStrike,
        currentPrice,
        percentBelow: ((currentPrice - shortStrike) / shortStrike) * 100,
        isSpread: true,
        spreadWidth: sp.spreadWidth,
        maxLoss: sp.capitalAtRisk,
      });
    }
  }

  return underwater.sort((a, b) => b.percentBelow - a.percentBelow);
}

// ─── Helper: compute risk score (recalibrated) ───────────────────────────────

function computeRiskScore(
  maxConcentrationPct: number,
  underwaterCount: number,
  totalPositionCount: number,
  diversificationScore: number,
  capitalUtilizationPct: number,
): number {
  let score = 0;

  // Factor 1: Concentration risk (max 35 points) — recalibrated with lower thresholds
  if (maxConcentrationPct >= 40) score += 35;
  else if (maxConcentrationPct >= 25) score += 28;
  else if (maxConcentrationPct >= 15) score += 20;
  else if (maxConcentrationPct >= 8) score += 12;
  else if (maxConcentrationPct >= 5) score += 5;

  // Factor 2: Underwater positions (max 25 points)
  if (totalPositionCount > 0) {
    const underwaterPct = (underwaterCount / totalPositionCount) * 100;
    if (underwaterPct >= 50) score += 25;
    else if (underwaterPct >= 30) score += 20;
    else if (underwaterPct >= 15) score += 15;
    else if (underwaterPct >= 5) score += 8;
    else if (underwaterCount > 0) score += 4;
  }

  // Factor 3: Diversification (max 20 points — inverse of diversification score)
  score += Math.round((100 - diversificationScore) * 0.2);

  // Factor 4: Capital utilization (max 20 points) — new factor
  // High capital utilization = more risk (less room for adjustments)
  if (capitalUtilizationPct >= 90) score += 20;
  else if (capitalUtilizationPct >= 75) score += 15;
  else if (capitalUtilizationPct >= 60) score += 10;
  else if (capitalUtilizationPct >= 40) score += 5;

  return Math.min(100, score);
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const portfolioAdvisorRouter = router({
  /**
   * Get portfolio summary for Dashboard cards
   */
  getSummary: protectedProcedure.query(async ({ ctx }) => {
    const emptyResult = {
      riskScore: 0,
      topConcentrations: [] as { ticker: string; exposure: number; percentage: number }[],
      underwaterPositions: 0,
      diversificationScore: 0,
      tickerCount: 0,
      sectorCount: 0,
      totalBuyingPower: 0,
      totalNetLiq: 0,
      accountBalances: [] as AccountBalance[],
      capitalUtilizationPct: 0,
    };

    try {
      const { getApiCredentials, getTastytradeAccounts } = await import('./db');
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        return emptyResult;
      }

      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

      const accounts = await getTastytradeAccounts(ctx.user.id);
      if (!accounts || accounts.length === 0) return emptyResult;

      // ── Fetch positions + balances in parallel across all accounts ──
      const allParsed: ParsedPosition[] = [];
      const accountBalances: AccountBalance[] = [];

      await Promise.all(accounts.map(async (account) => {
        const [positions, balances] = await Promise.all([
          api.getPositions(account.accountNumber).catch(() => []),
          api.getBalances(account.accountNumber).catch(() => null),
        ]);

        if (positions && positions.length > 0) {
          allParsed.push(...parsePositions(positions, account.accountNumber));
        }

        if (balances) {
          accountBalances.push({
            accountNumber: account.accountNumber,
            nickname: account.nickname || account.accountNumber,
            accountType: account.accountType || 'Unknown',
            derivativeBuyingPower: parseFloat(String(balances['derivative-buying-power'] || '0')),
            stockBuyingPower: parseFloat(String(balances['stock-buying-power'] || balances['equity-buying-power'] || '0')),
            netLiquidatingValue: parseFloat(String(balances['net-liquidating-value'] || '0')),
            cashAvailable: parseFloat(String(balances['cash-available-to-withdraw'] || balances['available-trading-funds'] || '0')),
            maintenanceRequirement: parseFloat(String(balances['maintenance-requirement'] || '0')),
          });
        }
      }));

      // ── Fetch live quotes from Tradier for all underlying symbols ──
      const uniqueUnderlyings = Array.from(new Set(allParsed.map(p => p.underlyingSymbol)));
      const quoteMap = new Map<string, number>();

      if (uniqueUnderlyings.length > 0 && credentials.tradierApiKey) {
        try {
          const { createTradierAPI } = await import('./tradier');
          const tradier = createTradierAPI(credentials.tradierApiKey);
          // Batch in groups of 50 to avoid URL length limits
          for (let i = 0; i < uniqueUnderlyings.length; i += 50) {
            const batch = uniqueUnderlyings.slice(i, i + 50);
            const quotes = await tradier.getQuotes(batch);
            for (const q of quotes) {
              if (q.symbol && q.last) {
                quoteMap.set(q.symbol, q.last);
              }
            }
          }
        } catch (err: any) {
          console.warn('[Portfolio Advisor] Failed to fetch Tradier quotes:', err.message);
          // Continue without live quotes — will use position close prices as fallback
        }
      }

      // ── Detect spreads and compute capital at risk ──
      const { spreads, standaloneShorts, standaloneLongs: _standaloneLongs, equities } = detectSpreads(allParsed);
      const { tickerExposure, totalCapitalAtRisk } = computeCapitalAtRisk(spreads, standaloneShorts, equities, quoteMap);

      // ── Concentration ──
      const topConcentrations = Array.from(tickerExposure.entries())
        .map(([ticker, exposure]) => ({
          ticker,
          exposure,
          percentage: totalCapitalAtRisk > 0 ? (exposure / totalCapitalAtRisk) * 100 : 0,
        }))
        .sort((a, b) => b.exposure - a.exposure)
        .slice(0, 5);

      // ── Underwater detection ──
      const underwaterList = detectUnderwaterPositions(spreads, standaloneShorts, quoteMap);

      // ── Diversification score ──
      const tickerCount = new Set(tickerExposure.keys()).size;
      let diversificationScore = 0;
      if (tickerCount >= 20) diversificationScore = Math.min(100, 90 + (tickerCount - 20));
      else if (tickerCount >= 11) diversificationScore = 75 + ((tickerCount - 11) / 9) * 15;
      else if (tickerCount >= 7) diversificationScore = 60 + ((tickerCount - 7) / 4) * 15;
      else if (tickerCount >= 4) diversificationScore = 40 + ((tickerCount - 4) / 3) * 20;
      else if (tickerCount >= 1) diversificationScore = 20 + ((tickerCount - 1) / 3) * 20;

      // ── Sector count ──
      const sectorArr = Array.from(new Set(Array.from(tickerExposure.keys()).map(getSector)));
      const sectorCount = sectorArr.length;

      // ── Buying power totals ──
      const totalBuyingPower = accountBalances.reduce((sum, a) => sum + a.derivativeBuyingPower, 0);
      const totalNetLiq = accountBalances.reduce((sum, a) => sum + a.netLiquidatingValue, 0);
      const capitalUtilizationPct = totalNetLiq > 0 ? ((totalNetLiq - totalBuyingPower) / totalNetLiq) * 100 : 0;

      // ── Risk score ──
      const maxConcentration = topConcentrations.length > 0 ? topConcentrations[0].percentage : 0;
      const totalShortPositionCount = spreads.length + standaloneShorts.length;
      const riskScore = computeRiskScore(
        maxConcentration,
        underwaterList.length,
        totalShortPositionCount,
        diversificationScore,
        Math.max(0, capitalUtilizationPct),
      );

      return {
        riskScore: Math.min(100, riskScore),
        topConcentrations,
        underwaterPositions: underwaterList.length,
        diversificationScore: Math.round(diversificationScore),
        tickerCount,
        sectorCount,
        totalBuyingPower,
        totalNetLiq,
        accountBalances,
        capitalUtilizationPct: Math.round(Math.max(0, capitalUtilizationPct)),
      };
    } catch (error: any) {
      console.error('[Portfolio Advisor] Failed to get summary:', error.message);
      return emptyResult;
    }
  }),

  /**
   * Get detailed portfolio analysis for Portfolio Advisor page
   */
  getDetailedAnalysis: protectedProcedure.query(async ({ ctx }) => {
    try {
      const { getApiCredentials, getTastytradeAccounts } = await import('./db');
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
        throw new Error('Tastytrade credentials not configured');
      }

      const { authenticateTastytrade } = await import('./tastytrade');
      const api = await authenticateTastytrade(credentials, ctx.user.id);

      const accounts = await getTastytradeAccounts(ctx.user.id);
      if (!accounts || accounts.length === 0) throw new Error('No accounts found');

      // ── Fetch positions + balances in parallel ──
      const allParsed: ParsedPosition[] = [];
      const accountBalances: AccountBalance[] = [];

      await Promise.all(accounts.map(async (account) => {
        const [positions, balances] = await Promise.all([
          api.getPositions(account.accountNumber).catch(() => []),
          api.getBalances(account.accountNumber).catch(() => null),
        ]);

        if (positions && positions.length > 0) {
          allParsed.push(...parsePositions(positions, account.accountNumber));
        }

        if (balances) {
          accountBalances.push({
            accountNumber: account.accountNumber,
            nickname: account.nickname || account.accountNumber,
            accountType: account.accountType || 'Unknown',
            derivativeBuyingPower: parseFloat(String(balances['derivative-buying-power'] || '0')),
            stockBuyingPower: parseFloat(String(balances['stock-buying-power'] || balances['equity-buying-power'] || '0')),
            netLiquidatingValue: parseFloat(String(balances['net-liquidating-value'] || '0')),
            cashAvailable: parseFloat(String(balances['cash-available-to-withdraw'] || balances['available-trading-funds'] || '0')),
            maintenanceRequirement: parseFloat(String(balances['maintenance-requirement'] || '0')),
          });
        }
      }));

      // ── Fetch live quotes from Tradier ──
      const uniqueUnderlyings = Array.from(new Set(allParsed.map(p => p.underlyingSymbol)));
      const quoteMap = new Map<string, number>();

      if (uniqueUnderlyings.length > 0 && credentials.tradierApiKey) {
        try {
          const { createTradierAPI } = await import('./tradier');
          const tradier = createTradierAPI(credentials.tradierApiKey);
          for (let i = 0; i < uniqueUnderlyings.length; i += 50) {
            const batch = uniqueUnderlyings.slice(i, i + 50);
            const quotes = await tradier.getQuotes(batch);
            for (const q of quotes) {
              if (q.symbol && q.last) {
                quoteMap.set(q.symbol, q.last);
              }
            }
          }
        } catch (err: any) {
          console.warn('[Portfolio Advisor] Failed to fetch Tradier quotes:', err.message);
        }
      }

      // ── Detect spreads and compute capital at risk ──
      const { spreads, standaloneShorts, standaloneLongs: _standaloneLongs, equities } = detectSpreads(allParsed);
      const { tickerExposure, totalCapitalAtRisk } = computeCapitalAtRisk(spreads, standaloneShorts, equities, quoteMap);

      // ── Concentration breakdown ──
      const concentrations = Array.from(tickerExposure.entries())
        .map(([ticker, exposure]) => ({
          ticker,
          sector: getSector(ticker),
          capitalAtRisk: exposure,
          percentage: totalCapitalAtRisk > 0 ? (exposure / totalCapitalAtRisk) * 100 : 0,
        }))
        .sort((a, b) => b.capitalAtRisk - a.capitalAtRisk);

      // ── Sector concentration ──
      const sectorExposure = new Map<string, number>();
      for (const c of concentrations) {
        sectorExposure.set(c.sector, (sectorExposure.get(c.sector) || 0) + c.capitalAtRisk);
      }
      const sectorConcentrations = Array.from(sectorExposure.entries())
        .map(([sector, exposure]) => ({
          sector,
          capitalAtRisk: exposure,
          percentage: totalCapitalAtRisk > 0 ? (exposure / totalCapitalAtRisk) * 100 : 0,
          tickerCount: concentrations.filter(c => c.sector === sector).length,
        }))
        .sort((a, b) => b.capitalAtRisk - a.capitalAtRisk);

      // ── Underwater positions ──
      const underwaterPositions = detectUnderwaterPositions(spreads, standaloneShorts, quoteMap);

      // ── Portfolio delta ──
      let totalDelta = 0;
      for (const pos of allParsed) {
        if (pos.instrumentType === 'Equity Option') {
          const sign = pos.direction === 'short' ? -1 : 1;
          totalDelta += pos.delta * sign * pos.quantity * 100;
        } else if (pos.instrumentType === 'Equity') {
          totalDelta += pos.quantity; // 1 delta per share
        }
      }
      const deltaPer1000 = totalCapitalAtRisk > 0 ? (totalDelta / (totalCapitalAtRisk / 1000)) : 0;

      // ── Buying power ──
      const totalBuyingPower = accountBalances.reduce((sum, a) => sum + a.derivativeBuyingPower, 0);
      const totalNetLiq = accountBalances.reduce((sum, a) => sum + a.netLiquidatingValue, 0);
      const capitalUtilizationPct = totalNetLiq > 0 ? ((totalNetLiq - totalBuyingPower) / totalNetLiq) * 100 : 0;

      // ── Spread summary ──
      const spreadSummary = {
        totalSpreads: spreads.length,
        totalStandaloneShorts: standaloneShorts.length,
        spreadCapitalAtRisk: spreads.reduce((sum, sp) => sum + sp.capitalAtRisk, 0),
        standaloneCapitalAtRisk: standaloneShorts.reduce((sum, pos) => {
          if (pos.optionType === 'PUT') return sum + (pos.strike || 0) * 100 * pos.quantity;
          const price = quoteMap.get(pos.underlyingSymbol) || pos.closePrice || (pos.strike || 0);
          return sum + price * 100 * pos.quantity;
        }, 0),
      };

      // ── Diversification ──
      const tickerCount = new Set(tickerExposure.keys()).size;
      let diversificationScore = 0;
      if (tickerCount >= 20) diversificationScore = Math.min(100, 90 + (tickerCount - 20));
      else if (tickerCount >= 11) diversificationScore = 75 + ((tickerCount - 11) / 9) * 15;
      else if (tickerCount >= 7) diversificationScore = 60 + ((tickerCount - 7) / 4) * 15;
      else if (tickerCount >= 4) diversificationScore = 40 + ((tickerCount - 4) / 3) * 20;
      else if (tickerCount >= 1) diversificationScore = 20 + ((tickerCount - 1) / 3) * 20;

      // ── Risk score ──
      const maxConcentration = concentrations.length > 0 ? concentrations[0].percentage : 0;
      const totalShortPositionCount = spreads.length + standaloneShorts.length;
      const riskScore = computeRiskScore(
        maxConcentration,
        underwaterPositions.length,
        totalShortPositionCount,
        diversificationScore,
        Math.max(0, capitalUtilizationPct),
      );

      // ── Position sizing violations ──
      const violations2pct = concentrations.filter(c => c.percentage > 2).length;
      const violations10pct = concentrations.filter(c => c.percentage > 10).length;
      const violations25pctSector = sectorConcentrations.filter(s => s.percentage > 25).length;

      // ── Recommendations ──
      const actionItems: Array<{ priority: string; description: string }> = [];

      if (violations10pct > 0) {
        actionItems.push({
          priority: 'high',
          description: `Reduce concentration in ${concentrations[0].ticker} (${concentrations[0].percentage.toFixed(1)}% of portfolio). Target: <10% per ticker.`,
        });
      }
      if (underwaterPositions.length > 0) {
        const worstPct = underwaterPositions[0].percentBelow.toFixed(1);
        actionItems.push({
          priority: 'high',
          description: `${underwaterPositions.length} position${underwaterPositions.length > 1 ? 's are' : ' is'} underwater. Worst: ${underwaterPositions[0].ticker} at -${worstPct}%. Consider rolling or closing.`,
        });
      }
      if (violations25pctSector > 0) {
        const worstSector = sectorConcentrations[0];
        actionItems.push({
          priority: 'high',
          description: `${worstSector.sector} sector at ${worstSector.percentage.toFixed(1)}% exceeds 25% limit. Diversify across sectors.`,
        });
      }
      if (Math.abs(deltaPer1000) > 5) {
        actionItems.push({
          priority: 'medium',
          description: `Portfolio delta is ${deltaPer1000.toFixed(2)} per $1000. Consider hedging to reduce directional risk.`,
        });
      }
      if (capitalUtilizationPct > 75) {
        actionItems.push({
          priority: 'medium',
          description: `Capital utilization at ${capitalUtilizationPct.toFixed(0)}%. Keep below 75% for adjustment room.`,
        });
      }
      if (tickerCount < 7) {
        actionItems.push({
          priority: 'low',
          description: `Increase diversification. Currently only ${tickerCount} tickers. Target: 10+ tickers.`,
        });
      }

      // ── Past Trades placeholder (marked as placeholder) ──
      const pastTrades = {
        isPlaceholder: true,
        winRate: 0,
        totalWins: 0,
        totalLosses: 0,
        topPerformers: [] as Array<{ symbol: string; winRate: number; trades: number }>,
        worstPerformers: [] as Array<{ symbol: string; winRate: number; trades: number }>,
        patterns: [
          { description: 'Past trades analysis requires historical transaction data. This will be implemented in a future update.', severity: 'low' },
        ],
      };

      return {
        riskScore,
        pastTrades,
        buyingPower: {
          totalBuyingPower,
          totalNetLiq,
          capitalUtilizationPct: Math.round(Math.max(0, capitalUtilizationPct)),
          accountBalances,
        },
        currentPositions: {
          concentrations,
          sectorConcentrations,
          underwaterPositions,
          totalDelta,
          deltaPer1000,
          totalCapitalAtRisk,
          spreadSummary,
          tickerCount,
          sectorCount: sectorConcentrations.length,
          diversificationScore: Math.round(diversificationScore),
        },
        recommendations: {
          positionSizing: {
            violations2pct,
            violations10pct,
            violations25pct: violations25pctSector,
          },
          actionItems,
        },
      };
    } catch (error: any) {
      console.error('[Portfolio Advisor] Failed to get detailed analysis:', error.message);
      throw error;
    }
  }),
});
