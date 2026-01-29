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
  // Use bid for selling (short put) and ask for buying (long put)
  const shortPremium = cspOpp.bid; // What we receive
  const longPremium = longPutQuote.ask; // What we pay
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
  
  return {
    ...cspOpp,
    // Override premium to show net credit
    premium: netCredit,
    bid: shortPremium,
    ask: cspOpp.ask,
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
