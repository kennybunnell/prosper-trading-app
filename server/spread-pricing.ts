/**
 * Bull Put Spread Pricing Logic
 * Calculates spread opportunities based on CSP opportunities
 */

import { CSPOpportunity } from './tradier';

export interface BullPutSpreadOpportunity extends CSPOpportunity {
  // Spread-specific fields
  spreadType: 'bull-put';
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
  comparisonCSP: {
    collateral: number;
    premium: number;
    roc: number;
    capitalSavings: number;
    capitalSavingsPct: number;
  };
}

/**
 * Calculate bull put spread pricing from CSP opportunity
 * @param cspOpp - The short put (sold) opportunity
 * @param spreadWidth - Width of the spread in points (2, 5, or 10)
 * @param longPutQuote - Quote data for the long (protective) put
 */
export function calculateBullPutSpread(
  cspOpp: CSPOpportunity,
  spreadWidth: number,
  longPutQuote: {
    bid: number;
    ask: number;
    delta: number;
  }
): BullPutSpreadOpportunity {
  const shortStrike = cspOpp.strike;
  const longStrike = shortStrike - spreadWidth;
  
  // Net credit = premium received from short put - premium paid for long put
  // Use mid prices for both legs for accurate, consistent net credit (matches BCS and market convention)
  const shortMid = (cspOpp.bid + cspOpp.ask) / 2;
  const longMid = (longPutQuote.bid + longPutQuote.ask) / 2;
  const shortPremium = shortMid; // Mid price for short put
  const longPremium = longMid;   // Mid price for long put
  const netCredit = shortPremium - longPremium;
  
  // Capital at risk = spread width - net credit received
  const capitalAtRisk = (spreadWidth - netCredit) * 100; // Per contract
  
  // Max profit = net credit received
  const maxProfit = netCredit * 100;
  
  // Max loss = spread width - net credit
  const maxLoss = capitalAtRisk;
  
  // Return on capital = max profit / capital at risk
  const spreadROC = capitalAtRisk > 0 ? (maxProfit / capitalAtRisk) * 100 : 0;
  
  // Breakeven = short strike - net credit
  const breakeven = shortStrike - netCredit;
  
  // Profit zone width = distance from current price to breakeven
  const profitZoneWidth = cspOpp.currentPrice - breakeven;
  
  // CSP comparison
  const cspCollateral = shortStrike * 100; // Full collateral for CSP
  const cspPremium = shortPremium * 100;
  const cspROC = (cspPremium / cspCollateral) * 100;
  const capitalSavings = cspCollateral - capitalAtRisk;
  const capitalSavingsPct = (capitalSavings / cspCollateral) * 100;
  
  // Calculate net Delta for the spread
  // Net Delta = |short put Delta| - |long put Delta|
  // Both are negative for puts, so we take absolute values and subtract
  const netDelta = Math.abs(Math.abs(cspOpp.delta) - Math.abs(longPutQuote.delta));
  
  // Calculate combined bid/ask spread for both legs
  // Short put spread: (ask - bid) for what we're selling
  // Long put spread: (ask - bid) for what we're buying
  // Total spread as % of net credit
  const shortSpread = cspOpp.ask - cspOpp.bid;
  const longSpread = longPutQuote.ask - longPutQuote.bid;
  const combinedSpread = shortSpread + longSpread;
  const spreadPct = netCredit > 0 ? (combinedSpread / netCredit) * 100 : 0;
  
  return {
    ...cspOpp,
    // Override delta to show net Delta for the spread
    delta: netDelta,
    // Override premium to show net credit
    premium: netCredit,
    bid: shortPremium,
    ask: cspOpp.ask,
    // Override spreadPct to show combined spread for both legs
    spreadPct,
    // Spread-specific fields
    spreadType: 'bull-put',
    spreadWidth,
    longStrike,
    longPremium,
    longBid: longPutQuote.bid,
    longAsk: longPutQuote.ask,
    longDelta: longPutQuote.delta,
    netCredit,
    capitalAtRisk,
    maxProfit,
    maxLoss,
    spreadROC,
    breakeven,
    profitZoneWidth,
    comparisonCSP: {
      collateral: cspCollateral,
      premium: cspPremium,
      roc: cspROC,
      capitalSavings,
      capitalSavingsPct,
    },
    // Recalculate percentages based on capital at risk
    premiumPct: (netCredit / (capitalAtRisk / 100)) * 100,
    weeklyPct: ((netCredit / (capitalAtRisk / 100)) * 100 * 7) / cspOpp.dte,
    monthlyPct: ((netCredit / (capitalAtRisk / 100)) * 100 * 30) / cspOpp.dte,
    annualPct: ((netCredit / (capitalAtRisk / 100)) * 100 * 365) / cspOpp.dte,
  };
}

/**
 * Bear Call Spread Pricing Logic
 * Calculates spread opportunities based on CC opportunities
 */

import { CCOpportunity } from './bear-call-pricing';

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
}

/**
 * Calculate bear call spread pricing from CC opportunity
 * @param ccOpp - The short call (sold) opportunity
 * @param spreadWidth - Width of the spread in points (2, 5, or 10)
 * @param longCallQuote - Quote data for the long (protective) call
 */
export function calculateBearCallSpread(
  ccOpp: CCOpportunity,
  spreadWidth: number,
  longCallQuote: {
    bid: number;
    ask: number;
    delta: number;
  }
): BearCallSpreadOpportunity {
  const shortStrike = ccOpp.strike;
  const longStrike = shortStrike + spreadWidth;
  
  // Net credit = premium received from short call - premium paid for long call
  // Use mid prices for both legs for accurate, consistent net credit (matches BPS and market convention)
  const shortMid = (ccOpp.bid + ccOpp.ask) / 2;
  const longMid = (longCallQuote.bid + longCallQuote.ask) / 2;
  const shortPremium = shortMid; // Mid price for short call
  const longPremium = longMid;   // Mid price for long call
  const netCredit = shortPremium - longPremium;
  
  // Capital at risk = spread width - net credit received
  const capitalAtRisk = (spreadWidth - netCredit) * 100; // Per contract
  
  // Max profit = net credit received
  const maxProfit = netCredit * 100;
  
  // Max loss = spread width - net credit
  const maxLoss = capitalAtRisk;
  
  // Return on capital = max profit / capital at risk
  const spreadROC = capitalAtRisk > 0 ? (maxProfit / capitalAtRisk) * 100 : 0;
  
  // Breakeven = short strike + net credit
  const breakeven = shortStrike + netCredit;
  
  // Profit zone width = distance from breakeven to current price
  const profitZoneWidth = breakeven - ccOpp.currentPrice;
  
  // Calculate net Delta for the spread
  // Net Delta = |short call Delta| - |long call Delta|
  const netDelta = Math.abs(Math.abs(ccOpp.delta) - Math.abs(longCallQuote.delta));
  
  // Calculate combined bid/ask spread for both legs
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
  };
}
