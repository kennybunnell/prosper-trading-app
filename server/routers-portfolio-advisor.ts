/**
 * Portfolio Advisor Router
 * Provides comprehensive portfolio risk analysis and recommendations
 *
 * Fixes applied:
 * 1. Underwater detection: parse OCC symbols for put/call, fetch live quotes from Tradier
 * 2. Buying power: fetch balances from Tastytrade for each account
 * 3. Spread-aware capital-at-risk: detect spread pairs, use spread width not full strike
 * 4. Recalibrated risk score: lower concentration thresholds, capital utilization factor
 * 5. Covered call detection: short calls backed by stock are "Covered Call", not "Naked"
 * 6. Cash-secured put classification: short puts without a long leg are "Cash-Secured Put"
 * 7. Per-account matching: spreads only match within the same account
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
  SOFI: 'Technology', HOOD: 'Technology', COIN: 'Technology', MSTR: 'Technology',
  NBIS: 'Technology', ACHR: 'Technology', TEM: 'Technology', BMNR: 'Technology',
  // Crypto/Blockchain
  IBIT: 'Crypto/Blockchain', CIFR: 'Crypto/Blockchain', IREN: 'Crypto/Blockchain',
  APLD: 'Crypto/Blockchain', MARA: 'Crypto/Blockchain', RIOT: 'Crypto/Blockchain',
  CLSK: 'Crypto/Blockchain', HUT: 'Crypto/Blockchain', BTBT: 'Crypto/Blockchain',
  // Consumer Discretionary
  TSLA: 'Consumer Discretionary', NKE: 'Consumer Discretionary', SBUX: 'Consumer Discretionary',
  MCD: 'Consumer Discretionary', HD: 'Consumer Discretionary', LOW: 'Consumer Discretionary',
  TGT: 'Consumer Discretionary', COST: 'Consumer Discretionary', WMT: 'Consumer Discretionary',
  LYFT: 'Consumer Discretionary',
  // Healthcare
  JNJ: 'Healthcare', PFE: 'Healthcare', UNH: 'Healthcare', ABBV: 'Healthcare',
  MRK: 'Healthcare', LLY: 'Healthcare', BMY: 'Healthcare', AMGN: 'Healthcare',
  GILD: 'Healthcare', HIMS: 'Healthcare',
  // Financials
  JPM: 'Financials', BAC: 'Financials', GS: 'Financials', MS: 'Financials',
  WFC: 'Financials', C: 'Financials', SCHW: 'Financials', BLK: 'Financials',
  V: 'Financials', MA: 'Financials', AXP: 'Financials', PEP: 'Financials',
  // Industrials
  BA: 'Industrials', CAT: 'Industrials', GE: 'Industrials', HON: 'Industrials',
  UPS: 'Industrials', FDX: 'Industrials', RTX: 'Industrials', LMT: 'Industrials',
  DKNG: 'Industrials', PINS: 'Industrials',
  // Energy
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', SLB: 'Energy',
  EOG: 'Energy', OXY: 'Energy', MPC: 'Energy', VLO: 'Energy',
  // Materials
  LIN: 'Materials', APD: 'Materials', NEM: 'Materials', FCX: 'Materials',
  // Real Estate
  AMT: 'Real Estate', PLD: 'Real Estate', CCI: 'Real Estate', EQIX: 'Real Estate',
  O: 'Real Estate', SPG: 'Real Estate',
  // Utilities
  NEE: 'Utilities', DUK: 'Utilities', SO: 'Utilities', D: 'Utilities',
  AEP: 'Utilities', EXC: 'Utilities', SRE: 'Utilities', XEL: 'Utilities',
  // Communication Services
  T: 'Communication', VZ: 'Communication', TMUS: 'Communication',
  NFLX: 'Communication',
  // ETFs (treated as their own "sector" for diversification purposes)
  SPY: 'ETF/Index', QQQ: 'ETF/Index', IWM: 'ETF/Index', DIA: 'ETF/Index',
  XLF: 'ETF/Index', XLE: 'ETF/Index', XLK: 'ETF/Index', XLV: 'ETF/Index',
  GLD: 'ETF/Index', SLV: 'ETF/Index', TLT: 'ETF/Index', HYG: 'ETF/Index',
  EEM: 'ETF/Index', VXX: 'ETF/Index', ARKK: 'ETF/Index', SOXL: 'ETF/Index',
  TQQQ: 'ETF/Index', SQQQ: 'ETF/Index', UVXY: 'ETF/Index',
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

/** Classification of a short option position */
type PositionClassification = 'Spread' | 'Covered Call' | 'Cash-Secured Put' | 'Naked';

interface SpreadPair {
  shortLeg: ParsedPosition;
  longLeg: ParsedPosition;
  spreadWidth: number;        // |shortStrike - longStrike|
  capitalAtRisk: number;      // spreadWidth * 100 * quantity
}

interface CoveredCallPosition {
  shortCall: ParsedPosition;
  coveringShares: number;     // how many shares cover this call
  classification: 'Covered Call';
}

interface CashSecuredPutPosition {
  shortPut: ParsedPosition;
  classification: 'Cash-Secured Put';
}

interface NakedPosition {
  position: ParsedPosition;
  classification: 'Naked';
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

// ─── Helper: detect spreads, covered calls, and classify all short positions ──

function detectSpreadsAndClassify(positions: ParsedPosition[]): {
  spreads: SpreadPair[];
  coveredCalls: CoveredCallPosition[];
  cashSecuredPuts: CashSecuredPutPosition[];
  nakedPositions: NakedPosition[];
  standaloneLongs: ParsedPosition[];
  equities: ParsedPosition[];
} {
  const options = positions.filter(p => p.instrumentType === 'Equity Option');
  const equities = positions.filter(p => p.instrumentType === 'Equity');

  // Build a map of stock holdings per account+underlying for covered call detection
  // key: "accountNumber|underlying" → total long shares
  const stockHoldings = new Map<string, number>();
  for (const eq of equities) {
    if (eq.direction === 'long') {
      const key = `${eq.accountNumber}|${eq.underlyingSymbol}`;
      stockHoldings.set(key, (stockHoldings.get(key) || 0) + eq.quantity);
    }
  }

  // Track remaining shares available for covering calls (will be decremented)
  const remainingShares = new Map<string, number>(stockHoldings);

  // Step 1: Group options by account + underlying + expiration + optionType for spread matching
  const groups = new Map<string, { shorts: ParsedPosition[]; longs: ParsedPosition[] }>();
  for (const opt of options) {
    const key = `${opt.accountNumber}|${opt.underlyingSymbol}|${opt.expiration}|${opt.optionType}`;
    if (!groups.has(key)) groups.set(key, { shorts: [], longs: [] });
    const g = groups.get(key)!;
    if (opt.direction === 'short') g.shorts.push(opt);
    else g.longs.push(opt);
  }

  const spreads: SpreadPair[] = [];
  const unmatchedShorts: ParsedPosition[] = [];  // shorts that didn't match a spread
  const standaloneLongs: ParsedPosition[] = [];

  for (const [, group] of Array.from(groups)) {
    // Sort shorts by strike descending, longs by strike ascending for matching
    const shorts = [...group.shorts].sort((a, b) => (b.strike || 0) - (a.strike || 0));
    const longs = [...group.longs].sort((a, b) => (a.strike || 0) - (b.strike || 0));

    const usedLongs = new Set<number>();

    for (const shortLeg of shorts) {
      // Find a matching long leg (same quantity, different strike, same account)
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
        unmatchedShorts.push(shortLeg);
      }
    }

    // Remaining unmatched longs
    for (let i = 0; i < longs.length; i++) {
      if (!usedLongs.has(i)) standaloneLongs.push(longs[i]);
    }
  }

  // Step 2: Classify unmatched shorts as Covered Call, Cash-Secured Put, or Naked
  const coveredCalls: CoveredCallPosition[] = [];
  const cashSecuredPuts: CashSecuredPutPosition[] = [];
  const nakedPositions: NakedPosition[] = [];

  for (const shortPos of unmatchedShorts) {
    if (shortPos.optionType === 'CALL') {
      // Check if covered by stock in the same account
      const stockKey = `${shortPos.accountNumber}|${shortPos.underlyingSymbol}`;
      const availableShares = remainingShares.get(stockKey) || 0;
      const contractsNeeded = shortPos.quantity; // each contract = 100 shares
      const sharesNeeded = contractsNeeded * 100;

      if (availableShares >= sharesNeeded) {
        // Fully covered call
        coveredCalls.push({
          shortCall: shortPos,
          coveringShares: sharesNeeded,
          classification: 'Covered Call',
        });
        remainingShares.set(stockKey, availableShares - sharesNeeded);
      } else if (availableShares > 0) {
        // Partially covered — split into covered and naked portions
        const coveredContracts = Math.floor(availableShares / 100);
        if (coveredContracts > 0) {
          coveredCalls.push({
            shortCall: { ...shortPos, quantity: coveredContracts },
            coveringShares: coveredContracts * 100,
            classification: 'Covered Call',
          });
          remainingShares.set(stockKey, availableShares - coveredContracts * 100);
        }
        const nakedContracts = contractsNeeded - coveredContracts;
        if (nakedContracts > 0) {
          nakedPositions.push({
            position: { ...shortPos, quantity: nakedContracts },
            classification: 'Naked',
          });
        }
      } else {
        // No stock coverage — truly naked call
        nakedPositions.push({
          position: shortPos,
          classification: 'Naked',
        });
      }
    } else if (shortPos.optionType === 'PUT') {
      // Short puts without a long leg are "Cash-Secured Puts"
      // (They require cash/margin collateral but aren't "naked" in the dangerous sense)
      cashSecuredPuts.push({
        shortPut: shortPos,
        classification: 'Cash-Secured Put',
      });
    }
  }

  return { spreads, coveredCalls, cashSecuredPuts, nakedPositions, standaloneLongs, equities };
}

// ─── Helper: compute capital at risk per ticker ──────────────────────────────

function computeCapitalAtRisk(
  spreads: SpreadPair[],
  coveredCalls: CoveredCallPosition[],
  cashSecuredPuts: CashSecuredPutPosition[],
  nakedPositions: NakedPosition[],
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

  // Covered calls: capital at risk = stock market value (already counted in equities)
  // The short call caps upside but the stock IS the collateral
  // We don't double-count — the equity value already represents the exposure
  // But we do track the "opportunity cost" of being called away
  for (const cc of coveredCalls) {
    const ticker = cc.shortCall.underlyingSymbol;
    const strike = cc.shortCall.strike || 0;
    // Capital at risk for covered call = potential loss if stock drops to 0
    // But this is already captured by the equity position, so we skip here
    // to avoid double-counting with equities below
    // (The equity position already represents the full stock exposure)
  }

  // Cash-secured puts: collateral = strike * 100 * qty
  for (const csp of cashSecuredPuts) {
    const ticker = csp.shortPut.underlyingSymbol;
    const capitalAtRisk = (csp.shortPut.strike || 0) * 100 * csp.shortPut.quantity;
    totalCapitalAtRisk += capitalAtRisk;
    tickerExposure.set(ticker, (tickerExposure.get(ticker) || 0) + capitalAtRisk);
  }

  // Naked positions: full exposure
  for (const np of nakedPositions) {
    const ticker = np.position.underlyingSymbol;
    let capitalAtRisk: number;
    if (np.position.optionType === 'PUT') {
      capitalAtRisk = (np.position.strike || 0) * 100 * np.position.quantity;
    } else {
      // Naked call: theoretically unlimited, use underlying price * 100 * qty as proxy
      const underlyingPrice = quoteMap.get(ticker) || np.position.closePrice || (np.position.strike || 0);
      capitalAtRisk = underlyingPrice * 100 * np.position.quantity;
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

// ─── Types for enriched underwater positions ────────────────────────────────

interface UnderwaterPositionBase {
  ticker: string;
  strike: number;
  currentPrice: number;
  percentITM: number;
  classification: PositionClassification;
  optionType: 'PUT' | 'CALL';
  expiration?: string;
  quantity: number;
  // Drill-down details
  premiumCollected: number;       // premium received when position was opened (per share)
  currentOptionValue: number;     // current mark price of the option (per share)
  optionPnL: number;              // P&L on the option leg (positive = profit)
  breakEvenPrice: number;         // price at which position breaks even
  // WTR: Weeks to Recovery via CC premium harvesting
  estimatedWeeklyPremium?: number; // estimated weekly CC premium per share
  weeksToRecovery?: number;        // estimated weeks to recover unrealized loss via CC premiums
  wtrBasis?: string;               // explanation of WTR calculation
}

interface UnderwaterSpread extends UnderwaterPositionBase {
  classification: 'Spread';
  spreadWidth: number;
  maxLoss: number;
  longLegStrike: number;
  longLegPremium: number;  // what was paid for the long leg
}

interface UnderwaterCoveredCall extends UnderwaterPositionBase {
  classification: 'Covered Call';
  coveringShares: number;
  stockCostBasis: number;     // average open price of the stock
  stockMarketValue: number;   // current market value of covering shares
  stockPnL: number;           // unrealized P&L on the stock
  combinedPnL: number;        // stock P&L + option P&L
}

interface UnderwaterCSP extends UnderwaterPositionBase {
  classification: 'Cash-Secured Put';
  collateralRequired: number;
  maxLoss: number;
}

interface UnderwaterNaked extends UnderwaterPositionBase {
  classification: 'Naked';
  maxLoss?: number;  // undefined for naked calls (unlimited)
}

type UnderwaterPosition = UnderwaterSpread | UnderwaterCoveredCall | UnderwaterCSP | UnderwaterNaked;

// ─── Helper: estimate weekly CC premium for WTR calculation ─────────────────

function estimateWeeklyPremium(
  currentOptionPrice: number,
  daysToExpiration: number,
): number {
  // Annualize the current option premium and convert to weekly
  // If option has DTE, weekly premium ≈ currentPrice / (DTE / 7)
  if (daysToExpiration <= 0) return currentOptionPrice; // already expired, use full premium
  const weeksToExp = daysToExpiration / 7;
  if (weeksToExp <= 0) return currentOptionPrice;
  return currentOptionPrice / weeksToExp;
}

function getDaysToExpiration(expiration?: string): number {
  if (!expiration) return 30; // default assumption
  const expDate = new Date(expiration + 'T16:00:00Z'); // market close
  const now = new Date();
  const diffMs = expDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// ─── Helper: detect underwater positions (enriched with drill-down + WTR) ───

function detectUnderwaterPositions(
  spreads: SpreadPair[],
  coveredCalls: CoveredCallPosition[],
  cashSecuredPuts: CashSecuredPutPosition[],
  nakedPositions: NakedPosition[],
  quoteMap: Map<string, number>,
  equities: ParsedPosition[],
): UnderwaterPosition[] {
  const underwater: UnderwaterPosition[] = [];

  // Build equity lookup: accountNumber|underlying → { costBasis, quantity, marketValue }
  const equityLookup = new Map<string, { costBasis: number; quantity: number; currentPrice: number }>();
  for (const eq of equities) {
    if (eq.direction === 'long') {
      const key = `${eq.accountNumber}|${eq.underlyingSymbol}`;
      const existing = equityLookup.get(key);
      const price = quoteMap.get(eq.underlyingSymbol) || eq.closePrice;
      if (existing) {
        // Weighted average cost basis
        const totalQty = existing.quantity + eq.quantity;
        const weightedCost = (existing.costBasis * existing.quantity + eq.averageOpenPrice * eq.quantity) / totalQty;
        equityLookup.set(key, { costBasis: weightedCost, quantity: totalQty, currentPrice: price });
      } else {
        equityLookup.set(key, { costBasis: eq.averageOpenPrice, quantity: eq.quantity, currentPrice: price });
      }
    }
  }

  // Helper to build common fields for any short option position
  function buildBase(
    pos: ParsedPosition,
    currentPrice: number,
    strike: number,
    percentITM: number,
    classification: PositionClassification,
    optionType: 'PUT' | 'CALL',
  ): UnderwaterPositionBase {
    const premiumCollected = pos.averageOpenPrice;  // premium received when sold (per share)
    const currentOptionValue = pos.closePrice;       // current mark price (per share)
    const optionPnL = (premiumCollected - currentOptionValue) * pos.quantity * 100; // positive = profit
    const dte = getDaysToExpiration(pos.expiration);
    const weeklyPremium = estimateWeeklyPremium(currentOptionValue, dte);

    // Break-even for short put = strike - premium; for short call = strike + premium
    const breakEvenPrice = optionType === 'PUT'
      ? strike - premiumCollected
      : strike + premiumCollected;

    return {
      ticker: pos.underlyingSymbol,
      strike,
      currentPrice,
      percentITM,
      classification,
      optionType,
      expiration: pos.expiration,
      quantity: pos.quantity,
      premiumCollected,
      currentOptionValue,
      optionPnL,
      breakEvenPrice,
      estimatedWeeklyPremium: weeklyPremium,
    };
  }

  // Helper to compute WTR for covered call positions
  // WTR = unrealized stock loss / estimated weekly CC premium
  // "How many weeks of selling CCs to recover the stock's unrealized loss?"
  function computeWTR(
    stockCostBasis: number,
    currentStockPrice: number,
    weeklyPremiumPerShare: number,
    sharesPerContract: number,
    contracts: number,
  ): { weeksToRecovery: number | undefined; wtrBasis: string } {
    const unrealizedLossPerShare = stockCostBasis - currentStockPrice;
    if (unrealizedLossPerShare <= 0) {
      return { weeksToRecovery: 0, wtrBasis: 'Stock is at or above cost basis — no recovery needed' };
    }
    if (weeklyPremiumPerShare <= 0) {
      return { weeksToRecovery: undefined, wtrBasis: 'Cannot estimate — no premium data available' };
    }
    // Total loss across all covering shares
    const totalLoss = unrealizedLossPerShare * sharesPerContract * contracts;
    // Weekly premium across all contracts
    const totalWeeklyPremium = weeklyPremiumPerShare * sharesPerContract * contracts;
    const weeks = totalLoss / totalWeeklyPremium;
    return {
      weeksToRecovery: Math.round(weeks * 10) / 10,
      wtrBasis: `$${unrealizedLossPerShare.toFixed(2)}/share loss ÷ $${weeklyPremiumPerShare.toFixed(2)}/share/week CC premium`,
    };
  }

  // ── Cash-Secured Puts (underwater = underlying below strike) ──
  for (const csp of cashSecuredPuts) {
    const ticker = csp.shortPut.underlyingSymbol;
    const currentPrice = quoteMap.get(ticker);
    if (!currentPrice) continue;
    const strike = csp.shortPut.strike || 0;
    if (currentPrice < strike) {
      const base = buildBase(csp.shortPut, currentPrice, strike,
        ((strike - currentPrice) / strike) * 100, 'Cash-Secured Put', 'PUT');
      const collateral = strike * 100 * csp.shortPut.quantity;
      // WTR for CSP: if assigned, how many weeks of CC premium to recover?
      // Unrealized loss if assigned = (strike - currentPrice) per share, minus premium collected
      const assignmentLossPerShare = (strike - currentPrice) - csp.shortPut.averageOpenPrice;
      let wtrData: { weeksToRecovery?: number; wtrBasis: string };
      if (assignmentLossPerShare <= 0) {
        wtrData = { weeksToRecovery: 0, wtrBasis: 'Premium collected exceeds ITM amount — no recovery needed if assigned' };
      } else {
        const weeklyPremium = base.estimatedWeeklyPremium || 0;
        if (weeklyPremium > 0) {
          const weeks = assignmentLossPerShare / weeklyPremium;
          wtrData = {
            weeksToRecovery: Math.round(weeks * 10) / 10,
            wtrBasis: `$${assignmentLossPerShare.toFixed(2)}/share net loss if assigned ÷ $${weeklyPremium.toFixed(2)}/share/week est. CC premium`,
          };
        } else {
          wtrData = { weeksToRecovery: undefined, wtrBasis: 'Cannot estimate — no premium data' };
        }
      }
      underwater.push({
        ...base,
        classification: 'Cash-Secured Put',
        collateralRequired: collateral,
        maxLoss: collateral,
        weeksToRecovery: wtrData.weeksToRecovery,
        wtrBasis: wtrData.wtrBasis,
      } as UnderwaterCSP);
    }
  }

  // ── Naked Puts ──
  for (const np of nakedPositions) {
    if (np.position.optionType !== 'PUT') continue;
    const ticker = np.position.underlyingSymbol;
    const currentPrice = quoteMap.get(ticker);
    if (!currentPrice) continue;
    const strike = np.position.strike || 0;
    if (currentPrice < strike) {
      const base = buildBase(np.position, currentPrice, strike,
        ((strike - currentPrice) / strike) * 100, 'Naked', 'PUT');
      underwater.push({
        ...base,
        classification: 'Naked',
        maxLoss: strike * 100 * np.position.quantity,
      } as UnderwaterNaked);
    }
  }

  // ── Put Spreads (underlying < short strike) ──
  for (const sp of spreads) {
    if (sp.shortLeg.optionType !== 'PUT') continue;
    const ticker = sp.shortLeg.underlyingSymbol;
    const currentPrice = quoteMap.get(ticker);
    if (!currentPrice) continue;
    const shortStrike = sp.shortLeg.strike || 0;
    if (currentPrice < shortStrike) {
      const base = buildBase(sp.shortLeg, currentPrice, shortStrike,
        ((shortStrike - currentPrice) / shortStrike) * 100, 'Spread', 'PUT');
      underwater.push({
        ...base,
        classification: 'Spread',
        spreadWidth: sp.spreadWidth,
        maxLoss: sp.capitalAtRisk,
        longLegStrike: sp.longLeg.strike || 0,
        longLegPremium: sp.longLeg.averageOpenPrice,
      } as UnderwaterSpread);
    }
  }

  // ── Covered Calls (underwater = underlying above strike, shares may be called away) ──
  for (const cc of coveredCalls) {
    const ticker = cc.shortCall.underlyingSymbol;
    const currentPrice = quoteMap.get(ticker);
    if (!currentPrice) continue;
    const strike = cc.shortCall.strike || 0;
    if (currentPrice > strike) {
      const base = buildBase(cc.shortCall, currentPrice, strike,
        ((currentPrice - strike) / strike) * 100, 'Covered Call', 'CALL');
      // Look up covering stock details
      const stockKey = `${cc.shortCall.accountNumber}|${ticker}`;
      const stockInfo = equityLookup.get(stockKey);
      const stockCostBasis = stockInfo?.costBasis || 0;
      const coveringShares = cc.coveringShares;
      const stockMarketValue = currentPrice * coveringShares;
      const stockPnL = (currentPrice - stockCostBasis) * coveringShares;
      const optionPnLTotal = base.optionPnL;
      const combinedPnL = stockPnL + optionPnLTotal;

      // WTR: weeks of CC premium to recover stock unrealized loss
      const weeklyPremium = base.estimatedWeeklyPremium || 0;
      const wtrData = computeWTR(stockCostBasis, currentPrice, weeklyPremium, 100, cc.shortCall.quantity);

      underwater.push({
        ...base,
        classification: 'Covered Call',
        coveringShares,
        stockCostBasis,
        stockMarketValue,
        stockPnL,
        combinedPnL,
        weeksToRecovery: wtrData.weeksToRecovery,
        wtrBasis: wtrData.wtrBasis,
      } as UnderwaterCoveredCall);
    }
  }

  // ── Naked Calls (underlying above strike) ──
  for (const np of nakedPositions) {
    if (np.position.optionType !== 'CALL') continue;
    const ticker = np.position.underlyingSymbol;
    const currentPrice = quoteMap.get(ticker);
    if (!currentPrice) continue;
    const strike = np.position.strike || 0;
    if (currentPrice > strike) {
      const base = buildBase(np.position, currentPrice, strike,
        ((currentPrice - strike) / strike) * 100, 'Naked', 'CALL');
      underwater.push({
        ...base,
        classification: 'Naked',
        // Naked call max loss is theoretically unlimited
      } as UnderwaterNaked);
    }
  }

  // ── Bear Call Spreads (underlying above short strike) ──
  for (const sp of spreads) {
    if (sp.shortLeg.optionType !== 'CALL') continue;
    const ticker = sp.shortLeg.underlyingSymbol;
    const currentPrice = quoteMap.get(ticker);
    if (!currentPrice) continue;
    const shortStrike = sp.shortLeg.strike || 0;
    if (currentPrice > shortStrike) {
      const base = buildBase(sp.shortLeg, currentPrice, shortStrike,
        ((currentPrice - shortStrike) / shortStrike) * 100, 'Spread', 'CALL');
      underwater.push({
        ...base,
        classification: 'Spread',
        spreadWidth: sp.spreadWidth,
        maxLoss: sp.capitalAtRisk,
        longLegStrike: sp.longLeg.strike || 0,
        longLegPremium: sp.longLeg.averageOpenPrice,
      } as UnderwaterSpread);
    }
  }

  return underwater.sort((a, b) => b.percentITM - a.percentITM);
}

// ─── Helper: compute risk score (recalibrated) ───────────────────────────────

function computeRiskScore(
  maxConcentrationPct: number,
  underwaterCount: number,
  totalPositionCount: number,
  diversificationScore: number,
  capitalUtilizationPct: number,
  nakedCount: number,
): number {
  let score = 0;

  // Factor 1: Concentration risk (max 30 points) — recalibrated with lower thresholds
  if (maxConcentrationPct >= 40) score += 30;
  else if (maxConcentrationPct >= 25) score += 24;
  else if (maxConcentrationPct >= 15) score += 18;
  else if (maxConcentrationPct >= 8) score += 10;
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

  // Factor 3: Diversification (max 15 points — inverse of diversification score)
  score += Math.round((100 - diversificationScore) * 0.15);

  // Factor 4: Capital utilization (max 15 points)
  if (capitalUtilizationPct >= 90) score += 15;
  else if (capitalUtilizationPct >= 75) score += 12;
  else if (capitalUtilizationPct >= 60) score += 8;
  else if (capitalUtilizationPct >= 40) score += 4;

  // Factor 5: Truly naked positions (max 15 points) — these are the most dangerous
  if (nakedCount >= 10) score += 15;
  else if (nakedCount >= 5) score += 12;
  else if (nakedCount >= 2) score += 8;
  else if (nakedCount >= 1) score += 5;

  return Math.min(100, score);
}

// ─── Shared data fetching logic ─────────────────────────────────────────────

async function fetchPortfolioData(userId: number) {
  const { getApiCredentials, getTastytradeAccounts } = await import('./db');
  const credentials = await getApiCredentials(userId);
  if (!credentials?.tastytradeClientSecret || !credentials?.tastytradeRefreshToken) {
    throw new Error('Tastytrade credentials not configured');
  }

  const accounts = await getTastytradeAccounts(userId);
  if (!accounts || accounts.length === 0) throw new Error('No accounts found');

  // Load positions from DB cache
  const { getCachedPositions, cachedPosToWireFormat } = await import('./portfolio-sync');
  const cachedPos = await getCachedPositions(userId);
  const wirePositions = cachedPos.map(p => cachedPosToWireFormat({ ...p, quantityDirection: p.quantityDirection ?? '' }));

  // Parse cached positions
  const allParsed: ParsedPosition[] = [];
  const positionsByAccount = new Map<string, any[]>();
  for (const wire of wirePositions) {
    const accNum = (wire as any)['account-number'] || '';
    if (!positionsByAccount.has(accNum)) positionsByAccount.set(accNum, []);
    positionsByAccount.get(accNum)!.push(wire);
  }
  positionsByAccount.forEach((positions, accNum) => {
    if (positions.length > 0) allParsed.push(...parsePositions(positions, accNum));
  });

  // Fetch live balances (must stay live — real-time buying power)
  const accountBalances: AccountBalance[] = [];
  const { authenticateTastytrade } = await import('./tastytrade');
  const api = await authenticateTastytrade(credentials, userId);
  await Promise.all(accounts.map(async (account) => {
    const balances = await api.getBalances(account.accountNumber).catch(() => null);
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

  // Fetch live quotes from Tradier for all underlying symbols
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

  return { allParsed, accountBalances, quoteMap, accounts };
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
      const { allParsed, accountBalances, quoteMap } = await fetchPortfolioData(ctx.user.id);

      // Detect spreads and classify positions
      const { spreads, coveredCalls, cashSecuredPuts, nakedPositions, equities } = detectSpreadsAndClassify(allParsed);
      const { tickerExposure, totalCapitalAtRisk } = computeCapitalAtRisk(spreads, coveredCalls, cashSecuredPuts, nakedPositions, equities, quoteMap);

      // Concentration
      const topConcentrations = Array.from(tickerExposure.entries())
        .map(([ticker, exposure]) => ({
          ticker,
          exposure,
          percentage: totalCapitalAtRisk > 0 ? (exposure / totalCapitalAtRisk) * 100 : 0,
        }))
        .sort((a, b) => b.exposure - a.exposure)
        .slice(0, 5);

      // Underwater detection
      const underwaterList = detectUnderwaterPositions(spreads, coveredCalls, cashSecuredPuts, nakedPositions, quoteMap, equities);

      // Diversification score
      const tickerCount = new Set(tickerExposure.keys()).size;
      let diversificationScore = 0;
      if (tickerCount >= 20) diversificationScore = Math.min(100, 90 + (tickerCount - 20));
      else if (tickerCount >= 11) diversificationScore = 75 + ((tickerCount - 11) / 9) * 15;
      else if (tickerCount >= 7) diversificationScore = 60 + ((tickerCount - 7) / 4) * 15;
      else if (tickerCount >= 4) diversificationScore = 40 + ((tickerCount - 4) / 3) * 20;
      else if (tickerCount >= 1) diversificationScore = 20 + ((tickerCount - 1) / 3) * 20;

      // Sector count
      const sectorArr = Array.from(new Set(Array.from(tickerExposure.keys()).map(getSector)));
      const sectorCount = sectorArr.length;

      // Buying power totals
      const totalBuyingPower = accountBalances.reduce((sum, a) => sum + a.derivativeBuyingPower, 0);
      const totalNetLiq = accountBalances.reduce((sum, a) => sum + a.netLiquidatingValue, 0);
      const capitalUtilizationPct = totalNetLiq > 0 ? ((totalNetLiq - totalBuyingPower) / totalNetLiq) * 100 : 0;

      // Risk score
      const maxConcentration = topConcentrations.length > 0 ? topConcentrations[0].percentage : 0;
      const totalShortPositionCount = spreads.length + coveredCalls.length + cashSecuredPuts.length + nakedPositions.length;
      const riskScore = computeRiskScore(
        maxConcentration,
        underwaterList.length,
        totalShortPositionCount,
        diversificationScore,
        Math.max(0, capitalUtilizationPct),
        nakedPositions.length,
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
      const { allParsed, accountBalances, quoteMap } = await fetchPortfolioData(ctx.user.id);

      // Detect spreads and classify positions
      const { spreads, coveredCalls, cashSecuredPuts, nakedPositions, standaloneLongs: _standaloneLongs, equities } = detectSpreadsAndClassify(allParsed);
      const { tickerExposure, totalCapitalAtRisk } = computeCapitalAtRisk(spreads, coveredCalls, cashSecuredPuts, nakedPositions, equities, quoteMap);

      // Concentration breakdown
      const concentrations = Array.from(tickerExposure.entries())
        .map(([ticker, exposure]) => ({
          ticker,
          sector: getSector(ticker),
          capitalAtRisk: exposure,
          percentage: totalCapitalAtRisk > 0 ? (exposure / totalCapitalAtRisk) * 100 : 0,
        }))
        .sort((a, b) => b.capitalAtRisk - a.capitalAtRisk);

      // Sector concentration
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

      // Underwater positions
      const underwaterPositions = detectUnderwaterPositions(spreads, coveredCalls, cashSecuredPuts, nakedPositions, quoteMap, equities);

      // Portfolio delta
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

      // Buying power
      const totalBuyingPower = accountBalances.reduce((sum, a) => sum + a.derivativeBuyingPower, 0);
      const totalNetLiq = accountBalances.reduce((sum, a) => sum + a.netLiquidatingValue, 0);
      const capitalUtilizationPct = totalNetLiq > 0 ? ((totalNetLiq - totalBuyingPower) / totalNetLiq) * 100 : 0;

      // Position classification summary
      const positionClassificationSummary = {
        totalSpreads: spreads.length,
        totalCoveredCalls: coveredCalls.length,
        totalCashSecuredPuts: cashSecuredPuts.length,
        totalNaked: nakedPositions.length,
        spreadCapitalAtRisk: spreads.reduce((sum, sp) => sum + sp.capitalAtRisk, 0),
        coveredCallCount: coveredCalls.reduce((sum, cc) => sum + cc.shortCall.quantity, 0),
        cashSecuredPutCapitalAtRisk: cashSecuredPuts.reduce((sum, csp) => {
          return sum + (csp.shortPut.strike || 0) * 100 * csp.shortPut.quantity;
        }, 0),
        nakedCapitalAtRisk: nakedPositions.reduce((sum, np) => {
          if (np.position.optionType === 'PUT') return sum + (np.position.strike || 0) * 100 * np.position.quantity;
          const price = quoteMap.get(np.position.underlyingSymbol) || np.position.closePrice || (np.position.strike || 0);
          return sum + price * 100 * np.position.quantity;
        }, 0),
      };

      // Diversification
      const tickerCount = new Set(tickerExposure.keys()).size;
      let diversificationScore = 0;
      if (tickerCount >= 20) diversificationScore = Math.min(100, 90 + (tickerCount - 20));
      else if (tickerCount >= 11) diversificationScore = 75 + ((tickerCount - 11) / 9) * 15;
      else if (tickerCount >= 7) diversificationScore = 60 + ((tickerCount - 7) / 4) * 15;
      else if (tickerCount >= 4) diversificationScore = 40 + ((tickerCount - 4) / 3) * 20;
      else if (tickerCount >= 1) diversificationScore = 20 + ((tickerCount - 1) / 3) * 20;

      // Risk score
      const maxConcentration = concentrations.length > 0 ? concentrations[0].percentage : 0;
      const totalShortPositionCount = spreads.length + coveredCalls.length + cashSecuredPuts.length + nakedPositions.length;
      const riskScore = computeRiskScore(
        maxConcentration,
        underwaterPositions.length,
        totalShortPositionCount,
        diversificationScore,
        Math.max(0, capitalUtilizationPct),
        nakedPositions.length,
      );

      // Position sizing violations
      const violations2pct = concentrations.filter(c => c.percentage > 2).length;
      const violations10pct = concentrations.filter(c => c.percentage > 10).length;
      const violations25pctSector = sectorConcentrations.filter(s => s.percentage > 25).length;

      // Recommendations
      const actionItems: Array<{ priority: string; description: string }> = [];

      if (violations10pct > 0) {
        actionItems.push({
          priority: 'high',
          description: `Reduce concentration in ${concentrations[0].ticker} (${concentrations[0].percentage.toFixed(1)}% of portfolio). Target: <10% per ticker.`,
        });
      }
      if (nakedPositions.length > 0) {
        actionItems.push({
          priority: 'high',
          description: `${nakedPositions.length} truly naked position${nakedPositions.length > 1 ? 's' : ''} detected. These have unlimited risk. Consider adding protective legs.`,
        });
      }
      if (underwaterPositions.length > 0) {
        const worstPct = underwaterPositions[0].percentITM.toFixed(1);
        actionItems.push({
          priority: 'high',
          description: `${underwaterPositions.length} position${underwaterPositions.length > 1 ? 's are' : ' is'} underwater (ITM). Worst: ${underwaterPositions[0].ticker} at ${worstPct}% ITM. Consider rolling or closing.`,
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

      // Past Trades placeholder
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
          positionClassificationSummary,
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
