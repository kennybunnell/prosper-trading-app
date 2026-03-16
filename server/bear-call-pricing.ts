/**
 * Bear Call Spread Pricing Logic
 * Calculates spread opportunities based on CC opportunities
 */

export type CCOpportunity = {
  symbol: string;
  currentPrice: number;
  strike: number;
  expiration: string;
  dte: number;
  delta: number;
  bid: number;
  ask: number;
  mid: number;
  premium: number;
  returnPct: number;
  weeklyReturn: number;
  volume: number;
  openInterest: number;
  spreadPct: number;
  rsi: number | null;
  ivRank: number | null;
  bbPctB: number | null;
  sharesOwned: number;
  maxContracts: number;
  distanceOtm: number;
  score: number;
  multiplier?: number; // Contract multiplier: 100 for standard, 10 for mini-index (MRUT, XSP, XND, DJX)
};

export interface BearCallSpreadOpportunity extends CCOpportunity {
  // Spread-specific fields
  spreadType: 'bear-call';
  spreadWidth: number;
  longStrike: number;
  longPremium: number;
  longBid: number;
  longAsk: number;
  longDelta: number;
  netCredit: number;
  capitalAtRisk: number;
  maxProfit: number;
  maxLoss: number;
  spreadROC: number; // Return on capital at risk
  breakeven: number;
  profitZoneWidth: number;
  comparisonCC: {
    collateral: number;
    premium: number;
    roc: number;
    capitalSavings: number;
    capitalSavingsPct: number;
  };
}

/**
 * Calculate bear call spread pricing from CC opportunity
 * @param ccOpp - The short call (sold) opportunity
 * @param spreadWidth - Width of the spread in points (2, 5, or 10)
 * @param longCallQuote - Quote data for the long (protective) call
 * @param multiplier - Contract multiplier (default 100; use 10 for mini-index like MRUT)
 */
export function calculateBearCallSpread(
  ccOpp: CCOpportunity,
  spreadWidth: number,
  longCallQuote: {
    bid: number;
    ask: number;
    delta: number;
  },
  multiplier: number = 100
): BearCallSpreadOpportunity {
  // Use multiplier from ccOpp if provided, otherwise fall back to parameter
  const mult = ccOpp.multiplier ?? multiplier;

  const shortStrike = ccOpp.strike;
  const longStrike = shortStrike + spreadWidth;
  
  // Net credit = premium received from short call - premium paid for long call
  // Use mid prices for spread pricing (standard approach for limit order calculation)
  // The order preview slider will let the user adjust from this mid-based starting point
  const shortMid = (ccOpp.bid + ccOpp.ask) / 2;
  const longMid = (longCallQuote.bid + longCallQuote.ask) / 2;
  const shortPremium = shortMid; // Mid of short call
  const longPremium = longMid;   // Mid of long call
  const netCredit = shortPremium - longPremium;
  
  // Capital at risk = spread width - net credit received (per contract)
  const capitalAtRisk = (spreadWidth - netCredit) * mult;
  
  // Max profit = net credit received (per contract)
  const maxProfit = netCredit * mult;
  
  // Max loss = spread width - net credit
  const maxLoss = capitalAtRisk;
  
  // Return on capital = max profit / capital at risk
  const spreadROC = capitalAtRisk > 0 ? (maxProfit / capitalAtRisk) * 100 : 0;
  
  // Breakeven = short strike + net credit
  const breakeven = shortStrike + netCredit;
  
  // Profit zone width = distance from breakeven to current price
  const profitZoneWidth = breakeven - ccOpp.currentPrice;
  
  // CC comparison (for covered calls, collateral is the stock value for mult shares)
  const ccCollateral = ccOpp.currentPrice * mult; // Stock value for mult shares
  const ccPremium = shortPremium * mult;
  const ccROC = (ccPremium / ccCollateral) * 100;
  const capitalSavings = ccCollateral - capitalAtRisk;
  const capitalSavingsPct = (capitalSavings / ccCollateral) * 100;
  
  // Calculate net Delta for the spread
  // Net Delta = |short call Delta| - |long call Delta|
  // Both are negative for calls, so we take absolute values and subtract
  const netDelta = Math.abs(Math.abs(ccOpp.delta) - Math.abs(longCallQuote.delta));
  
  // Calculate combined bid/ask spread for both legs
  // Short call spread: (ask - bid) for what we're selling
  // Long call spread: (ask - bid) for what we're buying
  // Total spread as % of net credit
  const shortSpread = ccOpp.ask - ccOpp.bid;
  const longSpread = longCallQuote.ask - longCallQuote.bid;
  const combinedSpread = shortSpread + longSpread;
  const spreadPct = netCredit > 0 ? (combinedSpread / netCredit) * 100 : 0;
  
  return {
    ...ccOpp,
    // Override delta to show net Delta for the spread
    delta: netDelta,
    // Override premium to show net credit
    premium: netCredit,
    bid: shortPremium,
    ask: ccOpp.ask,
    // Override spreadPct to show combined spread for both legs
    spreadPct,
    // Spread-specific fields
    spreadType: 'bear-call',
    spreadWidth,
    longStrike,
    longPremium,
    longBid: longCallQuote.bid,
    longAsk: longCallQuote.ask,
    longDelta: longCallQuote.delta,
    netCredit,
    capitalAtRisk,
    maxProfit,
    maxLoss,
    spreadROC,
    breakeven,
    profitZoneWidth,
    comparisonCC: {
      collateral: ccCollateral,
      premium: ccPremium,
      roc: ccROC,
      capitalSavings,
      capitalSavingsPct,
    },
    // Recalculate percentages based on capital at risk
    // capitalAtRisk / mult gives us the per-point capital
    returnPct: (netCredit / (capitalAtRisk / mult)) * 100,
    weeklyReturn: ((netCredit / (capitalAtRisk / mult)) * 100 * 7) / ccOpp.dte,
  };
}
